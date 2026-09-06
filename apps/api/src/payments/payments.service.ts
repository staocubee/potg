import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DepositDto } from './dto/deposit.dto';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { RaiseOrderDisputeDto } from './dto/raise-order-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { ArbitrateDisputeDto } from './dto/arbitrate-dispute.dto';
import { SubmitDisputeEvidenceDto } from './dto/submit-dispute-evidence.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaystackService } from './paystack.service';
import { FlutterwaveService } from './flutterwave.service';
import { PaypalService } from './paypal.service';
import { StripeService } from './stripe.service';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';

// The shape every real deposit gateway besides Paystack shares closely
// enough to dispatch on generically (Paystack keeps its own, unchanged
// branch below — see deposit()/verifyDeposit()'s own comments for why).
// Note "amount" here is always the currency's MAJOR unit (e.g. 5000
// meaning 5000 NGN) — unlike PaystackVerifyResult.amountKobo, since
// Flutterwave/PayPal/Stripe don't share Paystack's minor-unit convention
// (Stripe does use minor units internally, but StripeService itself
// already converts back before returning here).
interface DepositGateway {
  initializeTransaction(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ authorizationUrl: string; reference: string }>;
  verifyTransaction(reference: string): Promise<{ status: string; amount: number; currency: string }>;
}

function receiptNumber(): string {
  // Not sequential/invoice-grade (a real one would need a per-account
  // counter to avoid gaps) — unique and traceable is enough for this
  // scaffold.
  return `RCT-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

// RFC 2606/6761 reserved TLDs (.test, .example, .invalid, .localhost) are
// deliberately never real deliverable domains — this seed data's own
// demo-owner@propertyonthego.test uses one on purpose, so a login email
// is never mistaken for one worth emailing for real. Paystack's own
// server-side validation rejects them outright ("email must be a valid
// email"), confirmed directly against their API — a real external
// constraint, not something this scaffold can configure around. Paystack
// never actually sends mail to this address in test mode, it's only a
// label on the transaction, so swapping the TLD here doesn't change what
// the account's real login email is anywhere else in the system.
const RESERVED_TEST_TLDS = ['test', 'example', 'invalid', 'localhost'];
function payableEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const tld = domain.split('.').pop();
  if (tld && RESERVED_TEST_TLDS.includes(tld.toLowerCase())) {
    return `${local}@${domain.slice(0, -tld.length)}com`;
  }
  return email;
}

@Injectable()
export class PaymentsService {
  // Every provider name deposit() might dispatch to besides "paystack"
  // (which keeps its own separate, unchanged branch) and "manual" (the
  // simulated fallback) — built once in the constructor rather than a
  // fresh object literal per call.
  private readonly depositGateways: Record<string, DepositGateway>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly flutterwave: FlutterwaveService,
    private readonly paypal: PaypalService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly notifications: InAppNotificationsService,
  ) {
    this.depositGateways = {
      flutterwave: this.flutterwave,
      stripe: this.stripe,
      // PaypalService.initializeTransaction doesn't take `email`/`metadata`
      // (PayPal Orders don't carry either) — adapted to DepositGateway's
      // shared shape here rather than forcing PaypalService's own method
      // signature to accept parameters it would just ignore.
      paypal: {
        initializeTransaction: (params) => this.paypal.initializeTransaction(params),
        verifyTransaction: (reference) => this.paypal.verifyTransaction(reference),
      },
    };
  }

  private async getOrCreateEscrowAccount(projectId: string, currency: string) {
    const existing = await this.prisma.escrowAccount.findUnique({ where: { projectId } });
    if (existing) return existing;
    return this.prisma.escrowAccount.create({ data: { projectId, currency } });
  }

  async getEscrow(projectId: string) {
    const escrowAccount = await this.prisma.escrowAccount.findUnique({
      where: { projectId },
      include: { ledgerEntries: { orderBy: { createdAt: 'desc' } } },
    });
    if (!escrowAccount) {
      // Not funded yet — a real 404 would be confusing here since it's a
      // perfectly normal state for a new project, not a missing resource.
      return { projectId, balance: 0, currency: null, status: 'not_funded', ledgerEntries: [] };
    }
    return escrowAccount;
  }

  // Deposit — provider "manual" is the original simulation (see the
  // Payment model's schema comment), still the fallback for demo/seed data
  // and anyone without a real gateway key configured: it credits escrow
  // instantly, as if a gateway had already confirmed it. "paystack",
  // "flutterwave", "stripe", and "paypal" are real gateway integrations
  // instead — see PaystackService/FlutterwaveService/StripeService/
  // PaypalService's own comments. None of them credit escrow here; the
  // Payment is created "pending" and escrow is only credited once
  // verifyDeposit confirms the charge actually succeeded, so a buyer
  // abandoning a gateway's checkout page never phantom-funds the project.
  async deposit(accountId: string, projectId: string, email: string, dto: DepositDto) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, accountId } });
    if (!project) throw new NotFoundException('Project not found');

    const currency = dto.currency ?? project.currency;

    if (dto.provider === 'paystack') {
      const escrowAccount = await this.getOrCreateEscrowAccount(projectId, currency);
      const reference = `potg_dep_${randomUUID()}`;
      const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
      const { authorizationUrl } = await this.paystack.initializeTransaction({
        email: payableEmail(email),
        amount: dto.amount,
        currency,
        reference,
        callbackUrl: `${webAppUrl}/projects/${projectId}?depositReference=${reference}`,
        metadata: { projectId, accountId },
      });
      const payment = await this.prisma.payment.create({
        data: {
          accountId,
          projectId,
          escrowAccountId: escrowAccount.id,
          amount: dto.amount,
          currency,
          provider: 'paystack',
          providerReference: reference,
          status: 'pending',
        },
      });
      return { payment, authorizationUrl };
    }

    // Flutterwave/Stripe/PayPal — same shape as the Paystack branch above,
    // dispatched generically via DepositGateway rather than three more
    // copies of it. Stripe's own gateway naturally throws here (via
    // isConfigured) until STRIPE_SECRET_KEY is set — see StripeService's
    // own comment — so this falls through to the manual simulation below
    // exactly as it always did, with no special-casing needed.
    const gateway = dto.provider ? this.depositGateways[dto.provider] : undefined;
    if (gateway) {
      const escrowAccount = await this.getOrCreateEscrowAccount(projectId, currency);
      const reference = `potg_dep_${randomUUID()}`;
      const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
      const init = await gateway.initializeTransaction({
        email: payableEmail(email),
        amount: dto.amount,
        currency,
        reference,
        callbackUrl: `${webAppUrl}/projects/${projectId}?depositReference=${reference}`,
        metadata: { projectId, accountId },
      });
      // The reference actually persisted is whatever the gateway returned
      // — Paystack echoes back the same one this scaffold generated, but
      // PayPal/Stripe assign their own id (an Order id / Checkout Session
      // id) that has to be used for verification instead.
      const payment = await this.prisma.payment.create({
        data: {
          accountId,
          projectId,
          escrowAccountId: escrowAccount.id,
          amount: dto.amount,
          currency,
          provider: dto.provider!,
          providerReference: init.reference,
          status: 'pending',
        },
      });
      return { payment, authorizationUrl: init.authorizationUrl };
    }

    const escrowAccount = await this.getOrCreateEscrowAccount(projectId, currency);
    const payment = await this.prisma.payment.create({
      data: {
        accountId,
        projectId,
        escrowAccountId: escrowAccount.id,
        amount: dto.amount,
        currency,
        provider: dto.provider ?? 'manual',
        providerReference: dto.providerReference,
        status: 'completed',
      },
    });
    const receipt = await this.creditEscrowForDeposit(escrowAccount.id, payment, accountId);
    return { payment, receipt };
  }

  // Shared by the instant "manual" path above and verifyDeposit below —
  // the one place that actually moves the escrow balance and records the
  // ledger entry + receipt for a deposit, so the two paths can never
  // credit it two different ways.
  private async creditEscrowForDeposit(
    escrowAccountId: string,
    payment: { id: string; amount: unknown; currency: string; provider: string },
    accountId: string,
  ) {
    const escrowAccount = await this.prisma.escrowAccount.findUniqueOrThrow({ where: { id: escrowAccountId } });
    const amount = Number(payment.amount);
    const newBalance = Number(escrowAccount.balance) + amount;

    await this.prisma.escrowAccount.update({ where: { id: escrowAccountId }, data: { balance: newBalance } });
    await this.prisma.escrowLedgerEntry.create({
      data: {
        escrowAccountId,
        entryType: 'deposit',
        amount,
        balanceAfter: newBalance,
        relatedPaymentId: payment.id,
        notes: `Deposit via ${payment.provider}`,
      },
    });
    return this.prisma.receipt.create({
      data: {
        accountId,
        receiptNumber: receiptNumber(),
        paymentId: payment.id,
        amount,
        currency: payment.currency,
      },
    });
  }

  // The other half of the real Paystack path — asks Paystack directly
  // whether the charge for this payment's own reference actually
  // succeeded, rather than trusting anything the client claims. Callable
  // more than once safely: a payment that's already "completed" just
  // returns its existing receipt instead of crediting escrow twice.
  async verifyDeposit(accountId: string, projectId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, projectId, accountId } });
    if (!payment) throw new NotFoundException('Payment not found on this project');

    if (payment.provider === 'paystack') {
      if (payment.status === 'completed') {
        const receipt = await this.prisma.receipt.findUnique({ where: { paymentId: payment.id } });
        return { payment, receipt, alreadyVerified: true };
      }
      if (payment.status !== 'pending' || !payment.providerReference) {
        throw new BadRequestException(`This payment is "${payment.status}" — nothing to verify`);
      }

      const result = await this.paystack.verifyTransaction(payment.providerReference);
      if (result.status === 'failed') {
        // A genuinely declined/failed charge — terminal, same as any other
        // failed Payment elsewhere in this schema.
        const updated = await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
        return { payment: updated, receipt: null, alreadyVerified: false };
      }
      if (result.status !== 'success') {
        // "abandoned" (checkout not completed yet) or anything else that
        // isn't a final answer — leave the payment "pending" rather than
        // marking it failed, so a buyer who verifies too early (or closes
        // the tab and comes back later) can still complete the same
        // checkout session and verify again afterward.
        return { payment, receipt: null, alreadyVerified: false };
      }

      const expectedKobo = Math.round(Number(payment.amount) * 100);
      if (result.amountKobo !== expectedKobo || result.currency !== payment.currency) {
        // Paystack confirmed a charge, but not for the amount/currency this
        // payment recorded — refuse to credit escrow for a mismatch rather
        // than trusting the reference alone.
        throw new BadRequestException(
          `Paystack confirmed a different amount/currency than expected (got ${result.amountKobo / 100} ${result.currency})`,
        );
      }

      const completed = await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'completed' } });
      const receipt = await this.creditEscrowForDeposit(payment.escrowAccountId, completed, accountId);
      return { payment: completed, receipt, alreadyVerified: false };
    }

    // Flutterwave/Stripe/PayPal — same shape as the Paystack branch above,
    // just comparing amounts in major units (see DepositGateway's own
    // comment for why) instead of Paystack's kobo-specific comparison.
    const gateway = this.depositGateways[payment.provider];
    if (!gateway) {
      throw new BadRequestException('Only a real-gateway deposit needs verification');
    }
    if (payment.status === 'completed') {
      const receipt = await this.prisma.receipt.findUnique({ where: { paymentId: payment.id } });
      return { payment, receipt, alreadyVerified: true };
    }
    if (payment.status !== 'pending' || !payment.providerReference) {
      throw new BadRequestException(`This payment is "${payment.status}" — nothing to verify`);
    }

    const result = await gateway.verifyTransaction(payment.providerReference);
    if (result.status === 'failed') {
      const updated = await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
      return { payment: updated, receipt: null, alreadyVerified: false };
    }
    if (result.status !== 'success') {
      return { payment, receipt: null, alreadyVerified: false };
    }

    const expectedAmount = Number(payment.amount);
    if (Math.abs(result.amount - expectedAmount) > 0.01 || result.currency !== payment.currency) {
      throw new BadRequestException(
        `${payment.provider} confirmed a different amount/currency than expected (got ${result.amount} ${result.currency})`,
      );
    }

    const completed = await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'completed' } });
    const receipt = await this.creditEscrowForDeposit(payment.escrowAccountId, completed, accountId);
    return { payment: completed, receipt, alreadyVerified: false };
  }

  findPayments(projectId: string) {
    return this.prisma.payment.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  // Refunds a completed deposit back out of escrow — the counterpart to
  // deposit() above, gated by "payment:approve" for the same reason
  // releaseMilestone is: it moves money out of escrow, so it deserves more
  // than the plain "payment:write" a deposit needs. Only refundable while
  // the deposit's own amount is still sitting in escrow — once enough of
  // it has been released to a vendor via milestones, there's nothing left
  // to give back and this fails with the same "insufficient balance" shape
  // releaseMilestone already uses, rather than allowing a refund that
  // would take the balance negative.
  async refundPayment(projectId: string, paymentId: string, dto: RefundPaymentDto) {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, projectId } });
    if (!payment) throw new NotFoundException('Payment not found on this project');
    if (payment.status !== 'completed') {
      throw new BadRequestException('Only a completed payment can be refunded');
    }

    const openDispute = await this.prisma.dispute.findFirst({
      where: { paymentId, status: { in: ['open', 'under_review'] } },
    });
    if (openDispute) {
      throw new BadRequestException('This payment has an open dispute — resolve it before refunding');
    }

    const escrowAccount = await this.prisma.escrowAccount.findUnique({ where: { id: payment.escrowAccountId } });
    if (!escrowAccount) {
      throw new BadRequestException('This payment has no escrow account to refund from');
    }
    const amount = Number(payment.amount);
    if (Number(escrowAccount.balance) < amount) {
      throw new BadRequestException(
        'Insufficient escrow balance to refund this payment — some of it has already been released',
      );
    }

    const newBalance = Number(escrowAccount.balance) - amount;
    const [, updatedPayment] = await this.prisma.$transaction([
      this.prisma.escrowAccount.update({ where: { id: escrowAccount.id }, data: { balance: newBalance } }),
      this.prisma.payment.update({ where: { id: paymentId }, data: { status: 'refunded' } }),
    ]);

    const ledgerEntry = await this.prisma.escrowLedgerEntry.create({
      data: {
        escrowAccountId: escrowAccount.id,
        entryType: 'refund',
        amount,
        balanceAfter: newBalance,
        relatedPaymentId: paymentId,
        notes: dto.reason ?? `Refund of deposit ${paymentId}`,
      },
    });

    return { payment: updatedPayment, ledgerEntry };
  }

  // Owner marks a milestone's submitted evidence as approved — the
  // prerequisite for releasing funds, kept as its own step per Section 22's
  // "clear approval flows: review evidence, approve ... hold payment".
  async approveMilestone(projectId: string, milestoneId: string) {
    const milestone = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId } });
    if (!milestone) throw new NotFoundException('Milestone not found on this project');
    return this.prisma.projectMilestone.update({
      where: { id: milestoneId },
      data: { approvalStatus: 'approved' },
    });
  }

  // Releasing a milestone is the one action in this module gated by
  // "payment:approve" rather than a plain read/write permission — moving
  // money out of escrow deserves its own permission, not just whichever
  // role can edit a project.
  async releaseMilestone(projectId: string, milestoneId: string) {
    const milestone = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId } });
    if (!milestone) throw new NotFoundException('Milestone not found on this project');
    if (milestone.approvalStatus !== 'approved') {
      throw new BadRequestException('Milestone must be approved before its funds can be released');
    }
    if (milestone.paymentAmount == null) {
      throw new BadRequestException('This milestone has no payment amount set');
    }

    const alreadyReleased = await this.prisma.payout.findFirst({
      where: { milestoneId, status: { not: 'failed' } },
    });
    if (alreadyReleased) {
      throw new ConflictException('This milestone has already been released');
    }

    const openDispute = await this.prisma.dispute.findFirst({
      where: { milestoneId, status: { in: ['open', 'under_review'] } },
    });
    if (openDispute) {
      throw new BadRequestException('This milestone has an open dispute — resolve it before releasing funds');
    }

    const escrowAccount = await this.prisma.escrowAccount.findUnique({ where: { projectId } });
    if (!escrowAccount) {
      throw new BadRequestException('This project has no funded escrow account yet');
    }
    const amount = Number(milestone.paymentAmount);
    if (Number(escrowAccount.balance) < amount) {
      throw new BadRequestException('Insufficient escrow balance to release this milestone');
    }

    const assignment = await this.prisma.projectVendorAssignment.findFirst({ where: { projectId } });
    if (!assignment) {
      throw new BadRequestException('No vendor is assigned to this project yet — accept a quote first');
    }
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: assignment.vendorId } });

    // Real Paystack Transfer path — only once a vendor has actually set up
    // bank details for Paystack specifically (VendorsService.setBankDetails,
    // which now records which gateway they were resolved against in
    // vendor.payoutProvider) and the server has a Paystack key; otherwise
    // this falls through to the Flutterwave/PayPal branches below it, and
    // finally the original instant simulation, same "manual" vs "paystack"
    // branch deposit() already makes.
    if (vendor.bankAccountNumber && vendor.bankCode && vendor.payoutProvider === 'paystack' && this.paystack.isConfigured) {
      let recipientCode = vendor.paystackRecipientCode;
      if (!recipientCode) {
        recipientCode = await this.paystack.createTransferRecipient({
          name: vendor.bankAccountName ?? vendor.businessName,
          accountNumber: vendor.bankAccountNumber,
          bankCode: vendor.bankCode,
          currency: escrowAccount.currency,
        });
        await this.prisma.vendor.update({ where: { id: vendor.id }, data: { paystackRecipientCode: recipientCode } });
      }

      const reference = `potg_payout_${randomUUID()}`;
      const transfer = await this.paystack.initiateTransfer({
        amount,
        currency: escrowAccount.currency,
        recipientCode,
        reference,
        reason: `Milestone released: ${milestone.title}`,
      });
      const payout = await this.prisma.payout.create({
        data: {
          vendorId: vendor.id,
          projectId,
          milestoneId,
          amount,
          currency: escrowAccount.currency,
          status: transfer.status === 'success' ? 'paid' : 'processing',
          payoutMethod: 'bank_transfer',
          provider: 'paystack',
          providerReference: transfer.transferCode,
        },
      });
      if (transfer.status !== 'success') {
        // Paystack test-mode transfers normally complete immediately, but
        // this still handles the "pending"/"otp" cases honestly: escrow
        // stays untouched and the milestone stays open until verifyPayout
        // confirms it, same pessimistic-until-confirmed shape
        // verifyDeposit already uses for the other direction.
        return { payout, receipt: null };
      }
      return this.finalizePayout(escrowAccount, milestone, payout, vendor.accountId, amount);
    }

    // Real Flutterwave Transfer path — structurally simpler than
    // Paystack's: one call, no separate recipient object to create/cache
    // first (see FlutterwaveService's own comment).
    if (vendor.bankAccountNumber && vendor.bankCode && vendor.payoutProvider === 'flutterwave' && this.flutterwave.isConfigured) {
      const reference = `potg_payout_${randomUUID()}`;
      const transfer = await this.flutterwave.initiateTransfer({
        amount,
        currency: escrowAccount.currency,
        accountNumber: vendor.bankAccountNumber,
        bankCode: vendor.bankCode,
        accountName: vendor.bankAccountName ?? vendor.businessName,
        reference,
        reason: `Milestone released: ${milestone.title}`,
      });
      const payout = await this.prisma.payout.create({
        data: {
          vendorId: vendor.id,
          projectId,
          milestoneId,
          amount,
          currency: escrowAccount.currency,
          status: transfer.status === 'success' ? 'paid' : 'processing',
          payoutMethod: 'bank_transfer',
          provider: 'flutterwave',
          providerReference: transfer.transferReference,
        },
      });
      if (transfer.status !== 'success') {
        return { payout, receipt: null };
      }
      return this.finalizePayout(escrowAccount, milestone, payout, vendor.accountId, amount);
    }

    // Real PayPal Payout path — pays vendor.paypalPayoutEmail directly,
    // not a bank account at all (see PaypalService's own comment).
    if (vendor.paypalPayoutEmail && vendor.payoutProvider === 'paypal' && this.paypal.isConfigured) {
      const reference = `potg_payout_${randomUUID()}`;
      const transfer = await this.paypal.initiateTransfer({
        amount,
        currency: escrowAccount.currency,
        email: vendor.paypalPayoutEmail,
        reference,
        reason: `Milestone released: ${milestone.title}`,
      });
      const payout = await this.prisma.payout.create({
        data: {
          vendorId: vendor.id,
          projectId,
          milestoneId,
          amount,
          currency: escrowAccount.currency,
          status: transfer.status === 'success' ? 'paid' : 'processing',
          payoutMethod: 'bank_transfer',
          provider: 'paypal',
          providerReference: transfer.transferReference,
        },
      });
      if (transfer.status !== 'success') {
        return { payout, receipt: null };
      }
      return this.finalizePayout(escrowAccount, milestone, payout, vendor.accountId, amount);
    }

    const payout = await this.prisma.payout.create({
      data: {
        vendorId: vendor.id,
        projectId,
        milestoneId,
        amount,
        currency: escrowAccount.currency,
        status: 'pending',
      },
    });
    return this.finalizePayout(escrowAccount, milestone, payout, vendor.accountId, amount);
  }

  // Shared by the instant "manual" path above and verifyPayout below —
  // the one place that actually debits escrow, marks the milestone
  // completed, and issues the receipt, so a payout can only ever be
  // finalized once and the same way regardless of how it got there.
  private async finalizePayout(
    escrowAccount: { id: string; balance: unknown; currency: string },
    milestone: { id: string; title: string },
    payout: { id: string },
    vendorAccountId: string,
    amount: number,
  ) {
    const newBalance = Number(escrowAccount.balance) - amount;
    const [, updatedPayout] = await this.prisma.$transaction([
      this.prisma.escrowAccount.update({ where: { id: escrowAccount.id }, data: { balance: newBalance } }),
      this.prisma.payout.update({ where: { id: payout.id }, data: { status: 'paid', paidAt: new Date() } }),
      this.prisma.projectMilestone.update({ where: { id: milestone.id }, data: { status: 'completed' } }),
    ]);
    await this.prisma.escrowLedgerEntry.create({
      data: {
        escrowAccountId: escrowAccount.id,
        entryType: 'release',
        amount,
        balanceAfter: newBalance,
        relatedMilestoneId: milestone.id,
        relatedPayoutId: payout.id,
        notes: `Milestone released: ${milestone.title}`,
      },
    });
    const receipt = await this.prisma.receipt.create({
      data: {
        accountId: vendorAccountId,
        receiptNumber: receiptNumber(),
        payoutId: payout.id,
        amount,
        currency: escrowAccount.currency,
      },
    });
    return { payout: updatedPayout, receipt };
  }

  // The other half of the real payout path — asks whichever gateway
  // actually created this payout (payout.provider — see the schema
  // comment on why that field exists) directly whether a "processing"
  // transfer actually succeeded, rather than trusting anything the client
  // claims. Callable more than once safely: a payout that's already
  // "paid" just returns its existing receipt instead of debiting escrow
  // twice.
  async verifyPayout(projectId: string, payoutId: string) {
    const payout = await this.requireProcessingGatewayPayout(projectId, payoutId);
    if ('alreadyVerified' in payout) return payout;
    const result = await this.getPayoutGateway(payout.provider).fetchTransfer(payout.providerReference!);
    return this.applyTransferResult(projectId, payout, result);
  }

  // A newly created Paystack integration has OTP-based transfer
  // finalization on by default — see PaystackService.finalizeTransferOtp's
  // own comment. Confirmed live against this scaffold's own test key:
  // initiateTransfer in releaseMilestone came back "otp", not "success".
  // This relays whatever OTP the vendor/owner was sent (Paystack emails
  // or texts it to the account holder, not to this app) straight through.
  // Paystack-specific — Flutterwave/PayPal transfers don't have an OTP
  // step in this integration, so this refuses any payout that isn't
  // Paystack's rather than silently doing nothing useful with an OTP no
  // other gateway asked for.
  async finalizePayoutOtp(projectId: string, payoutId: string, otp: string) {
    const payout = await this.requireProcessingGatewayPayout(projectId, payoutId);
    if ('alreadyVerified' in payout) return payout;
    if (payout.provider !== 'paystack') {
      throw new BadRequestException(`A "${payout.provider}" payout doesn't use OTP finalization — check its status instead`);
    }
    const result = await this.paystack.finalizeTransferOtp(payout.providerReference!, otp);
    return this.applyTransferResult(projectId, payout, result);
  }

  // provider !== 'manual' is the correct "does this need real-gateway
  // verification" check now that a real payout can come from more than
  // one gateway — payoutMethod alone (the check this replaced) only ever
  // said "bank_transfer", which stopped being enough to know which
  // gateway's API to call once Flutterwave/PayPal could also produce one.
  private async requireProcessingGatewayPayout(projectId: string, payoutId: string) {
    const payout = await this.prisma.payout.findFirst({ where: { id: payoutId, projectId } });
    if (!payout) throw new NotFoundException('Payout not found on this project');
    if (payout.provider === 'manual') {
      throw new BadRequestException('Only a real-gateway payout needs verification');
    }
    if (payout.status === 'paid') {
      const receipt = await this.prisma.receipt.findUnique({ where: { payoutId: payout.id } });
      return { payout, receipt, alreadyVerified: true as const };
    }
    if (payout.status !== 'processing' || !payout.providerReference) {
      throw new BadRequestException(`This payout is "${payout.status}" — nothing to verify`);
    }
    return payout;
  }

  private getPayoutGateway(provider: string): { fetchTransfer(reference: string): Promise<{ status: string }> } {
    if (provider === 'paystack') return this.paystack;
    if (provider === 'flutterwave') return this.flutterwave;
    if (provider === 'paypal') return this.paypal;
    throw new BadRequestException(`Unknown payout provider "${provider}"`);
  }

  private async applyTransferResult(
    projectId: string,
    payout: { id: string; milestoneId: string | null; vendorId: string; amount: unknown },
    result: { status: string },
  ) {
    if (result.status === 'failed' || result.status === 'reversed') {
      const updated = await this.prisma.payout.update({ where: { id: payout.id }, data: { status: 'failed' } });
      return { payout: updated, receipt: null, alreadyVerified: false };
    }
    if (result.status !== 'success') {
      // Still "pending"/"otp" on Paystack's side — leave it "processing"
      // rather than guessing; the caller can check back later.
      return { payout, receipt: null, alreadyVerified: false };
    }

    if (!payout.milestoneId) {
      throw new BadRequestException('This payout has no milestone to complete');
    }
    const [escrowAccount, milestone, vendor] = await Promise.all([
      this.prisma.escrowAccount.findUniqueOrThrow({ where: { projectId } }),
      this.prisma.projectMilestone.findUniqueOrThrow({ where: { id: payout.milestoneId } }),
      this.prisma.vendor.findUniqueOrThrow({ where: { id: payout.vendorId } }),
    ]);
    const { payout: finalPayout, receipt } = await this.finalizePayout(
      escrowAccount,
      milestone,
      payout,
      vendor.accountId,
      Number(payout.amount),
    );
    return { payout: finalPayout, receipt, alreadyVerified: false };
  }

  findPayouts(projectId: string) {
    return this.prisma.payout.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  findReceipts(projectId: string) {
    return this.prisma.receipt.findMany({
      where: { OR: [{ payment: { projectId } }, { payout: { projectId } }] },
      orderBy: { issuedAt: 'desc' },
    });
  }

  // Module 19 Phase 1's "Payment alerts"-adjacent trigger — owner raised
  // this, so the other party is every vendor assigned to the project
  // (same "who's the other side" reasoning ProjectsService.addUpdate's
  // own comment gives for its identical assignment lookup).
  async raiseDispute(accountId: string, projectId: string, dto: RaiseDisputeDto) {
    const dispute = await this.prisma.dispute.create({
      data: {
        projectId,
        raisedByAccountId: accountId,
        milestoneId: dto.milestoneId,
        paymentId: dto.paymentId,
        payoutId: dto.payoutId,
        disputeType: dto.disputeType,
        reason: dto.reason,
      },
    });
    const assignments = await this.prisma.projectVendorAssignment.findMany({
      where: { projectId },
      select: { vendor: { select: { accountId: true } } },
    });
    for (const assignment of assignments) {
      this.notifications.notify(assignment.vendor.accountId, 'dispute_raised', 'A dispute was raised', dto.reason, '/vendors/me');
    }
    return dispute;
  }

  // Module 18 Phase 1's own new linkage — "Dispute cases should be
  // tightly linked to payments, orders, projects, and contracts" per the
  // engineering notes; orders had no dispute path at all before this.
  // Deliberately the one unified route both the buyer and the supplier
  // call (requireOrderParty allows either) — Order has no natural
  // "owner-side ABAC route" the way Project already did when the vendor-
  // side dispute routes were added, so there's no reason to split this
  // into two mirrored flavors the way raiseDispute/raiseDisputeAsVendor
  // are. Leases ("contracts"/tenant complaints) and listings (property-
  // listing disputes) are deliberately deferred — the engineering notes
  // name payments/orders/projects explicitly; leases and listings don't
  // have an equally explicit mandate, and generalizing to all four at
  // once risked missing something in each of Payments/Materials/
  // Properties/Listings for one pass.
  async raiseOrderDispute(accountId: string, orderId: string, dto: RaiseOrderDisputeDto) {
    const order = await this.requireOrderParty(orderId, accountId);
    const dispute = await this.prisma.dispute.create({
      data: { orderId, raisedByAccountId: accountId, disputeType: dto.disputeType, reason: dto.reason },
    });
    // Module 19 Phase 1's trigger — notify whichever side didn't raise
    // it, buyer or supplier.
    const supplier = await this.prisma.supplier.findUnique({ where: { id: order.supplierId }, select: { accountId: true } });
    const otherPartyAccountId = accountId === order.accountId ? supplier?.accountId : order.accountId;
    if (otherPartyAccountId) {
      this.notifications.notify(
        otherPartyAccountId,
        'dispute_raised',
        'A dispute was raised on your order',
        dto.reason,
        `/marketplace/materials/orders/${orderId}`,
      );
    }
    return dispute;
  }

  findOrderDisputes(accountId: string, orderId: string) {
    return this.requireOrderParty(orderId, accountId).then(() =>
      this.prisma.dispute.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } }),
    );
  }

  async resolveOrderDispute(accountId: string, disputeId: string, dto: ResolveDisputeDto) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || !dispute.orderId) throw new NotFoundException('Dispute not found');
    await this.requireOrderParty(dispute.orderId, accountId);
    return this.applyDisputeResolution(dispute, accountId, dto);
  }

  // Same dual-party shape MaterialsService.findOrder already established
  // (isBuyer/isSupplier) — duplicated rather than imported since
  // PaymentsService has no existing dependency on MaterialsService and
  // this is a three-line check, not worth a new cross-module wire for.
  // 404, not 403, matching requireDisputeParty's own "don't confirm a
  // dispute-adjacent resource exists" convention below, rather than
  // MaterialsService.findOrder's own 403 — this lives in the dispute
  // surface, not the orders one.
  private async requireOrderParty(orderId: string, accountId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    const supplier = await this.prisma.supplier.findUnique({ where: { id: order.supplierId } });
    if (order.accountId !== accountId && supplier?.accountId !== accountId) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  findDisputes(projectId: string) {
    return this.prisma.dispute.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  // The account-wide rollup the sidebar's "Payments" item has been missing
  // since the Payments & escrow pass — every route above is deliberately
  // nested under one project (`:projectId` ABAC), so there was never a
  // "give me the money picture across everything I own" query. This one
  // isn't project-scoped, so it filters by accountId directly instead of
  // relying on PermissionsGuard's `:projectId` convention.
  //
  // Money is never summed across currencies — a project's escrow, and the
  // deposits/releases against it, keep their own currency, so totals are
  // grouped by currency rather than added into one misleading number (the
  // same caution generate_portfolio_report's README comment already flags
  // for cross-property currency).
  async getAccountOverview(accountId: string) {
    const projects = await this.prisma.project.findMany({
      where: { accountId },
      select: {
        id: true,
        title: true,
        status: true,
        currency: true,
        property: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const projectIds = projects.map((p: { id: string }) => p.id);

    if (projectIds.length === 0) {
      return {
        projectCount: 0,
        escrowByCurrency: [],
        depositedByCurrency: [],
        releasedByCurrency: [],
        openDisputeCount: 0,
        projects: [],
      };
    }

    const [escrowAccounts, depositTotals, releaseTotals, disputes] = await Promise.all([
      this.prisma.escrowAccount.findMany({ where: { projectId: { in: projectIds } } }),
      this.prisma.payment.groupBy({
        by: ['currency'],
        where: { projectId: { in: projectIds }, status: 'completed' },
        _sum: { amount: true },
      }),
      this.prisma.payout.groupBy({
        by: ['currency'],
        where: { projectId: { in: projectIds }, status: { not: 'failed' } },
        _sum: { amount: true },
      }),
      this.prisma.dispute.findMany({
        where: { projectId: { in: projectIds }, status: { in: ['open', 'under_review'] } },
        select: { id: true, projectId: true },
      }),
    ]);

    const escrowByCurrency = new Map<string, number>();
    for (const e of escrowAccounts as { currency: string; balance: unknown }[]) {
      escrowByCurrency.set(e.currency, (escrowByCurrency.get(e.currency) ?? 0) + Number(e.balance));
    }
    const escrowByProject = new Map(
      (escrowAccounts as { projectId: string; currency: string; balance: unknown; status: string }[]).map((e) => [
        e.projectId,
        e,
      ]),
    );
    const disputeCountByProject = new Map<string, number>();
    for (const d of disputes as { projectId: string }[]) {
      disputeCountByProject.set(d.projectId, (disputeCountByProject.get(d.projectId) ?? 0) + 1);
    }

    return {
      projectCount: projects.length,
      escrowByCurrency: Array.from(escrowByCurrency, ([currency, balance]) => ({ currency, balance })),
      depositedByCurrency: (depositTotals as { currency: string; _sum: { amount: unknown } }[]).map((d) => ({
        currency: d.currency,
        total: Number(d._sum.amount ?? 0),
      })),
      releasedByCurrency: (releaseTotals as { currency: string; _sum: { amount: unknown } }[]).map((r) => ({
        currency: r.currency,
        total: Number(r._sum.amount ?? 0),
      })),
      openDisputeCount: disputes.length,
      projects: projects.map((p: { id: string; title: string; status: string; currency: string; property: { name: string } }) => {
        const escrow = escrowByProject.get(p.id);
        return {
          projectId: p.id,
          title: p.title,
          propertyName: p.property?.name ?? null,
          status: p.status,
          currency: p.currency,
          escrowBalance: escrow ? Number(escrow.balance) : 0,
          escrowCurrency: escrow?.currency ?? p.currency,
          escrowStatus: escrow?.status ?? 'not_funded',
          openDisputeCount: disputeCountByProject.get(p.id) ?? 0,
        };
      }),
    };
  }

  // Closes half of the gap the README used to flag: "any account member
  // with dispute:write can both raise and resolve a dispute." There's
  // still no neutral third party in this scaffold's RBAC (same limitation
  // as document verification), but the account that raised a dispute can
  // no longer be the one that resolves it in its own favor — on a project,
  // the only other party able to act is whichever side (owner or vendor)
  // didn't raise it. That's a real check, not a full neutral-reviewer
  // workflow; still open, see the README.
  //
  // The check itself lives in this one private method so both sides of a
  // project share it: the owner-side route below (already ABAC-scoped to
  // its own project by PermissionsGuard) and VendorsService's vendor-side
  // route (which has no :projectId to lean on, so it checks a
  // ProjectVendorAssignment itself before ever reaching here).
  // The two-party path and platform_reviewer arbitration used to be able
  // to collide on the same dispute — this method only checked for an
  // already-final status (resolved/rejected), not `under_review`, so
  // either party could still call resolveDispute/resolveDisputeAsVendor
  // and silently overwrite a reviewer's in-progress arbitration (including
  // clearing resolvedAt back to a fresh value) after that reviewer had
  // explicitly said "I'm looking into this, send more evidence." Once a
  // platform_reviewer touches a dispute, the two-party path is locked out
  // for good — arbitration supersedes it, it doesn't merely pause it; a
  // dispute a reviewer has taken on stays theirs to resolve, even if they
  // set it back to `under_review` a second time.
  private async applyDisputeResolution(
    dispute: { id: string; raisedByAccountId: string; status: string },
    resolvingAccountId: string,
    dto: ResolveDisputeDto,
  ) {
    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      throw new ConflictException('This dispute has already been resolved');
    }
    if (dispute.status === 'under_review') {
      throw new ConflictException(
        'A platform reviewer is arbitrating this dispute — submit evidence instead, the two-party resolution path is no longer available on it',
      );
    }
    if (dispute.raisedByAccountId === resolvingAccountId) {
      throw new ForbiddenException(
        'The account that raised this dispute cannot resolve it — the other party needs to weigh in',
      );
    }
    return this.prisma.dispute.update({
      where: { id: dispute.id },
      data: { status: dto.status, resolutionNotes: dto.resolutionNotes, resolvedAt: new Date() },
    });
  }

  async resolveDispute(projectId: string, disputeId: string, resolvingAccountId: string, dto: ResolveDisputeDto) {
    const dispute = await this.prisma.dispute.findFirst({ where: { id: disputeId, projectId } });
    if (!dispute) throw new NotFoundException('Dispute not found on this project');
    return this.applyDisputeResolution(dispute, resolvingAccountId, dto);
  }

  // The structured "submit more evidence" channel the under_review
  // evidence-request step was missing — see DisputeEvidence's own schema
  // comment. Shared by both parties (owner and assigned vendor), unlike
  // applyDisputeResolution's raisedByAccountId check: submitting evidence
  // isn't a decision either side could tilt in its own favor the way
  // resolving one could, so there's no reason to stop whichever side
  // raised it from also adding to the record.
  // Module 18 Phase 1 — branches on which of projectId/orderId this
  // dispute actually has, so submitDisputeEvidence/findDisputeEvidence
  // below work unchanged for either kind: an order dispute's evidence
  // route (MaterialsController) calls the exact same two methods a
  // project dispute's does (PaymentsController/VendorsController).
  private async requireDisputeParty(disputeId: string, accountId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { project: { select: { id: true, accountId: true } } },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.orderId) {
      await this.requireOrderParty(dispute.orderId, accountId);
      return dispute;
    }
    if (dispute.project?.accountId === accountId) return dispute;
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId } });
    if (vendor) {
      const assignment = await this.prisma.projectVendorAssignment.findFirst({
        where: { projectId: dispute.projectId ?? undefined, vendorId: vendor.id },
      });
      // 404, not 403 — same "don't confirm this dispute exists" shape
      // resolveDisputeAsVendor already uses for an unrelated vendor.
      if (assignment) return dispute;
    }
    throw new NotFoundException('Dispute not found');
  }

  async submitDisputeEvidence(disputeId: string, accountId: string, userId: string, dto: SubmitDisputeEvidenceDto) {
    const dispute = await this.requireDisputeParty(disputeId, accountId);
    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      throw new BadRequestException('This dispute has already been resolved — nothing more to submit');
    }
    return this.prisma.disputeEvidence.create({
      data: { disputeId, accountId, submittedByUserId: userId, note: dto.note, fileUrl: dto.fileUrl },
    });
  }

  async findDisputeEvidence(disputeId: string, accountId: string) {
    await this.requireDisputeParty(disputeId, accountId);
    return this.prisma.disputeEvidence.findMany({ where: { disputeId }, orderBy: { createdAt: 'asc' } });
  }

  // Module 6's actual neutral-reviewer path for disputes, the payments
  // counterpart to VendorsService.setVerificationStatus /
  // MaterialsService.setSupplierVerificationStatus. Gated on
  // dispute:arbitrate, which only the platform_reviewer role carries — a
  // role that never gets dispute:write, so it structurally can never be
  // the account that raised the dispute it's arbitrating. That's why this
  // skips applyDisputeResolution's raisedByAccountId check entirely rather
  // than reusing it: that check exists to stop the *other* party
  // (owner/vendor) from self-resolving, which isn't the risk here.
  // Includes the evidence thread directly — an arbitrator deciding blind
  // wouldn't be arbitrating anything, same reasoning
  // DocumentsService.findPendingForArbitration includes the uploading
  // account's and property's names for.
  findOpenDisputesForArbitration() {
    return this.prisma.dispute.findMany({
      where: { status: { in: ['open', 'under_review'] } },
      include: {
        project: { select: { id: true, title: true, accountId: true } },
        // Module 18 Phase 1 — an order dispute has no project at all, so
        // the arbitrator needs the order's own identifying info instead;
        // both are optionally included and the web UI renders whichever
        // is actually present on a given dispute.
        order: { select: { id: true, accountId: true, supplier: { select: { businessName: true } } } },
        evidence: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // "under_review" (see ArbitrateDisputeDto) is the evidence-request step
  // the README used to flag as missing from every neutral-reviewer path:
  // the arbitrator can now say "not enough to decide yet" instead of only
  // ever resolving or rejecting outright. It's deliberately not terminal —
  // resolvedAt only gets set for resolved/rejected — so a dispute the
  // arbitrator put under review stays in findOpenDisputesForArbitration
  // (already filters `{ in: ['open', 'under_review'] }`) and keeps
  // holding its milestone/payment (every other query in this file already
  // treats the two the same way), and this same method can be called
  // again later to make the actual call once more evidence shows up
  // somewhere the arbitrator can see it (a project update, a reply on the
  // dispute's own project) — the status guard below only ever blocks a
  // dispute that's already resolved/rejected, "under_review" passes
  // through it same as "open" always did.
  async arbitrateDispute(disputeId: string, dto: ArbitrateDisputeDto) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      throw new ConflictException('This dispute has already been resolved');
    }
    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: dto.status,
        resolutionNotes: dto.resolutionNotes,
        resolvedAt: dto.status === 'under_review' ? null : new Date(),
      },
    });
  }

  // The vendor-side counterpart to resolveDispute above — deliberately not
  // under /projects/:projectId/..., same reasoning as submitQuote, so it
  // looks the dispute up by id alone and checks a ProjectVendorAssignment
  // itself instead of relying on PermissionsGuard's ABAC. 404s (not 403)
  // for a dispute on a project this vendor isn't assigned to, so it can't
  // be used to probe which disputes exist on projects it has nothing to
  // do with.
  async resolveDisputeAsVendor(vendorAccountId: string, disputeId: string, dto: ResolveDisputeDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId: vendorAccountId } });
    if (!vendor) throw new NotFoundException('Dispute not found');
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute || !dispute.projectId) throw new NotFoundException('Dispute not found');
    const assignment = await this.prisma.projectVendorAssignment.findFirst({
      where: { projectId: dispute.projectId, vendorId: vendor.id },
    });
    if (!assignment) throw new NotFoundException('Dispute not found');
    return this.applyDisputeResolution(dispute, vendorAccountId, dto);
  }

  // Vendor-side raise/read, same shape as submitQuote/myQuotes: the vendor
  // is never assumed to be the project's owning account, so these key off
  // ProjectVendorAssignment instead of PermissionsGuard's :projectId ABAC.
  async raiseDisputeAsVendor(vendorAccountId: string, dto: RaiseDisputeDto & { projectId: string }) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId: vendorAccountId } });
    if (!vendor) {
      throw new BadRequestException('This account has no vendor profile yet — create one with POST /vendors first');
    }
    const assignment = await this.prisma.projectVendorAssignment.findFirst({
      where: { projectId: dto.projectId, vendorId: vendor.id },
    });
    if (!assignment) {
      throw new BadRequestException('This vendor is not assigned to this project');
    }
    const dispute = await this.prisma.dispute.create({
      data: {
        projectId: dto.projectId,
        raisedByAccountId: vendorAccountId,
        milestoneId: dto.milestoneId,
        paymentId: dto.paymentId,
        payoutId: dto.payoutId,
        disputeType: dto.disputeType,
        reason: dto.reason,
      },
    });
    // Module 19 Phase 1's trigger — vendor raised it, notify the
    // project's owning account.
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId }, select: { accountId: true } });
    if (project) {
      this.notifications.notify(project.accountId, 'dispute_raised', 'A dispute was raised', dto.reason, `/projects/${dto.projectId}`);
    }
    return dispute;
  }

  async findDisputesForVendor(vendorAccountId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId: vendorAccountId } });
    if (!vendor) return [];
    const assignments = await this.prisma.projectVendorAssignment.findMany({
      where: { vendorId: vendor.id },
      select: { projectId: true },
    });
    const projectIds = assignments.map((a: { projectId: string }) => a.projectId);
    if (projectIds.length === 0) return [];
    return this.prisma.dispute.findMany({
      where: { projectId: { in: projectIds } },
      include: { project: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
