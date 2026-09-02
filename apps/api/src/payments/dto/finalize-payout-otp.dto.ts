import { IsString } from 'class-validator';

export class FinalizePayoutOtpDto {
  @IsString()
  otp!: string;
}
