import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { resolveOpenSpecRoot, isStoreSelectedRoot, findDeclaringProjectRoot, toPlanningHome } from '../core/root-selection.js';
import { validateChangeExists } from './workflow/shared.js';
import { loadChangeContext } from '../core/artifact-graph/index.js';
import { ReviewPolicySchema, ReviewerSchema, type ReviewRequest } from '../core/review/types.js';
import { runReview } from '../core/review/service.js';
import { getReviewReadiness, runVerification, assertRequirementsReviewed } from '../core/review/readiness.js';
import { acknowledgeDecisions, ensureDecisionRegister } from '../core/decisions.js';
import { assertInside } from '../core/review/fingerprint.js';

interface ReviewOptions {
  change: string; mainHarness?: string; reviewer?: string; base?: string;
  store?: string; implementationRoot?: string; json?: boolean; check?: string[];
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
  return { stage, changeName: name, planningRoot: root.path, changeRoot, implementationRoot,
    mainHarness, reviewer: options.reviewer ? ReviewerSchema.parse(options.reviewer)
      : ['codex', 'claude'].includes(mainHarness) ? undefined : policy.reviewer,
    base: options.base ?? policy.base, timeoutMs: policy.timeoutMs, maxRounds: policy.maxRounds };
}
export async function reviewCommand(stage: string, options: ReviewOptions): Promise<void> {
      try {
        if (!['requirements', 'code', 'verify', 'decisions', 'status', 'ready-to-implement'].includes(stage)) throw new Error('Stage must be requirements, code, verify, decisions, status, or ready-to-implement.');
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
        console.log(options.json ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) console.log(JSON.stringify({ outcome: 'blocked', error: message }));
        else console.error(message);
        process.exitCode = 1;
      }

}
