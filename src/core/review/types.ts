import { z } from 'zod';

export const ReviewStageSchema = z.enum(['requirements', 'code']);
export type ReviewStage = z.infer<typeof ReviewStageSchema>;
export const ReviewerSchema = z.enum(['codex', 'claude']);
export type Reviewer = z.infer<typeof ReviewerSchema>;
export const ReviewPolicySchema = z.object({
  reviewer: ReviewerSchema.optional(),
  base: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(3_600_000).default(600_000),
  maxRounds: z.number().int().positive().max(20).default(3),
}).strict();
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
export const ReviewResultSchema = z.object({
  version: z.literal(1), stage: ReviewStageSchema, reviewer: ReviewerSchema,
  request: z.object({
    stage: ReviewStageSchema, changeName: z.string(), planningRoot: z.string(),
    implementationRoot: z.string(), changeRoot: z.string(), mainHarness: z.string(),
    reviewer: ReviewerSchema.optional(), base: z.string().optional(),
    timeoutMs: z.number().optional(), maxRounds: z.number().optional(),
  }).strict(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string(), round: z.number().int().positive(),
  outcome: z.enum(['passed', 'changes_required', 'blocked']), summary: z.string().min(1), findings: z.array(FindingSchema),
}).strict().superRefine((value, ctx) => {
  const report = ReviewReportSchema.safeParse({ outcome: value.outcome, summary: value.summary, findings: value.findings });
  if (!report.success) ctx.addIssue({ code: 'custom', message: 'Invalid review report' });
});
