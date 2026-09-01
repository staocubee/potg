import { IsIn, IsOptional, IsNumber, IsPositive } from 'class-validator';

const OFFER_RESPONSES = ['countered', 'accepted', 'rejected'] as const;

export class RespondOfferDto {
  @IsIn(OFFER_RESPONSES)
  status!: 'countered' | 'accepted' | 'rejected';

  // Only meaningful when status is "countered".
  @IsOptional()
  @IsNumber()
  @IsPositive()
  counterAmount?: number;
}
