import { IsString } from 'class-validator';

export class RequestQuoteDto {
  @IsString()
  vendorId!: string;
}
