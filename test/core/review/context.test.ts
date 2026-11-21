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
    it(`asks the ${stage} reviewer for one exhaustive pass`, async () => {
      const request = { stage, changeName: 'example', planningRoot: root, implementationRoot: root, changeRoot, mainHarness: 'codex', base: 'HEAD' };
      const prompt = await buildReviewContext(request, await getReviewSnapshot(request));
      expect(prompt).toContain(EXHAUSTIVE_PASS);
      expect(EXHAUSTIVE_PASS).toMatch(/Report every defect you find/);
      expect(EXHAUSTIVE_PASS).toMatch(/do not hold findings back for a later round/);
      // The instruction precedes the evidence, so no artifact text can sit between it and the task statement.
      expect(prompt.indexOf(EXHAUSTIVE_PASS)).toBeLessThan(prompt.indexOf('Artifact evidence:'));
    });
  }
});
