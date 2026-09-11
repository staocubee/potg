import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from '../payments/paystack.service';
import { FlutterwaveService } from '../payments/flutterwave.service';
import { PaypalService } from '../payments/paypal.service';
import { StripeService } from '../payments/stripe.service';
import { SubscribePackageDto } from './dto/subscribe-package.dto';

// Same shape as PaymentsService's own (unexported) DepositGateway — a
// package purchase is a one-off charge, not tied to any escrow account,
// so this duplicates the shape rather than trying to share Payment (its
// projectId/escrowAccountId columns are both NOT NULL — see that model's
// own schema comment — there's no project or escrow for a visibility
// package to attach to).
interface SubscriptionGateway {
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

function addBillingPeriod(from: Date, billingPeriod: string): Date {
  const d = new Date(from);
  if (billingPeriod === 'annual') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    // "monthly", and any value this scaffold doesn't recognize — falls
    // back to the shorter period rather than silently granting a full
    // year of boost for an unrecognized billingPeriod.
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

@Injectable()
export class PackagesService {
  private readonly subscriptionGateways: Record<string, SubscriptionGateway>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly flutterwave: FlutterwaveService,
    private readonly paypal: PaypalService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {
    this.subscriptionGateways = {
      flutterwave: this.flutterwave,
      stripe: this.stripe,
      paypal: {
        initializeTransaction: (params) => this.paypal.initializeTransaction(params),
        verifyTransaction: (reference) => this.paypal.verifyTransaction(reference),
      },
    };
  }

  findCatalog() {
    return this.prisma.visibilityPackage.findMany({
      where: { active: true },
      orderBy: [{ boostWeight: 'desc' }, { price: 'asc' }],
    });
  }

  findMySubscriptions(accountId: string) {
    return this.prisma.packageSubscription.findMany({
      where: { accountId },
      include: { package: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The account's own current boost, if any — same "active AND not yet
  // expired" live computation as boost.util.ts's getActiveBoostMap, just
  // narrowed to one account for the "My packages" screen's own summary
  // card rather than every boosted account platform-wide.
  getMyActiveBoost(accountId: string) {
    return this.prisma.packageSubscription.findFirst({
      where: { accountId, status: 'active', expiresAt: { gt: new Date() } },
      include: { package: true },
      orderBy: [{ package: { boostWeight: 'desc' } }, { expiresAt: 'desc' }],
    });
  }

  // Subscribing to a package it already holds an active boost from just
  // stacks a second (pending, then active) row rather than being refused
  // — same "renewing is just subscribing again" model the schema comment
  // on PackageSubscription describes; getMyActiveBoost/getActiveBoostMap
  // both already pick whichever active row has the highest boostWeight
  // (and, among ties, the furthest expiry), so an early renewal only ever
  // extends the account's own effective boost, never shortens it.
  async subscribe(accountId: string, email: string, dto: SubscribePackageDto) {
    const pkg = await this.prisma.visibilityPackage.findFirst({ where: { id: dto.packageId, active: true } });
    if (!pkg) throw new NotFoundException('Package not found');

    const amount = Number(pkg.price);
    const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');

    if (dto.provider === 'paystack') {
      const reference = `potg_pkg_${randomUUID()}`;
      const { authorizationUrl } = await this.paystack.initializeTransaction({
        email: payableEmail(email),
        amount,
        currency: pkg.currency,
        reference,
        callbackUrl: `${webAppUrl}/packages?subscriptionReference=${reference}`,
        metadata: { accountId, packageId: pkg.id },
      });
      const subscription = await this.prisma.packageSubscription.create({
        data: {
          accountId,
          packageId: pkg.id,
          amount,
          currency: pkg.currency,
          provider: 'paystack',
          providerReference: reference,
          status: 'pending',
        },
      });
      return { subscription, authorizationUrl };
    }

    const gateway = dto.provider ? this.subscriptionGateways[dto.provider] : undefined;
    if (gateway) {
      const reference = `potg_pkg_${randomUUID()}`;
      const init = await gateway.initializeTransaction({
        email: payableEmail(email),
        amount,
        currency: pkg.currency,
        reference,
        callbackUrl: `${webAppUrl}/packages?subscriptionReference=${reference}`,
        metadata: { accountId, packageId: pkg.id },
      });
      const subscription = await this.prisma.packageSubscription.create({
        data: {
          accountId,
          packageId: pkg.id,
          amount,
          currency: pkg.currency,
          provider: dto.provider!,
          providerReference: init.reference,
          status: 'pending',
        },
      });
      return { subscription, authorizationUrl: init.authorizationUrl };
    }

    // Manual — the same instant-complete simulation Payment/Order both
    // use elsewhere in this scaffold. Activates immediately, no separate
    // verify step.
    const now = new Date();
    const subscription = await this.prisma.packageSubscription.create({
      data: {
        accountId,
        packageId: pkg.id,
        amount,
        currency: pkg.currency,
        provider: dto.provider ?? 'manual',
        status: 'active',
        startedAt: now,
        expiresAt: addBillingPeriod(now, pkg.billingPeriod),
      },
    });
    return { subscription };
  }

  // The other half of the real-gateway path above — mirrors
  // PaymentsService.verifyDeposit's own shape (including its Paystack-
  // specific kobo comparison vs. the generic major-unit comparison every
  // other gateway shares), just crediting a boost period instead of an
  // escrow balance on success.
  async verifySubscription(accountId: string, subscriptionId: string) {
    const subscription = await this.prisma.packageSubscription.findFirst({
      where: { id: subscriptionId, accountId },
      include: { package: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');

    if (subscription.status === 'active') {
      return { subscription, alreadyVerified: true };
    }
    if (subscription.status !== 'pending' || !subscription.providerReference) {
      throw new BadRequestException(`This subscription is "${subscription.status}" — nothing to verify`);
    }

    if (subscription.provider === 'paystack') {
      const result = await this.paystack.verifyTransaction(subscription.providerReference);
      if (result.status === 'failed') {
        const updated = await this.prisma.packageSubscription.update({ where: { id: subscription.id }, data: { status: 'failed' } });
        return { subscription: updated, alreadyVerified: false };
      }
      if (result.status !== 'success') {
        return { subscription, alreadyVerified: false };
      }
      const expectedKobo = Math.round(Number(subscription.amount) * 100);
      if (result.amountKobo !== expectedKobo || result.currency !== subscription.currency) {
        throw new BadRequestException(
          `Paystack confirmed a different amount/currency than expected (got ${result.amountKobo / 100} ${result.currency})`,
        );
      }
      return { subscription: await this.activate(subscription), alreadyVerified: false };
    }

    const gateway = this.subscriptionGateways[subscription.provider];
    if (!gateway) {
      throw new BadRequestException('Only a real-gateway subscription needs verification');
    }
    const result = await gateway.verifyTransaction(subscription.providerReference);
    if (result.status === 'failed') {
      const updated = await this.prisma.packageSubscription.update({ where: { id: subscription.id }, data: { status: 'failed' } });
      return { subscription: updated, alreadyVerified: false };
    }
    if (result.status !== 'success') {
      return { subscription, alreadyVerified: false };
    }
    if (Math.abs(result.amount - Number(subscription.amount)) > 0.01 || result.currency !== subscription.currency) {
      throw new BadRequestException(
        `${subscription.provider} confirmed a different amount/currency than expected (got ${result.amount} ${result.currency})`,
      );
    }
    return { subscription: await this.activate(subscription), alreadyVerified: false };
  }

  private activate(subscription: { id: string; package: { billingPeriod: string } }) {
    const now = new Date();
    return this.prisma.packageSubscription.update({
      where: { id: subscription.id },
      data: { status: 'active', startedAt: now, expiresAt: addBillingPeriod(now, subscription.package.billingPeriod) },
      include: { package: true },
    });
  }
}

// Same reserved-TLD guard PaymentsService's own payableEmail keeps — a
// duplicated four-line function, not a shared import, for the same
// "these two services don't otherwise depend on each other" reasoning
// SubscriptionGateway's own comment gives.
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
