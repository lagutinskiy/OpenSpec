import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { runReview } from '../../../src/core/review/service.js';
import { getReviewReadiness, runVerification, assertArchiveReady } from '../../../src/core/review/readiness.js';
import { acknowledgeDecisions } from '../../../src/core/decisions.js';

describe('review lifecycle readiness', () => {
  let root: string;
  let changeRoot: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-ready-'));
    changeRoot = path.join(root, 'openspec/changes/example');
    await fs.mkdir(changeRoot, { recursive: true });
    await fs.writeFile(path.join(changeRoot, 'proposal.md'), 'Export data');
    await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [x] Export');
    await fs.writeFile(path.join(root, 'app.ts'), 'base');
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], { cwd: root });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const request = () => ({ stage: 'code' as const, changeName: 'example', planningRoot: root, implementationRoot: root, changeRoot, mainHarness: 'codex', base: 'HEAD' });
  const passing = async () => ({ outcome: 'passed', summary: 'Reviewed', findings: [] });
  it('requires reviews, actual verification, and decision acknowledgement', async () => {
    await expect(assertArchiveReady(root, changeRoot, 'example')).rejects.toThrow(/review/i);
    await runReview({ ...request(), stage: 'requirements' }, passing);
    await runVerification(request(), [[process.execPath, '-e', 'console.log("verified")']]);
    await runReview(request(), passing);
    expect((await getReviewReadiness(request())).ready).toBe(false);
    await acknowledgeDecisions(root, changeRoot, 'example');
    expect(await getReviewReadiness(request())).toEqual({ ready: true, blockers: [] });
    await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [ ] Export');
    expect((await getReviewReadiness(request())).blockers.join(' ')).toMatch(/incomplete/);
    await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [x] Export');
    await fs.writeFile(path.join(root, 'app.ts'), 'changed');
    expect((await getReviewReadiness(request())).ready).toBe(false);
  });
  it('does not accept empty verification or failing commands', async () => {
    await expect(runVerification(request(), [])).rejects.toThrow(/command/);
    const result = await runVerification(request(), [[process.execPath, '-e', 'process.exit(1)']]);
    expect(result.outcome).toBe('failed');
  });
  it('requires reviewed requirements before code review', async () => {
    await expect(runReview(request(), passing)).rejects.toThrow(/Requirements review/);
  });
});
