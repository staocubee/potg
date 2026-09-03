import { IsEmail } from 'class-validator';

export class SetPaypalPayoutEmailDto {
  @IsEmail()
  email!: string;
}
