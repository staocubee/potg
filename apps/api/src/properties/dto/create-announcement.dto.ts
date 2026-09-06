import { IsOptional, IsString, MinLength } from 'class-validator';

// propertyId is optional and deliberately never required — see
// PropertyAnnouncement's own schema comment for what omitting it means
// (every tenant across the account, not just one property's).
export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;
}
