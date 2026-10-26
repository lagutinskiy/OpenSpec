import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { resolveOpenSpecRoot, isStoreSelectedRoot, findDeclaringProjectRoot, toPlanningHome } from '../core/root-selection.js';
import { validateChangeExists } from './workflow/shared.js';
import { loadChangeContext } from '../core/artifact-graph/index.js';
import { ReviewPolicySchema, ReviewerSchema, assertReviewerEffort, resolveReviewerSettings, resolveRoundLimit, type Reviewer, type ReviewRequest } from '../core/review/types.js';
import { runReview, selectReviewer } from '../core/review/service.js';
import { getReviewReadiness, runVerification, assertRequirementsReviewed } from '../core/review/readiness.js';
import { acknowledgeDecisions, ensureDecisionRegister } from '../core/decisions.js';
import { assertInside } from '../core/review/fingerprint.js';

interface ReviewOptions {
  change: string; mainHarness?: string; reviewer?: string; base?: string;
  store?: string; implementationRoot?: string; json?: boolean; check?: string[];
  model?: string; effort?: string; extraRounds?: string;
}
export function parseExtraRounds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isInteger(parsed) || parsed < 1 || parsed > 20) throw new Error('--extra-rounds must be a whole number from 1 to 20.');
  return parsed;
}
export async function resolveReviewRequest(stage: 'requirements' | 'code', options: ReviewOptions): Promise<ReviewRequest> {
  const root = await resolveOpenSpecRoot({ store: options.store, allowImplicitRoot: false });
  const name = await validateChangeExists(options.change, root.path, root.changesDir);
  const changeRoot = path.join(root.changesDir, name);
  await assertInside(root.changesDir, changeRoot);
  const context = loadChangeContext(root.path, name, undefined, { changeDir: changeRoot, planningHome: toPlanningHome(root) });
  if (!context.graph.isComplete(context.completed)) throw new Error('Complete the planning artifacts before review.');
  const implementationRoot = options.implementationRoot
    ? await fs.realpath(options.implementationRoot)
    : isStoreSelectedRoot(root) ? findDeclaringProjectRoot(root.storeId) : root.path;
  if (!implementationRoot) throw new Error('Select --implementation-root for this planning store; no declaring project was found.');
  // Review policy is controlling configuration: invalid YAML/fields must not fall back silently.
  let raw: Record<string, unknown> = {};
  try { raw = parseYaml(await fs.readFile(path.join(implementationRoot, 'openspec/config.yaml'), 'utf8')) ?? {}; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const policy = ReviewPolicySchema.parse(raw.review ?? {});
  const mainHarness = options.mainHarness;
  if (!mainHarness) throw new Error('Select --main-harness explicitly; do not guess the implementing harness.');
  const reviewer = options.reviewer ? ReviewerSchema.parse(options.reviewer)
    : ['codex', 'claude'].includes(mainHarness) ? undefined : policy.reviewer;
  // Verification, decisions and status do not need a reviewer; reviewing stages report selection errors themselves.
  let selected: Reviewer | undefined;
  try { selected = selectReviewer(mainHarness, reviewer); } catch { selected = undefined; }
  // Precedence: CLI flag > stage+reviewer config > reviewer config > reviewer CLI default.
  const settings = { ...(selected ? resolveReviewerSettings(policy, stage, selected) : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}) };
  if (settings.model !== undefined && !settings.model.trim()) throw new Error('--model must not be empty.');
  if (selected) assertReviewerEffort(selected, settings.effort);
  const extraRounds = parseExtraRounds(options.extraRounds);
  return { stage, changeName: name, planningRoot: root.path, changeRoot, implementationRoot,
    mainHarness, reviewer, base: options.base ?? policy.base, timeoutMs: policy.timeoutMs,
    maxRounds: resolveRoundLimit(policy, stage), ...settings,
    ...(extraRounds !== undefined ? { extraRounds } : {}) };
}
export async function reviewCommand(stage: string, options: ReviewOptions): Promise<void> {
      try {
        if (!['requirements', 'code', 'verify', 'decisions', 'status', 'ready-to-implement'].includes(stage)) throw new Error('Stage must be requirements, code, verify, decisions, status, or ready-to-implement.');
        if (stage !== 'requirements' && stage !== 'code' && (options.model !== undefined || options.effort !== undefined || options.extraRounds !== undefined)) {
          throw new Error('--model, --effort, and --extra-rounds apply only to the requirements and code review stages.');
        }
        const request = await resolveReviewRequest(stage === 'requirements' || stage === 'ready-to-implement' ? 'requirements' : 'code', options);
        await ensureDecisionRegister(request.planningRoot);
        let result: unknown;
        if (stage === 'decisions') {
          await acknowledgeDecisions(request.planningRoot, request.changeRoot, request.changeName);
          result = { acknowledged: true };
        } else if (stage === 'verify') {
          result = await runVerification(request, (options.check ?? []).map(value => JSON.parse(value)));
          if ((result as { outcome: string }).outcome !== 'passed') process.exitCode = 1;
        } else if (stage === 'status') {
          result = await getReviewReadiness(request);
          if (!(result as { ready: boolean }).ready) process.exitCode = 1;
        } else if (stage === 'ready-to-implement') {
          await assertRequirementsReviewed(request);
          result = { ready: true };
        } else {
          result = await runReview(request);
          if ((result as { outcome: string }).outcome !== 'passed') process.exitCode = 1;
        }
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) console.log(JSON.stringify({ outcome: 'blocked', error: message }));
        else console.error(message);
        process.exitCode = 1;
      }

}
