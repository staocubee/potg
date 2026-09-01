import { IsIn, IsOptional, IsString } from 'class-validator';

// Backs the Ask AI panel's Accept / Edit / Discard buttons (Section 5.4:
// "any AI output that would move money, approve a milestone, publish a
// listing, or sign a document is a draft that still routes through the
// existing approval workflow"). This endpoint IS that approval workflow's
// minimal form — a real Accept for a financial or legal action should also
// call the underlying module's own approval endpoint (e.g. milestone
// release), not just record the decision here.
export class DecideAiOutputDto {
  @IsIn(['accepted', 'edited', 'discarded'])
  decision!: 'accepted' | 'edited' | 'discarded';

  @IsOptional()
  @IsString()
  notes?: string;
}
