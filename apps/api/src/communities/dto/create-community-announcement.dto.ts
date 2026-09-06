import { IsString, MinLength } from 'class-validator';

export class CreateCommunityAnnouncementDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;
}
