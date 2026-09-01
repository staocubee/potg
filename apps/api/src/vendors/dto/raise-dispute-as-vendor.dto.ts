import { IsString } from 'class-validator';
import { RaiseDisputeDto } from '../../payments/dto/raise-dispute.dto';

// Same shape as RaiseDisputeDto, plus the projectId that route gets from
// the URL on the owner-side controller — this one lives at
// POST /vendors/me/disputes (deliberately not /projects/:projectId/...,
// same reasoning as submitQuote), so the project has to come from the body.
export class RaiseDisputeAsVendorDto extends RaiseDisputeDto {
  @IsString()
  projectId!: string;
}
