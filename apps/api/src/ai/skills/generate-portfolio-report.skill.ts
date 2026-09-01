import { BadRequestException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 23's "natural-language report generation on top of every report
// type" — the first skill scoped to the whole account rather than one
// property/project/listing, so moduleContext is "account:<id>" instead.
// This is the closest thing this scaffold has to Section 11's fixed
// "owner dashboard" — except generated in plain language on request rather
// than only ever a fixed chart, per Section 5.2's "Report" definition.
export const generatePortfolioReportSkill: AiSkill = {
  key: 'generate_portfolio_report',
  label: 'Generate a portfolio report',
  requiredPermission: 'property:read',
  moduleContextPrefix: 'account',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const requestedAccountId = moduleContext.split(':')[1];
    if (requestedAccountId !== ctx.accountId) {
      throw new BadRequestException('A portfolio report can only be generated for your own account');
    }

    // Dispute has no direct accountId column — filtered through its
    // required `project` relation instead (every Dispute belongs to a
    // Project, and every Project to an account). Currency lives on Account,
    // not Property — a property has no currency column of its own.
    const [account, properties, projects, listings, disputes] = await Promise.all([
      prisma.account.findUnique({ where: { id: ctx.accountId }, select: { currency: true } }),
      prisma.property.findMany({ where: { accountId: ctx.accountId } }),
      prisma.project.findMany({ where: { accountId: ctx.accountId } }),
      prisma.propertyListing.findMany({ where: { accountId: ctx.accountId } }),
      prisma.dispute.findMany({ where: { project: { accountId: ctx.accountId } } }),
    ]);

    const totalEstimatedValue = properties.reduce(
      (sum: number, p: { estimatedValue: unknown }) => sum + Number(p.estimatedValue ?? 0),
      0,
    );
    const activeProjects = projects.filter((p: { status: string }) => p.status === 'in_progress').length;
    const activeListings = listings.filter((l: { status: string }) => l.status === 'active').length;
    const openDisputes = disputes.filter((d: { status: string }) => d.status === 'open').length;

    const currency = account?.currency ?? 'USD';
    const facts = `${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}, combined estimated value ~${currency} ${totalEstimatedValue.toLocaleString()}. ${activeProjects} active project(s) out of ${projects.length} total. ${activeListings} active marketplace listing(s). ${openDisputes} open dispute(s).`;

    const intro = await llm.complete({
      systemPrompt:
        'You write a one-paragraph executive summary of a property portfolio for its owner, in plain language, from the facts given only.',
      userPrompt: facts,
    });

    return {
      draftLabel: 'Portfolio report — draft',
      items: [
        intro,
        `${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} in the portfolio`,
        `Combined estimated value: ~${currency} ${totalEstimatedValue.toLocaleString()} (the account's currency; individual properties may be priced informally in others)`,
        `${activeProjects} active project(s) of ${projects.length} total`,
        `${activeListings} active marketplace listing(s)`,
        `${openDisputes} open dispute(s)`,
      ],
      warn: openDisputes > 0,
    };
  },
};
