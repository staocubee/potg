import { IsBoolean } from 'class-validator';

export class SetAutoRenewDto {
  @IsBoolean()
  autoRenew!: boolean;
}
