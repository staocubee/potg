// The audit's own finding on Workflow 8: "No RentSchedule model — just
// rentFrequency + startDate, with due dates derived on the fly wherever
// overdue-checking happens to run." Same anchor-date math
// InAppNotificationsService.checkLeaseReminders already trusts for real
// reminders (and ReportsService's own isLeaseOverdue) — this just makes
// the same calculation visible ahead of time as a real, forward-looking
// schedule, instead of only ever running invisibly inside a cron job or
// an overdue check.
const RENT_FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annually: 365 };

export function computeUpcomingRentDueDates(
  lease: { rentFrequency: string; startDate: Date; endDate: Date | null; rentPayments: { periodEnd: Date }[] },
  count = 6,
): string[] {
  const periodDays = RENT_FREQUENCY_DAYS[lease.rentFrequency] ?? RENT_FREQUENCY_DAYS.monthly;
  const anchor =
    lease.rentPayments.length > 0
      ? new Date(Math.max(...lease.rentPayments.map((p) => p.periodEnd.getTime())))
      : lease.startDate;
  const dates: string[] = [];
  let cursor = new Date(anchor);
  for (let i = 0; i < count; i++) {
    cursor = new Date(cursor.getTime() + periodDays * 24 * 60 * 60 * 1000);
    if (lease.endDate && cursor > lease.endDate) break;
    dates.push(cursor.toISOString());
  }
  return dates;
}
