import { z } from 'zod';

export const ReviewStageSchema = z.enum(['requirements', 'code']);
export type ReviewStage = z.infer<typeof ReviewStageSchema>;
export const ReviewerSchema = z.enum(['codex', 'claude']);
export type Reviewer = z.infer<typeof ReviewerSchema>;
// Codex passes unknown efforts through to the provider, so both lists are enforced locally.
export const REVIEWER_EFFORT_LEVELS: Record<Reviewer, readonly string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh'],
};
export function assertReviewerEffort(reviewer: Reviewer, effort: string | undefined): void {
  if (effort !== undefined && !REVIEWER_EFFORT_LEVELS[reviewer].includes(effort)) {
    throw new Error(`Unsupported ${reviewer} review effort "${effort}"; use one of: ${REVIEWER_EFFORT_LEVELS[reviewer].join(', ')}.`);
  }
}
const RoundLimitSchema = z.number().int().positive().max(20);
export const ReviewerSettingsSchema = z.object({
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
}).strict();
export type ReviewerSettings = z.infer<typeof ReviewerSettingsSchema>;
const ReviewerSettingsMapSchema = z.object({
  claude: ReviewerSettingsSchema.optional(),
  codex: ReviewerSettingsSchema.optional(),
}).strict();
const StagePolicySchema = z.object({
  maxRounds: RoundLimitSchema.optional(),
  reviewers: ReviewerSettingsMapSchema.optional(),
}).strict();
export const ReviewPolicySchema = z.object({
  reviewer: ReviewerSchema.optional(),
  base: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).default(600_000),
  maxRounds: RoundLimitSchema.default(3),
  reviewers: ReviewerSettingsMapSchema.optional(),
  stages: z.object({
    requirements: StagePolicySchema.optional(),
    code: StagePolicySchema.optional(),
  }).strict().optional(),
}).strict().superRefine((policy, ctx) => {
  const maps = [policy.reviewers, policy.stages?.requirements?.reviewers, policy.stages?.code?.reviewers];
  for (const map of maps) {
    for (const reviewer of ReviewerSchema.options) {
      try { assertReviewerEffort(reviewer, map?.[reviewer]?.effort); }
      catch (error) { ctx.addIssue({ code: 'custom', message: (error as Error).message }); }
    }
  }
});
export type ReviewPolicy = z.infer<typeof ReviewPolicySchema>;
/** Field-wise merge: stage+reviewer settings over reviewer-wide settings. CLI flags are applied by the caller. */
export function resolveReviewerSettings(policy: ReviewPolicy, stage: ReviewStage, reviewer: Reviewer): ReviewerSettings {
  return { ...policy.reviewers?.[reviewer], ...policy.stages?.[stage]?.reviewers?.[reviewer] };
}
export function resolveRoundLimit(policy: ReviewPolicy, stage: ReviewStage): number {
  return policy.stages?.[stage]?.maxRounds ?? policy.maxRounds;
}
export const FindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  message: z.string().min(1),
  evidence: z.string().min(1),
  disposition: z.enum(['open', 'fixed', 'accepted', 'rejected']),
  reason: z.string().default(''),
}).strict();
export const ReviewReportSchema = z.object({
  outcome: z.enum(['passed', 'changes_required', 'blocked']),
  summary: z.string().min(1),
  findings: z.array(FindingSchema),
}).strict().superRefine((report, ctx) => {
  if (report.outcome !== 'passed') return;
  for (const finding of report.findings) {
    if (finding.disposition === 'open' || (finding.disposition !== 'fixed' && !finding.reason?.trim()) ||
      (['critical', 'high'].includes(finding.severity) && finding.disposition === 'accepted')) {
      ctx.addIssue({ code: 'custom', message: `Unresolved finding: ${finding.id}` });
    }
  }
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;
export interface ReviewRequest {
  stage: ReviewStage;
  changeName: string;
  planningRoot: string;
  implementationRoot: string;
  changeRoot: string;
  mainHarness: string;
  reviewer?: Reviewer;
  base?: string;
  timeoutMs?: number;
  maxRounds?: number;
  model?: string;
  effort?: string;
  extraRounds?: number;
}
export interface ReviewSnapshot {
  hash: string;
  base?: string;
  files: { path: string; hash: string; content: string }[];
}
export interface ReviewResult extends ReviewReport {
  version: 1;
  stage: ReviewStage;
  reviewer: Reviewer;
  request: ReviewRequest;
  snapshotHash: string;
  createdAt: string;
  round: number;
}
export interface ReviewLimitReached {
  outcome: 'limit_reached';
  stage: ReviewStage;
  count: number;
  limit: number;
  extraRounds: number;
  openFindings: z.infer<typeof FindingSchema>[];
  findingsRound?: number;
  latestRound: number;
  latestBlockedSummary?: string;
  next: string;
}
export const ReviewResultSchema = z.object({
  version: z.literal(1), stage: ReviewStageSchema, reviewer: ReviewerSchema,
  request: z.object({
    stage: ReviewStageSchema, changeName: z.string(), planningRoot: z.string(),
    implementationRoot: z.string(), changeRoot: z.string(), mainHarness: z.string(),
    reviewer: ReviewerSchema.optional(), base: z.string().optional(),
    timeoutMs: z.number().optional(), maxRounds: z.number().optional(),
    model: z.string().optional(), effort: z.string().optional(), extraRounds: z.number().optional(),
  }).strict(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string(), round: z.number().int().positive(),
  outcome: z.enum(['passed', 'changes_required', 'blocked']), summary: z.string().min(1), findings: z.array(FindingSchema),
}).strict().superRefine((value, ctx) => {
  const report = ReviewReportSchema.safeParse({ outcome: value.outcome, summary: value.summary, findings: value.findings });
  if (!report.success) ctx.addIssue({ code: 'custom', message: 'Invalid review report' });
});
