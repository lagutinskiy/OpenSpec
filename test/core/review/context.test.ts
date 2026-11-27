import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { buildReviewContext, EXHAUSTIVE_PASS } from '../../../src/core/review/context.js';
import { getReviewSnapshot } from '../../../src/core/review/fingerprint.js';

describe('review prompt', () => {
  let root: string;
  let changeRoot: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-context-'));
    changeRoot = path.join(root, 'openspec/changes/example');
    await fs.mkdir(changeRoot, { recursive: true });
    execFileSync('git', ['init', '-q', root]);
    await fs.writeFile(path.join(changeRoot, 'proposal.md'), 'Outcome');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], { cwd: root });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  for (const stage of ['requirements', 'code'] as const) {
    it(`asks the ${stage} reviewer for a scope-bounded convergent pass`, async () => {
      const request = { stage, changeName: 'example', planningRoot: root, implementationRoot: root, changeRoot, mainHarness: 'codex', base: 'HEAD' };
      const prompt = await buildReviewContext(request, await getReviewSnapshot(request));
      expect(prompt).toContain(EXHAUSTIVE_PASS);
      expect(EXHAUSTIVE_PASS).toMatch(/stated scope/);
      expect(EXHAUSTIVE_PASS).toMatch(/Prefer fewer, higher-signal findings/);
      expect(EXHAUSTIVE_PASS).toMatch(/Reuse prior finding IDs/);
      expect(EXHAUSTIVE_PASS).toMatch(/cap new IDs at 5/);
      expect(EXHAUSTIVE_PASS).not.toMatch(/consequences of this round's own findings/);
      expect(prompt).toMatch(/High findings may pass as accepted/);
      expect(prompt).not.toMatch(/Critical\/high accepted risks do not pass/);
      // The instruction precedes the evidence, so no artifact text can sit between it and the task statement.
      expect(prompt.indexOf(EXHAUSTIVE_PASS)).toBeLessThan(prompt.indexOf('Artifact evidence:'));
    });
  }

  it('scopes requirements review to claimed behavior, not whole-product audit', async () => {
    const request = { stage: 'requirements' as const, changeName: 'example', planningRoot: root, implementationRoot: root, changeRoot, mainHarness: 'codex', base: 'HEAD' };
    const prompt = await buildReviewContext(request, await getReviewSnapshot(request));
    expect(prompt).toMatch(/not a pre-implementation audit of the whole product/);
    expect(prompt).toMatch(/Non-Goals/);
  });
});
