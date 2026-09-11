import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from '../payments/paystack.service';
import { FlutterwaveService } from '../payments/flutterwave.service';
import { PaypalService } from '../payments/paypal.service';
import { StripeService } from '../payments/stripe.service';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';
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
  private readonly logger = new Logger(PackagesService.name);
  private readonly subscriptionGateways: Record<string, SubscriptionGateway>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly flutterwave: FlutterwaveService,
    private readonly paypal: PaypalService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly notifications: InAppNotificationsService,
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
    // Real auto-renewal (see PaystackService.chargeAuthorization) only
    // works off a Paystack reusable-card token — refuse the combination
    // up front rather than silently ignoring the flag for a provider that
    // can never honor it.
    if (dto.autoRenew && dto.provider !== 'paystack') {
      throw new BadRequestException('Auto-renew is only available when paying with Paystack');
    }

    const pkg = await this.prisma.visibilityPackage.findFirst({ where: { id: dto.packageId, active: true } });
    if (!pkg) throw new NotFoundException('Package not found');

    const amount = Number(pkg.price);
    const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
    const payerEmail = payableEmail(email);

    if (dto.provider === 'paystack') {
      const reference = `potg_pkg_${randomUUID()}`;
      const { authorizationUrl } = await this.paystack.initializeTransaction({
        email: payerEmail,
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
          payerEmail,
          // The requested intent — verifySubscription's own paystack
          // branch downgrades this to false if Paystack's own charge
          // turns out not to be reusable, so what ends up persisted once
          // "active" always reflects what's actually possible, not just
          // what was asked for.
          autoRenew: !!dto.autoRenew,
        },
      });
      return { subscription, authorizationUrl };
    }

    const gateway = dto.provider ? this.subscriptionGateways[dto.provider] : undefined;
    if (gateway) {
      const reference = `potg_pkg_${randomUUID()}`;
      const init = await gateway.initializeTransaction({
        email: payerEmail,
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
          payerEmail,
        },
      });
      return { subscription, authorizationUrl: init.authorizationUrl };
    }

    // Manual — the same instant-complete simulation Payment/Order both
    // use elsewhere in this scaffold. Activates immediately, no separate
    // verify step, never auto-renewable (there's no real card to charge
    // again).
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
        payerEmail,
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
      return { subscription: await this.activate(subscription, result.authorizationCode), alreadyVerified: false };
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

  private activate(
    subscription: { id: string; autoRenew: boolean; package: { billingPeriod: string } },
    authorizationCode?: string | null,
  ) {
    const now = new Date();
    return this.prisma.packageSubscription.update({
      where: { id: subscription.id },
      data: {
        status: 'active',
        startedAt: now,
        expiresAt: addBillingPeriod(now, subscription.package.billingPeriod),
        authorizationCode: authorizationCode ?? null,
        // Downgraded to false if the requested auto-renew never got a
        // usable reusable-card token back — see subscribe's own comment.
        autoRenew: subscription.autoRenew && !!authorizationCode,
      },
      include: { package: true },
    });
  }

  // Turn auto-renew on or off for an existing subscription — the real
  // "cancel my subscription" action (stops future charges) without
  // touching what's already been paid for: status/expiresAt on this row
  // are untouched either way, so turning it off just lets the current
  // boost run out naturally instead of renewing into a new row. Turning
  // it on is only possible when this exact row already has a reusable
  // card on file (captured at subscribe/verify time) — there's no way to
  // retroactively attach one to a subscription that never got one.
  async setAutoRenew(accountId: string, subscriptionId: string, autoRenew: boolean) {
    const subscription = await this.prisma.packageSubscription.findFirst({ where: { id: subscriptionId, accountId } });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (autoRenew && !subscription.authorizationCode) {
      throw new BadRequestException('This subscription has no reusable card on file — only a Paystack subscription can auto-renew');
    }
    return this.prisma.packageSubscription.update({
      where: { id: subscription.id },
      data: { autoRenew },
      include: { package: true },
    });
  }

  // A real, callable-any-time renewal for one specific subscription — the
  // account's own "renew now" button, and (called with no ownership check
  // from PackagesSchedulerService's own cron) the exact same code path an
  // automatic renewal runs, same "the cron and the manual trigger share
  // one real method" shape ReportsSchedulerService.sendDueDigests already
  // establishes for the digest cron.
  async renewNow(accountId: string, subscriptionId: string) {
    const subscription = await this.prisma.packageSubscription.findFirst({
      where: { id: subscriptionId, accountId },
      include: { package: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (subscription.status !== 'active') {
      throw new BadRequestException(`This subscription is "${subscription.status}" — nothing to renew`);
    }
    return this.chargeRenewal(subscription);
  }

  // The actual charge — a real POST to Paystack's charge_authorization
  // endpoint, no cardholder present, same amount/currency mismatch rigor
  // verifyDeposit's own Paystack branch already applies. Renews at the
  // package's *current* catalog price, not the historical amount the
  // original row paid (a package's own price can change between cycles).
  // Always ends by flipping autoRenew off the row being renewed, whether
  // this succeeds or fails — success because the new row it just created
  // is now the one auto-renew lives on; failure because this scaffold
  // deliberately has no retry/dunning logic (see README), so a declined
  // card just ends the chain and notifies the account to resubscribe
  // manually rather than silently retrying forever.
  private async chargeRenewal(subscription: {
    id: string;
    accountId: string;
    packageId: string;
    authorizationCode: string | null;
    payerEmail: string | null;
    package: { price: unknown; currency: string; billingPeriod: string; title: string };
  }) {
    if (!subscription.authorizationCode || !subscription.payerEmail) {
      throw new BadRequestException('This subscription has no reusable card on file to renew automatically');
    }

    const amount = Number(subscription.package.price);
    const reference = `potg_pkg_renew_${randomUUID()}`;

    try {
      const result = await this.paystack.chargeAuthorization({
        authorizationCode: subscription.authorizationCode,
        email: subscription.payerEmail,
        amount,
        currency: subscription.package.currency,
        reference,
      });
      const expectedKobo = Math.round(amount * 100);
      if (result.status !== 'success' || result.amountKobo !== expectedKobo || result.currency !== subscription.package.currency) {
        throw new BadRequestException(`Paystack didn't confirm this renewal charge (status: ${result.status})`);
      }

      const now = new Date();
      const renewed = await this.prisma.packageSubscription.create({
        data: {
          accountId: subscription.accountId,
          packageId: subscription.packageId,
          status: 'active',
          amount,
          currency: subscription.package.currency,
          provider: 'paystack',
          providerReference: reference,
          authorizationCode: subscription.authorizationCode,
          payerEmail: subscription.payerEmail,
          autoRenew: true,
          renewedFromId: subscription.id,
          startedAt: now,
          expiresAt: addBillingPeriod(now, subscription.package.billingPeriod),
        },
        include: { package: true },
      });
      await this.prisma.packageSubscription.update({ where: { id: subscription.id }, data: { autoRenew: false } });
      this.notifications.notify(
        subscription.accountId,
        'package_renewed',
        'Boost renewed',
        `Your ${subscription.package.title} boost was automatically renewed until ${renewed.expiresAt!.toISOString().slice(0, 10)}.`,
        '/packages',
      );
      return renewed;
    } catch (err) {
      await this.prisma.packageSubscription.update({ where: { id: subscription.id }, data: { autoRenew: false } }).catch(() => undefined);
      this.notifications.notify(
        subscription.accountId,
        'package_renewal_failed',
        'Auto-renewal failed',
        `We couldn't automatically renew your ${subscription.package.title} boost — subscribe again to keep it active.`,
        '/packages',
      );
      throw err;
    }
  }

  // The scheduled half — see PackagesSchedulerService's own daily @Cron.
  // Renews up to 24h before a subscription's own expiresAt (rather than
  // exactly on it) so a boost never has a real gap between one cycle
  // ending and the next one starting.
  async processAutoRenewals(): Promise<{ attempted: number; renewed: number; failed: number }> {
    const dueBy = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const due = await this.prisma.packageSubscription.findMany({
      where: {
        autoRenew: true,
        status: 'active',
        provider: 'paystack',
        authorizationCode: { not: null },
        expiresAt: { lte: dueBy },
      },
      include: { package: true },
    });

    let renewed = 0;
    let failed = 0;
    for (const subscription of due) {
      try {
        await this.chargeRenewal(subscription);
        renewed++;
      } catch (err) {
        failed++;
        this.logger.error(
          `Auto-renewal failed for subscription ${subscription.id} (account ${subscription.accountId}): ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return { attempted: due.length, renewed, failed };
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
