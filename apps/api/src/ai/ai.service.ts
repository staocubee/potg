import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AI_SKILLS, LLM_PROVIDER } from './llm/llm.constants';
import { AiSkill } from './skills/ai-skill.interface';
import { AiSkillInputSchema } from './skills/ai-skill-input-schema';
import { LlmProvider } from './llm/llm-provider.interface';

// The req.accountMember shape AccountContextGuard attaches — role and its
// permissions already loaded, so this service never has to re-query them.
// Exported so ChatService (chat.service.ts) can share the exact same type
// rather than redeclaring it.
export type AccountMemberWithRole = {
  id: string;
  accountId: string;
  role: { permissions: { permission: { key: string } }[] };
};

// This is the AI Copilot Layer's backbone (Section 5.4): one entry point
// every module's "Ask AI" panel calls into, regardless of which module.
// It does three things every single skill relies on so skills themselves
// stay small: (1) resolve the skill from the registry, (2) enforce that the
// caller's account membership actually carries the permission that skill
// requires — the AI layer never sees more than the human already could —
// and (3) persist the request/output pair so every draft is auditable and
// traceable to who asked for it.
@Injectable()
export class AiService {
  private readonly registry: Map<string, AiSkill>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_SKILLS) skills: AiSkill[],
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {
    this.registry = new Map(skills.map((skill) => [skill.key, skill]));
  }

  listSkills() {
    return Array.from(this.registry.values()).map((s) => ({
      key: s.key,
      label: s.label,
      requiredPermission: s.requiredPermission,
      moduleContextPrefix: s.moduleContextPrefix,
      inputSchema: s.inputSchema,
    }));
  }

  // The other half of "per-skill AI input schemas": every caller of
  // runAction — the quick-action buttons (POST /ai/actions directly),
  // ChatService's tool-calling path, and eventually any other AI entry
  // point — funnels through here, so this is the one place that needs to
  // validate/coerce `input` against a skill's declared schema. Unknown keys
  // are dropped rather than passed through (a skill only ever reads what
  // its own schema declares, so there's nothing legitimate for an unknown
  // key to do); declared keys are coerced to their declared type, checked
  // against enum/minimum/maximum, and defaults are filled in — so
  // skill.run() always receives a value that already matches its schema,
  // not a raw, unchecked `Record<string, unknown>`.
  private coerceInput(schema: AiSkillInputSchema, raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema.properties)) {
      const rawValue = raw[key];
      const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== '';
      if (!hasValue) {
        if (field.default !== undefined) out[key] = field.default;
        continue;
      }
      if (field.type === 'number') {
        const num = Number(rawValue);
        if (Number.isNaN(num)) throw new BadRequestException(`"${key}" must be a number`);
        if (field.minimum != null && num < field.minimum) {
          throw new BadRequestException(`"${key}" must be at least ${field.minimum}`);
        }
        if (field.maximum != null && num > field.maximum) {
          throw new BadRequestException(`"${key}" must be at most ${field.maximum}`);
        }
        out[key] = num;
      } else if (field.type === 'boolean') {
        out[key] = typeof rawValue === 'boolean' ? rawValue : String(rawValue) === 'true';
      } else {
        const str = String(rawValue);
        if (field.enum && !field.enum.includes(str)) {
          throw new BadRequestException(`"${key}" must be one of: ${field.enum.join(', ')}`);
        }
        out[key] = str;
      }
    }
    for (const key of schema.required ?? []) {
      if (out[key] === undefined) throw new BadRequestException(`"${key}" is required for this AI action`);
    }
    return out;
  }

  async runAction(
    accountMember: AccountMemberWithRole,
    moduleContext: string,
    actionType: string,
    input: Record<string, unknown>,
  ) {
    const skill = this.registry.get(actionType);
    if (!skill) throw new NotFoundException(`Unknown AI action "${actionType}"`);

    const permissions = new Set(accountMember.role.permissions.map((rp) => rp.permission.key));
    if (!permissions.has(skill.requiredPermission)) {
      throw new ForbiddenException(
        `The "${skill.label}" AI action needs the "${skill.requiredPermission}" permission`,
      );
    }

    const [prefix] = moduleContext.split(':');
    if (prefix !== skill.moduleContextPrefix) {
      throw new BadRequestException(
        `"${actionType}" expects a moduleContext like "${skill.moduleContextPrefix}:<id>"`,
      );
    }

    const coercedInput = this.coerceInput(skill.inputSchema, input);

    const aiRequest = await this.prisma.aiRequest.create({
      data: {
        accountId: accountMember.accountId,
        accountMemberId: accountMember.id,
        moduleContext,
        actionType,
        input: coercedInput as object,
      },
    });

    const result = await skill.run(
      { accountId: accountMember.accountId, accountMemberId: accountMember.id, permissions },
      moduleContext,
      coercedInput,
      { prisma: this.prisma, llm: this.llm },
    );

    const output = await this.prisma.aiOutput.create({
      data: {
        aiRequestId: aiRequest.id,
        draftLabel: result.draftLabel,
        draftBody: { items: result.items, warn: !!result.warn },
      },
    });

    return {
      requestId: aiRequest.id,
      outputId: output.id,
      draftLabel: result.draftLabel,
      items: result.items,
      warn: !!result.warn,
    };
  }

  // The other half of the human-in-the-loop rule: an AiOutput is a draft
  // until exactly one AiActionApproval exists for it. Nothing downstream
  // should ever treat an AiOutput as final by itself.
  async decide(
    aiOutputId: string,
    decidedByUserId: string,
    decision: 'accepted' | 'edited' | 'discarded',
    notes?: string,
  ) {
    const output = await this.prisma.aiOutput.findUnique({ where: { id: aiOutputId } });
    if (!output) throw new NotFoundException('AI draft not found');

    const existing = await this.prisma.aiActionApproval.findUnique({ where: { aiOutputId } });
    if (existing) throw new ConflictException('This draft already has a recorded decision');

    return this.prisma.aiActionApproval.create({
      data: { aiOutputId, decidedByUserId, decision, notes },
    });
  }
}
