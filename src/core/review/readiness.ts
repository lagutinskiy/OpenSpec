import { getTaskProgressForChange } from '../../utils/task-progress.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { decisionsAcknowledged, blockingDecisions } from '../decisions.js';
import { getReviewSnapshot, assertInside } from './fingerprint.js';
import { readCurrentReview, readReview, writeEvidence } from './service.js';
import { runProcess } from './adapters/process.js';
import type { ReviewRequest } from './types.js';

const VerificationSchema = z.object({
  version: z.literal(1), snapshotHash: z.string(), outcome: z.enum(['passed', 'failed', 'stale']),
  checks: z.array(z.object({ command: z.array(z.string()).min(1), passed: z.boolean(), output: z.string() })).min(1),
  createdAt: z.string(),
});
export async function runVerification(request: ReviewRequest, checks: string[][]): Promise<z.infer<typeof VerificationSchema>> {
  if (!checks.length || checks.some(check => !Array.isArray(check) || !check.length || check.some(arg => typeof arg !== 'string') || !check[0])) throw new Error('Provide one or more command argument arrays to verify.');
  const before = await getReviewSnapshot({ ...request, stage: 'code' });
  const results = [];
  for (const command of checks) {
    try {
      const output = await runProcess(command[0], command.slice(1), request.implementationRoot, '', request.timeoutMs ?? 600_000);
      results.push({ command, passed: true, output });
    } catch (error) {
      results.push({ command, passed: false, output: error instanceof Error ? error.message : String(error) });
      if (process.exitCode === 130 || process.exitCode === 143) break;
    }
  }
  const unchanged = (await getReviewSnapshot({ ...request, stage: 'code', base: before.base })).hash === before.hash;
  const evidence = { version: 1 as const, snapshotHash: before.hash,
    outcome: !unchanged ? 'stale' as const : results.every(result => result.passed) ? 'passed' as const : 'failed' as const,
    checks: results, createdAt: new Date().toISOString() };
  await writeEvidence(request.changeRoot, 'verification.json', evidence);
  return evidence;
}
export async function getReviewReadiness(request: ReviewRequest): Promise<{ ready: boolean; blockers: string[] }> {
  const blockers: string[] = [];
  const progress = await getTaskProgressForChange(path.dirname(request.changeRoot), request.changeName, request.planningRoot);
  if (progress.completed < progress.total) blockers.push(`${progress.total - progress.completed} incomplete task(s)`);
  for (const stage of ['requirements', 'code'] as const) {
    const review = await readCurrentReview({ ...request, stage });
    if (!review || review.outcome !== 'passed') blockers.push(`${stage} review missing, stale, or not passed`);
  }
  const snapshot = await getReviewSnapshot({ ...request, stage: 'code' });
  try {
    const file = path.join(request.changeRoot, 'reviews/verification.json');
    await assertInside(request.changeRoot, file);
    const evidence = VerificationSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
    if (evidence.outcome !== 'passed' || evidence.checks.some(check => !check.passed) || evidence.snapshotHash !== snapshot.hash) blockers.push('Verification failed or stale');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError || error instanceof z.ZodError) blockers.push('Verification evidence missing or invalid');
    else throw error;
  }
  if (!(await decisionsAcknowledged(request.planningRoot, request.changeRoot, request.changeName))) blockers.push('Review/update the decision register and acknowledge it for archive');
  return { ready: blockers.length === 0, blockers };
}
export async function assertRequirementsReviewed(request: ReviewRequest): Promise<void> {
  const decisions = await blockingDecisions(request.planningRoot, request.changeName);
  if (decisions.length) throw new Error(`Resolve blocking decisions: ${decisions.join(', ')}`);
  const review = await readCurrentReview({ ...request, stage: 'requirements' });
  if (!review || review.outcome !== 'passed') throw new Error('Requirements review must pass for current planning artifacts before implementation.');
}
export class LifecycleBlockedError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export async function assertArchiveReady(planningRoot: string, changeRoot: string, changeName: string): Promise<void> {
  const progress = await getTaskProgressForChange(path.dirname(changeRoot), changeName, planningRoot);
  if (progress.completed < progress.total) throw new LifecycleBlockedError('archive_tasks_incomplete', `${progress.total - progress.completed} incomplete task(s) found. Complete all tracked tasks before archive.`);
  const code = await readReview(changeRoot, 'code');
  if (!code) throw new Error('Code review evidence missing; run openspec review code before archive.');
  const request = { ...code.request, planningRoot, changeRoot, changeName };
  const readiness = await getReviewReadiness(request);
  if (!readiness.ready) throw new Error(`Archive blocked: ${readiness.blockers.join('; ')}`);
}
