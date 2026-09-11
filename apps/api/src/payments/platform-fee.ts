import { ConfigService } from '@nestjs/config';

// The platform's own revenue model — a real, configurable percentage
// taken out of every milestone release, absorbed by the vendor (not
// charged to the owner on top): a ₦100,000 milestone at the default 5%
// pays the vendor ₦95,000, the platform keeps ₦5,000, and the full
// ₦100,000 still leaves escrow exactly as it always has — the owner's
// own project cost is completely unaffected by this. Standard
// marketplace take-rate shape (Upwork/Fiverr/Airbnb's own host fee), not
// a subscription or a placement fee. Shared between
// PaymentsService.releaseMilestone (the actual deduction) and
// explain_fees (which used to show this same number as a hardcoded
// "illustrative... not actually deducted anywhere yet" placeholder — see
// that skill's own comment history — this is what makes it real).
export const DEFAULT_PLATFORM_FEE_PERCENT = 5;

export function getPlatformFeePercent(config: ConfigService): number {
  const raw = config.get<string>('PLATFORM_FEE_PERCENT');
  const parsed = raw != null ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 100 ? parsed : DEFAULT_PLATFORM_FEE_PERCENT;
}

// Plain 2-decimal-place rounding, same "Number(), never a big-decimal
// library" convention every other money calculation in this codebase
// already uses (see e.g. ReportsService's own aggregation).
export function computePlatformFee(grossAmount: number, feePercent: number): { platformFeeAmount: number; netAmount: number } {
  const platformFeeAmount = Math.round(grossAmount * feePercent) / 100;
  const netAmount = Math.round((grossAmount - platformFeeAmount) * 100) / 100;
  return { platformFeeAmount, netAmount };
}
