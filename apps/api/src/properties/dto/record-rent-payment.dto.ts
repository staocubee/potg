import { IsDateString, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class RecordRentPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // The audit's own finding on Workflow 8: "No RentSchedule model." Set
  // when this payment satisfies a real, specific schedule entry rather
  // than a bare date range — PropertiesService validates it belongs to
  // this lease and is still "due" before marking it paid. Optional: a
  // payment can still be recorded free-form with no schedule entry, same
  // as before this pass.
  @IsOptional()
  @IsString()
  scheduleEntryId?: string;
}
