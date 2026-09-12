import { IsIn } from 'class-validator';

// Real ProjectStage.status values (see schema.prisma) — same three states
// every stage is created with, just now actually settable after creation.
const STAGE_STATUSES = ['not_started', 'in_progress', 'completed'] as const;

export class UpdateProjectStageDto {
  @IsIn(STAGE_STATUSES)
  status!: (typeof STAGE_STATUSES)[number];
}
