/** Existing archive/spec tests use completed lifecycle fixtures. New review tests
 * use runCLI directly so missing/stale evidence continues to exercise preflight. */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runCLI } from './run-cli.js';
import { runReview } from '../../src/core/review/service.js';
import { runVerification } from '../../src/core/review/readiness.js';
import { acknowledgeDecisions } from '../../src/core/decisions.js';

export async function seedReviewedChange(planningRoot: string, changeName: string, implementationRoot = planningRoot): Promise<void> {
  const changeRoot = path.join(planningRoot, 'openspec/changes', changeName);
  try { if (!(await fs.lstat(changeRoot)).isDirectory()) return; } catch { return; }
  try { execFileSync('git', ['-C', implementationRoot, 'rev-parse', '--show-toplevel'], { stdio: 'ignore' }); }
  catch { execFileSync('git', ['init', '-q', implementationRoot]); }
  let base: string;
  try { base = execFileSync('git', ['-C', implementationRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch {
    execFileSync('git', ['-C', implementationRoot, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'fixture base']);
    base = 'HEAD';
  }
  const req = { stage: 'requirements' as const, changeName, changeRoot, planningRoot, implementationRoot, mainHarness: 'codex', base };
  const passing = async () => ({ outcome: 'passed', summary: 'Reviewed fixture', findings: [] });
  await runReview(req, passing);
  await runVerification({ ...req, stage: 'code' }, [[process.execPath, '-e', 'process.exit(0)']]);
  await runReview({ ...req, stage: 'code' }, passing);
  await acknowledgeDecisions(planningRoot, changeRoot, changeName);
}

export async function runReviewedCLI(...args: Parameters<typeof runCLI>): ReturnType<typeof runCLI> {
  const [argv, options] = args;
  if (argv[0] === 'archive' && options?.cwd) {
    const store = argv.indexOf('--store');
    const afterDash = argv.indexOf('--');
    const name = afterDash >= 0 ? argv[afterDash + 1] : argv[1];
    if (name && !name.startsWith('--')) {
      let planningRoot = options.cwd;
      {
        const result = await runCLI(['status', '--change', name, '--json', ...(store >= 0 ? ['--store', argv[store + 1]] : [])], options);
        try { planningRoot = JSON.parse(result.stdout).planningHome?.root ?? JSON.parse(result.stdout).root?.path ?? planningRoot; } catch { /* Invalid roots stay invalid. */ }
      }
      await seedReviewedChange(planningRoot, name);
    }
  }
  return runCLI(...args);
}

export { cliProjectRoot, testBinary, ensureCliBuilt, terminateActiveCliChildren } from "./run-cli.js";
