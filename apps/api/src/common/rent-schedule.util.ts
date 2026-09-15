// The audit's own finding on Workflow 8: "No RentSchedule model — just
// rentFrequency + startDate, with due dates derived on the fly wherever
// overdue-checking happens to run." An earlier pass made that computation
// visible (this same per-frequency day math, surfaced as a real
// upcomingDueDates field) without persisting anything — genuinely more
// useful, but still not a real row a landlord could individually adjust.
// This pass replaces the pure computation with real, persisted
// LeaseRentScheduleEntry rows instead (PropertiesService.generateRentSchedule)
// — this file now only backs that real generator.
// InAppNotificationsService/ReportsService each keep their own separate
// copy of this same RENT_FREQUENCY_DAYS constant already — the
// established "duplicate a small pure piece, don't force a cross-module
// import" convention this codebase already follows elsewhere — so
// changing this file's own shape doesn't touch either of them.
export const RENT_FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annually: 365 };

// Real Date objects, not ISO strings — the one difference from this
// file's own previous shape, since every caller now either writes these
// straight into a real LeaseRentScheduleEntry row or compares them
// directly against other real Date fields, neither of which needs the
// string round-trip a display-only computation once did.
export function computeNextDueDates(anchor: Date, rentFrequency: string, endDate: Date | null, count: number): Date[] {
  const periodDays = RENT_FREQUENCY_DAYS[rentFrequency] ?? RENT_FREQUENCY_DAYS.monthly;
  const dates: Date[] = [];
  let cursor = new Date(anchor);
  for (let i = 0; i < count; i++) {
    cursor = new Date(cursor.getTime() + periodDays * 24 * 60 * 60 * 1000);
    if (endDate && cursor > endDate) break;
    dates.push(cursor);
  }
  return dates;
}
