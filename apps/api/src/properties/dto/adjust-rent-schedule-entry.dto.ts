import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

const SCHEDULE_ENTRY_STATUSES = ['due', 'skipped'] as const;

// The real capability a persisted schedule adds over a pure computation:
// a landlord can defer one specific due date, waive a period, or correct
// one installment's amount — without any of that touching the lease's
// own rentAmount/rentFrequency, or any other entry. Deliberately no
// "paid" option here — a schedule entry only ever becomes paid via
// recordRentPayment actually recording a real payment against it, never
// a manual status edit.
export class AdjustRentScheduleEntryDto {
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsIn(SCHEDULE_ENTRY_STATUSES)
  status?: (typeof SCHEDULE_ENTRY_STATUSES)[number];

  @IsOptional()
  @IsString()
  notes?: string;
}
