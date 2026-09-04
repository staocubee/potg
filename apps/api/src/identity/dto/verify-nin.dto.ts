import { Matches } from 'class-validator';

export class VerifyNinDto {
  // Nigeria's NIN is always 11 digits.
  @Matches(/^\d{11}$/, { message: 'nin must be exactly 11 digits' })
  nin!: string;
}
