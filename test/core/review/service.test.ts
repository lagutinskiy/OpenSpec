import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runReview, selectReviewer, readCurrentReview } from '../../../src/core/review/service.js';

describe('independent review service', () => {
  let root: string;
  let changeRoot: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-service-'));
    changeRoot = path.join(root, 'openspec/changes/example');
    await fs.mkdir(changeRoot, { recursive: true });
    await fs.writeFile(path.join(changeRoot, 'proposal.md'), 'Users can export data.');
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const request = () => ({ stage: 'requirements' as const, changeName: 'example', planningRoot: root, implementationRoot: root, changeRoot, mainHarness: 'codex' });
  it('routes reciprocal reviewers and requires configuration for other harnesses', () => {
    expect(selectReviewer('codex')).toBe('claude');
    expect(selectReviewer('claude')).toBe('codex');
    expect(() => selectReviewer('pi')).toThrow(/configure/);
    expect(selectReviewer('pi', 'codex')).toBe('codex');
    expect(() => selectReviewer('codex', 'codex')).toThrow(/independent/);
    expect(() => selectReviewer('unknown', 'claude')).toThrow(/Unsupported/);
  });
  it('persists validated reports and detects subsequent planning edits', async () => {
    const result = await runReview(request(), async () => ({ outcome: 'passed', summary: 'Requirements are clear.', findings: [] }));
    expect(result.reviewer).toBe('claude');
    expect((await readCurrentReview(request()))?.outcome).toBe('passed');
    await fs.writeFile(path.join(changeRoot, 'proposal.md'), 'New scope');
    expect(await readCurrentReview(request())).toBeNull();
  });
  it('does not approve changes made during a review', async () => {
    const result = await runReview(request(), async () => {
      await fs.writeFile(path.join(changeRoot, 'proposal.md'), 'Changed during review');
      return { outcome: 'passed', summary: 'OK', findings: [] };
    });
    expect(result.outcome).toBe('blocked');
    expect(result.summary).toMatch(/changed/);
  });
  it('records failures and malformed reports as blocked instead of passed', async () => {
    expect((await runReview(request(), async () => { throw new Error('authentication required'); })).outcome).toBe('blocked');
    expect((await runReview(request(), async () => ({ outcome: 'passed', findings: [] }))).outcome).toBe('blocked');
  });
  it('recovers a lock left by a process that no longer exists', async () => {
    const dir = path.join(changeRoot, 'reviews');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'requirements.lock'), JSON.stringify({ pid: 2147483647 }));
    const result = await runReview(request(), async () => ({ outcome: 'passed', summary: 'Reviewed', findings: [] }));
    expect(result.outcome).toBe('passed');
  });

  it('allows at most one concurrent recovery of a dead reviewer lock', async () => {
    const dir = path.join(changeRoot, 'reviews');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'requirements.lock'), JSON.stringify({ pid: 2147483647 }));
    let active = 0;
    let maximum = 0;
    const runner = async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 80));
      active--;
      return { outcome: 'passed', summary: 'Reviewed', findings: [] };
    };
    const results = await Promise.allSettled([runReview(request(), runner), runReview(request(), runner)]);
    expect(maximum).toBe(1);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('blocks evidence symlinks that would disclose files outside the change', async () => {
    const outside = path.join(root, 'outside.json');
    await fs.writeFile(outside, 'private content');
    await fs.mkdir(path.join(changeRoot, 'reviews'));
    await fs.symlink(outside, path.join(changeRoot, 'reviews/verification.json'));
    const result = await runReview(request(), async () => ({ outcome: 'passed', summary: 'Reviewed', findings: [] }));
    expect(result.outcome).toBe('blocked');
    expect(result.summary).toMatch(/outside/);
  });

});
