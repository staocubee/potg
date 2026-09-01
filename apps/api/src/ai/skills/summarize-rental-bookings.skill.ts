import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 10's AI Assistance action for the rental calendar — requested
// (needs a decision), confirmed (currently out), and overdue (confirmed,
// past its own endDate, never marked returned) counts are computed
// deterministically from RentalBooking; the LLM only phrases the opening
// line, same split as summarize_maintenance_backlog.
export const summarizeRentalBookingsSkill: AiSkill = {
  key: 'summarize_rental_bookings',
  label: 'Summarize rental bookings',
  requiredPermission: 'rental:read',
  moduleContextPrefix: 'supplier',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const supplierId = moduleContext.split(':')[1];
    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, accountId: ctx.accountId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const bookings = await prisma.rentalBooking.findMany({
      where: { product: { supplierId } },
      include: { product: { select: { name: true } } },
      orderBy: { startDate: 'asc' },
    });

    type BookingWithProduct = {
      status: string;
      endDate: Date;
      quantity: number;
      product: { name: string };
    };
    const now = Date.now();
    const requested = (bookings as BookingWithProduct[]).filter((b) => b.status === 'requested');
    const confirmed = bookings.filter((b) => b.status === 'confirmed');
    const overdue = confirmed.filter((b) => b.endDate.getTime() < now);

    const items: string[] = [];

    if (bookings.length === 0) {
      const intro = await llm.complete({
        systemPrompt:
          'You tell a supplier in one short, plain sentence that no rental bookings have been made against their catalog yet.',
        userPrompt: `Supplier "${supplier.businessName}" has zero rental bookings on file.`,
      });
      return { draftLabel: 'Rental bookings — draft', items: [intro], warn: false };
    }

    const intro = await llm.complete({
      systemPrompt:
        'You summarize a supplier\'s rental booking backlog in one plain, factual sentence — mention if anything needs confirming or is overdue for return. No hedging, no jargon.',
      userPrompt: `Supplier "${supplier.businessName}": ${requested.length} awaiting confirmation, ${confirmed.length} currently out, ${overdue.length} overdue for return, out of ${bookings.length} bookings total.`,
    });
    items.push(intro);

    for (const b of requested) {
      items.push(`${b.product.name} — ${b.quantity} unit(s) requested, awaiting your confirmation`);
    }
    for (const b of overdue) {
      const daysOverdue = Math.floor((now - b.endDate.getTime()) / (1000 * 60 * 60 * 24));
      items.push(`${b.product.name} — ${b.quantity} unit(s), ~${daysOverdue} day(s) overdue for return`);
    }

    return {
      draftLabel: 'Rental bookings — draft',
      items,
      warn: requested.length > 0 || overdue.length > 0,
    };
  },
};
