import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Module 19 Phase 1's own in-app channel — see Notification's own schema
// comment for why this is the one new channel this pass builds. Named
// distinctly from EmailService (the other real channel already in this
// module) rather than "NotificationsService", which would collide in
// spirit with the module's own name and blur which of the two channels a
// given call site actually means.
@Injectable()
export class InAppNotificationsService {
  private readonly logger = new Logger(InAppNotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Every real-time trigger below calls this fire-and-forget (`.catch()`,
  // never awaited-and-thrown) — same "an enrichment failing shouldn't
  // fail the action that triggered it" reasoning
  // PropertiesService.indexEmbedding's own call sites already establish.
  // A notification that never got created is a real loss, but a smaller
  // one than the project update / dispute / inquiry itself failing to
  // save because notifying about it didn't work.
  notify(accountId: string, type: string, title: string, body: string, link?: string) {
    return this.prisma.notification.create({ data: { accountId, type, title, body, link } }).catch((err) => {
      this.logger.warn(`Failed to create ${type} notification for account ${accountId}: ${err instanceof Error ? err.message : err}`);
    });
  }

  findMine(accountId: string) {
    return this.prisma.notification.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(accountId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.accountId !== accountId) {
      throw new NotFoundException('Notification not found');
    }
    return this.prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }

  async markAllRead(accountId: string) {
    await this.prisma.notification.updateMany({ where: { accountId, readAt: null }, data: { readAt: new Date() } });
    return { updated: true };
  }

  // The scheduled half of "event-driven notification triggers" — the
  // other half being the real-time hooks in Projects/Properties/
  // Payments/Listings. Deduplicated by checking for an existing
  // notification with the same account/type/link rather than a separate
  // "already notified" column: a document only ever has one Phase-1
  // notification worth sending about it, so its own link (which encodes
  // the document id) is already a unique-enough key. Mirrors
  // ReportsSchedulerService's own "manual trigger reuses the exact cron
  // method" shape — see NotificationsController.checkDocumentExpiry.
  //
  // Module 21 Phase 1's own "Time-zone aware notifications" — targetLocalHour,
  // when given, restricts this run to accounts where it's currently that
  // hour in the account's *own* Account.timezone (captured at signup,
  // never once read anywhere until now — same "dead field" shape
  // Account.status was in before Module 16's own pass). Omitted (the
  // manual/admin trigger's own default), this checks every account
  // regardless of local time — the "verify without waiting for the right
  // hour anywhere" path. NotificationsSchedulerService's own real cron is
  // the one caller that always passes it.
  async checkDocumentExpiry(daysAhead = 30, targetLocalHour?: number) {
    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    const expiring = await this.prisma.document.findMany({
      where: { expiryDate: { not: null, lte: cutoff, gte: new Date() } },
      select: { id: true, accountId: true, documentType: true, expiryDate: true, account: { select: { timezone: true } } },
    });

    let created = 0;
    for (const doc of expiring) {
      if (targetLocalHour != null && !isCurrentlyLocalHour(doc.account.timezone, targetLocalHour)) continue;
      const link = `/documents#${doc.id}`;
      const already = await this.prisma.notification.findFirst({
        where: { accountId: doc.accountId, type: 'document_expiring', link },
      });
      if (already) continue;
      await this.notify(
        doc.accountId,
        'document_expiring',
        'Document expiring soon',
        `Your ${doc.documentType.replace(/_/g, ' ')} expires on ${doc.expiryDate!.toLocaleDateString()}.`,
        link,
      );
      created += 1;
    }
    return { checked: expiring.length, created };
  }

  // The workflow audit's own finding: rent-overdue and lease-ending-soon
  // were both real, but purely reactive — computed only when a report/AI
  // query ran, never pushed. Same 30-day-per-period approximation
  // reports.service.ts's isLeaseOverdue and lease-risk-flags.ts's
  // overdueDays already use — deliberately a THIRD copy of that same
  // small formula rather than a shared import, matching this codebase's
  // own "duplicate, don't share" convention for a computation this small
  // (see this file's own precedent with checkDocumentExpiry).
  //
  // Notifies both sides where real: the landlord's own account always
  // (this account.property relation is how a lease reaches its owner),
  // and the tenant's own account too, only when `Lease.tenantAccountId`
  // is actually linked — Workflow 8's step names the tenant specifically,
  // but an owner with no linked tenant account still deserves to know
  // rent is overdue, since nothing else would ever tell them either.
  async checkLeaseReminders(renewalWindowDays = 60, targetLocalHour?: number) {
    const leases = await this.prisma.lease.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        tenantName: true,
        tenantAccountId: true,
        rentFrequency: true,
        startDate: true,
        endDate: true,
        rentPayments: { select: { periodEnd: true } },
        property: { select: { id: true, accountId: true, account: { select: { timezone: true } } } },
      },
    });

    let created = 0;
    for (const lease of leases) {
      if (targetLocalHour != null && !isCurrentlyLocalHour(lease.property.account.timezone, targetLocalHour)) continue;

      const periodDays = RENT_FREQUENCY_DAYS[lease.rentFrequency] ?? RENT_FREQUENCY_DAYS.monthly;
      const anchor =
        lease.rentPayments.length > 0
          ? new Date(Math.max(...lease.rentPayments.map((p) => p.periodEnd.getTime())))
          : lease.startDate;
      const daysSinceAnchor = (Date.now() - anchor.getTime()) / (1000 * 60 * 60 * 24);
      const overdueDays = Math.floor(daysSinceAnchor - periodDays);

      if (overdueDays > 0) {
        // Keyed to this specific unpaid period (via the anchor date), not
        // just the lease — once a new rent payment moves the anchor
        // forward, a real reminder can fire again for the *next* overdue
        // period instead of this lease only ever getting one reminder ever.
        created += await this.notifyLeaseEvent(
          lease.property.id,
          lease.property.accountId,
          lease.tenantAccountId,
          'rent_overdue',
          'Rent overdue',
          `${lease.tenantName}'s rent looks about ${overdueDays} day(s) overdue.`,
          `rent-${lease.id}-${anchor.toISOString().slice(0, 10)}`,
        );
      }

      if (lease.endDate) {
        const daysUntilEnd = (lease.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysUntilEnd > 0 && daysUntilEnd <= renewalWindowDays) {
          created += await this.notifyLeaseEvent(
            lease.property.id,
            lease.property.accountId,
            lease.tenantAccountId,
            'lease_ending_soon',
            'Lease ending soon',
            `${lease.tenantName}'s lease ends on ${lease.endDate.toLocaleDateString()}.`,
            `lease-ending-${lease.id}`,
          );
        }
      }
    }
    return { checked: leases.length, created };
  }

  // Shared by both lease-reminder branches above: notifies the landlord's
  // own account unconditionally, and the tenant's own account too when a
  // real one is linked — each gets its own link (its own relevant page),
  // so each side's own idempotency check (accountId + type + link) is
  // independent of the other.
  private async notifyLeaseEvent(
    propertyId: string,
    landlordAccountId: string,
    tenantAccountId: string | null,
    type: string,
    title: string,
    body: string,
    dedupeKey: string,
  ): Promise<number> {
    let created = 0;
    const landlordLink = `/properties/${propertyId}#${dedupeKey}`;
    const landlordAlready = await this.prisma.notification.findFirst({
      where: { accountId: landlordAccountId, type, link: landlordLink },
    });
    if (!landlordAlready) {
      await this.notify(landlordAccountId, type, title, body, landlordLink);
      created += 1;
    }

    if (tenantAccountId) {
      const tenantLink = `/tenant#${dedupeKey}`;
      const tenantAlready = await this.prisma.notification.findFirst({
        where: { accountId: tenantAccountId, type, link: tenantLink },
      });
      if (!tenantAlready) {
        await this.notify(tenantAccountId, type, title, body, tenantLink);
        created += 1;
      }
    }
    return created;
  }
}

const RENT_FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annually: 365 };

// Node's own Intl, no new dependency — reads the wall-clock hour a given
// IANA timezone is currently at. An unrecognized/invalid timezone fails
// closed (never matches, so that account is simply skipped this run)
// rather than guessing UTC, since a wrong guess would fire a "9am" local
// reminder at the wrong actual local time, the exact bug this feature
// exists to avoid.
function isCurrentlyLocalHour(timezone: string, hour: number): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
    return Number(formatter.format(new Date())) % 24 === hour;
  } catch {
    return false;
  }
}
