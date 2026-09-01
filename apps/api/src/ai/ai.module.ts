import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProjectsModule } from '../projects/projects.module';
import { AiService } from './ai.service';
import { ChatService } from './chat.service';
import { AiController } from './ai.controller';
import { AI_SKILLS, LLM_PROVIDER } from './llm/llm.constants';
import { StubLlmProvider } from './llm/stub-llm.provider';
import { AnthropicLlmProvider } from './llm/anthropic-llm.provider';
import { verifyPropertyDocumentsSkill } from './skills/verify-property-documents.skill';
import { summarizePropertySkill } from './skills/summarize-property.skill';
import { estimateProjectBudgetSkill } from './skills/estimate-project-budget.skill';
import { draftProjectStatusUpdateSkill } from './skills/draft-project-status-update.skill';
import { compareVendorQuotesSkill } from './skills/compare-vendor-quotes.skill';
import { explainFeesSkill } from './skills/explain-fees.skill';
import { flagPaymentAnomalySkill } from './skills/flag-payment-anomaly.skill';
import { generateListingDescriptionSkill } from './skills/generate-listing-description.skill';
import { boqToOrderSkill } from './skills/boq-to-order.skill';
import { modelRoiScenarioSkill } from './skills/model-roi-scenario.skill';
import { assessListingRiskSkill } from './skills/assess-listing-risk.skill';
import { generatePortfolioReportSkill } from './skills/generate-portfolio-report.skill';
import { summarizeInspectionHistorySkill } from './skills/summarize-inspection-history.skill';
import { summarizeLeaseStatusSkill } from './skills/summarize-lease-status.skill';
import { summarizeMaintenanceBacklogSkill } from './skills/summarize-maintenance-backlog.skill';

@Module({
  imports: [ProjectsModule],
  controllers: [AiController],
  providers: [
    AiService,
    ChatService,
    StubLlmProvider,
    AnthropicLlmProvider,
    {
      // Picks a real model automatically once ANTHROPIC_API_KEY is set;
      // falls back to the stub so the rest of the AI layer (permission
      // checks, context assembly, persistence) is exercisable without one.
      provide: LLM_PROVIDER,
      inject: [ConfigService, StubLlmProvider, AnthropicLlmProvider],
      useFactory: (config: ConfigService, stub: StubLlmProvider, anthropic: AnthropicLlmProvider) =>
        config.get<string>('ANTHROPIC_API_KEY') ? anthropic : stub,
    },
    {
      // The skill/tool registry from Section 5.4. Add a new module's AI
      // Assistance capability by writing one AiSkill and listing it here —
      // nothing else in the AI layer needs to change.
      provide: AI_SKILLS,
      useValue: [
        verifyPropertyDocumentsSkill,
        summarizePropertySkill,
        estimateProjectBudgetSkill,
        draftProjectStatusUpdateSkill,
        compareVendorQuotesSkill,
        explainFeesSkill,
        flagPaymentAnomalySkill,
        generateListingDescriptionSkill,
        boqToOrderSkill,
        modelRoiScenarioSkill,
        assessListingRiskSkill,
        generatePortfolioReportSkill,
        summarizeInspectionHistorySkill,
        summarizeLeaseStatusSkill,
        summarizeMaintenanceBacklogSkill,
      ],
    },
  ],
  exports: [AiService, ChatService],
})
export class AiModule {}
