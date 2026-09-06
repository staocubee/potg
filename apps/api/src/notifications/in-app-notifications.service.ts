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
  async checkDocumentExpiry(daysAhead = 30) {
    const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    const expiring = await this.prisma.document.findMany({
      where: { expiryDate: { not: null, lte: cutoff, gte: new Date() } },
      select: { id: true, accountId: true, documentType: true, expiryDate: true },
    });

    let created = 0;
    for (const doc of expiring) {
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
}
