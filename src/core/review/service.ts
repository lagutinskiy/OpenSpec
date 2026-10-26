import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_TOOLS } from '../config.js';
import { assertInside, getReviewSnapshot } from './fingerprint.js';
import { buildReviewContext } from './context.js';
import { ReviewPolicySchema, ReviewReportSchema, ReviewResultSchema, assertReviewerEffort, type Reviewer, type ReviewRequest, type ReviewResult, type ReviewLimitReached, type ReviewStage } from './types.js';
import { reviewWithClaude } from './adapters/claude.js';
import { reviewWithCodex } from './adapters/codex.js';

export type ReviewRunner = (prompt: string, reviewer: Reviewer, request: ReviewRequest) => Promise<unknown>;
export function selectReviewer(mainHarness: string, configured?: Reviewer): Reviewer {
  if (!AI_TOOLS.some(tool => tool.value === mainHarness)) throw new Error(`Unsupported main harness: ${mainHarness}`);
  if (configured === mainHarness) throw new Error('Review must be independent of the main harness.');
  if (mainHarness === 'codex') return 'claude';
  if (mainHarness === 'claude') return 'codex';
  if (!configured) throw new Error(`Please configure review.reviewer for ${mainHarness}.`);
  return configured;
}
export async function evidenceDirectory(changeRoot: string): Promise<string> {
  const dir = path.join(changeRoot, 'reviews');
  await fs.mkdir(dir, { recursive: true });
  await assertInside(changeRoot, dir);
  return dir;
}
export async function writeEvidence(changeRoot: string, name: string, value: unknown): Promise<void> {
  if (!/^[a-z0-9-]+\.json$/.test(name)) throw new Error('Invalid evidence name');
  const dir = await evidenceDirectory(changeRoot);
  const temporary = path.join(dir, `.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temporary, path.join(dir, name));
  } finally { await fs.rm(temporary, { force: true }); }
}
export async function readReview(changeRoot: string, stage: string): Promise<ReviewResult | null> {
  if (stage !== 'requirements' && stage !== 'code') throw new Error('Invalid review stage');
  return readReviewFile(changeRoot, `${stage}.json`);
}
async function readReviewFile(changeRoot: string, name: string): Promise<ReviewResult | null> {
  const file = path.join(changeRoot, 'reviews', name);
  try {
    await assertInside(changeRoot, file);
    return ReviewResultSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof z.ZodError || error instanceof SyntaxError) return null;
    throw error;
  }
}
export async function readCurrentReview(request: ReviewRequest): Promise<ReviewResult | null> {
  const previous = await readReview(request.changeRoot, request.stage);
  if (!previous || previous.reviewer !== selectReviewer(request.mainHarness, request.reviewer) ||
    path.resolve(previous.request.implementationRoot) !== path.resolve(request.implementationRoot) ||
    path.resolve(previous.request.planningRoot) !== path.resolve(request.planningRoot)) return null;
  const snapshot = await getReviewSnapshot(request);
  return snapshot.hash === previous.snapshotHash ? previous : null;
}
/** Consecutive changes_required rounds since the last pass; blocked or unreadable rounds neither count nor reset. */
export async function countFailedRounds(changeRoot: string, stage: ReviewStage): Promise<{ count: number; latest?: ReviewResult; latestRound: number; findingsReport?: ReviewResult }> {
  const dir = path.join(changeRoot, 'reviews');
  let names: string[];
  try { names = await fs.readdir(dir); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { count: 0, latestRound: 0 }; throw error; }
  const prefix = `${stage}-`;
  const rounds = names
    .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
    .map(name => Number(name.slice(prefix.length, -'.json'.length)))
    .filter(round => Number.isInteger(round) && round > 0)
    .sort((a, b) => b - a);
  let count = 0;
  let latest: ReviewResult | undefined;
  let findingsReport: ReviewResult | undefined;
  for (const round of rounds) {
    const report = await readReviewFile(changeRoot, `${stage}-${round}.json`);
    if (!report) continue;
    latest ??= report;
    if (report.outcome === 'passed') break;
    if (report.outcome === 'changes_required') { count++; findingsReport ??= report; }
  }
  return { count, latest, latestRound: rounds[0] ?? 0, findingsReport };
}
async function checkRoundLimit(request: ReviewRequest): Promise<ReviewLimitReached | null> {
  const limit = ReviewPolicySchema.parse({ maxRounds: request.maxRounds }).maxRounds;
  const extraRounds = request.extraRounds ?? 0;
  const { count, latest, latestRound, findingsReport } = await countFailedRounds(request.changeRoot, request.stage);
  if (count < limit + extraRounds) return null;
  return { outcome: 'limit_reached', stage: request.stage, count, limit, extraRounds,
    openFindings: (findingsReport?.findings ?? []).filter(finding => finding.disposition !== 'fixed'),
    ...(findingsReport ? { findingsRound: findingsReport.round } : {}), latestRound,
    ...(latest?.outcome === 'blocked' ? { latestBlockedSummary: latest.summary } : {}),
    next: 'Stop and ask the user how to proceed. Rerun with --extra-rounds <n> only with their explicit approval.' };
}
export async function runReview(request: ReviewRequest, runner?: ReviewRunner): Promise<ReviewResult | ReviewLimitReached> {
  if (request.stage === 'code') {
    const { assertRequirementsReviewed } = await import('./readiness.js');
    await assertRequirementsReviewed(request);
  }
  const reviewer = selectReviewer(request.mainHarness, request.reviewer);
  assertReviewerEffort(reviewer, request.effort);
  if (request.extraRounds !== undefined && (!Number.isInteger(request.extraRounds) || request.extraRounds < 1 || request.extraRounds > 20)) {
    throw new Error('--extra-rounds must be a whole number from 1 to 20.');
  }
  const policy = ReviewPolicySchema.parse({ timeoutMs: request.timeoutMs, maxRounds: request.maxRounds });
  const settings = { ...(request.model ? { model: request.model } : {}), ...(request.effort ? { effort: request.effort } : {}) };
  const snapshot = await getReviewSnapshot(request);
  const normalized = { ...request, ...(snapshot.base ? { base: snapshot.base } : {}) };
  const dir = await evidenceDirectory(request.changeRoot);
  const releaseLock = await acquireReviewLock(request.changeRoot, dir, request.stage);
  try {
    const limitReached = await checkRoundLimit(request);
    if (limitReached) return limitReached;
    const previous = await readReview(request.changeRoot, request.stage);
    let report;
    try {
      const prompt = await buildReviewContext(request, snapshot);
      const schema = z.toJSONSchema(ReviewReportSchema, { unrepresentable: 'any' });
      const raw = runner ? await runner(prompt, reviewer, normalized)
        : await (reviewer === 'claude' ? reviewWithClaude : reviewWithCodex)(prompt, schema, request.implementationRoot, policy.timeoutMs, settings);
      report = ReviewReportSchema.parse(raw);
      if ((await getReviewSnapshot(normalized)).hash !== snapshot.hash) {
        report = { outcome: 'blocked' as const, summary: 'Content changed during review; review again.', findings: [] };
      }
    } catch (error) {
      report = { outcome: 'blocked' as const, summary: error instanceof Error ? error.message : String(error), findings: [] };
    }
    const result: ReviewResult = { ...report, version: 1, stage: request.stage, reviewer, request: normalized,
      snapshotHash: snapshot.hash, createdAt: new Date().toISOString(), round: (previous?.round ?? 0) + 1 };
    await writeEvidence(request.changeRoot, `${request.stage}-${result.round}.json`, result);
    await writeEvidence(request.changeRoot, `${request.stage}.json`, result);
    return result;
  } finally {
    await releaseLock();
  }
}

async function acquireReviewLock(changeRoot: string, dir: string, stage: string): Promise<() => Promise<void>> {
  const lockPath = path.join(dir, `${stage}.lock`);
  const token = randomUUID();
  const create = () => fs.open(lockPath, 'wx', 0o600);
  let lock;
  try { lock = await create(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const recoveryPath = path.join(dir, `${stage}.recovery`);
    let recovery;
    try { recovery = await fs.open(recoveryPath, 'wx', 0o600); }
    catch (recoveryError) {
      if ((recoveryError as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another process is recovering this review lock; retry after it finishes. Inspect abandoned recovery files before removing them.');
      throw recoveryError;
    }
    try {
      // Re-read the owner only after winning the atomic recovery mutex.
      try {
        await assertInside(changeRoot, lockPath);
        const owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Review lock has no valid owner; inspect it before resuming.');
        try { process.kill(owner.pid, 0); throw new Error('Another review is running for this stage.'); }
        catch (ownerError) { if ((ownerError as NodeJS.ErrnoException).code !== 'ESRCH') throw ownerError; }
        await fs.rm(lockPath);
      } catch (ownerError) {
        if ((ownerError as NodeJS.ErrnoException).code !== 'ENOENT') throw ownerError;
      }
      lock = await create();
    } finally {
      await recovery.close();
      await fs.rm(recoveryPath, { force: true });
    }
  }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })); }
  catch (error) { await lock.close(); await fs.rm(lockPath, { force: true }); throw error; }
  return async () => {
    await lock.close();
    try {
      const owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      if (owner.token === token) await fs.rm(lockPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  };
}
