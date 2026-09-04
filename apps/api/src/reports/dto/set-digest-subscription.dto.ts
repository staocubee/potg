import { IsIn } from 'class-validator';

const DIGEST_FREQUENCIES = ['off', 'weekly', 'monthly'] as const;

export class SetDigestSubscriptionDto {
  @IsIn(DIGEST_FREQUENCIES)
  frequency!: (typeof DIGEST_FREQUENCIES)[number];
}
