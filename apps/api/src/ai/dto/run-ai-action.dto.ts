import { IsObject, IsOptional, IsString } from 'class-validator';

export class RunAiActionDto {
  @IsString()
  moduleContext!: string; // e.g. "property:3f2c..." — see Section 5.4 / AiRequest.moduleContext

  @IsString()
  actionType!: string; // matches an AiSkill.key in the registry

  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}
