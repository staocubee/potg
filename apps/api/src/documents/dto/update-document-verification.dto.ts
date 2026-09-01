import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateDocumentVerificationDto {
  @IsIn(['verified', 'rejected'])
  status!: 'verified' | 'rejected';

  @IsOptional()
  @IsString()
  notes?: string;
}
