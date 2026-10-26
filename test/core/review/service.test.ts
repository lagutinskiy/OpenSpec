import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runReview, selectReviewer, readCurrentReview, countFailedRounds } from '../../../src/core/review/service.js';

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

  describe('round limit', () => {
    const finding = (id: string, disposition = 'open') => ({ id, severity: 'medium', message: `Issue ${id}`, evidence: 'proposal.md', disposition, reason: '' });
    const changes = (...ids: string[]) => async () => ({ outcome: 'changes_required', summary: 'Fix', findings: ids.map(id => finding(id)) });
    const blocked = async () => { throw new Error('codex timed out'); };
    const passed = async () => ({ outcome: 'passed', summary: 'OK', findings: [] });
    const limited = (overrides: object = {}) => ({ ...request(), maxRounds: 2, ...overrides });
    const evidence = async () => {
      const dir = path.join(changeRoot, 'reviews');
      const names = (await fs.readdir(dir)).filter(name => name.endsWith('.json')).sort();
      return Promise.all(names.map(async name => [name, await fs.readFile(path.join(dir, name), 'utf8')]));
    };

    it('counts changes_required since the last pass and ignores blocked rounds', async () => {
      await runReview(limited(), changes('A'));
      await runReview(limited(), blocked);
      expect((await countFailedRounds(changeRoot, 'requirements')).count).toBe(1);
      await runReview(limited(), passed);
      expect((await countFailedRounds(changeRoot, 'requirements')).count).toBe(0);
      await runReview(limited(), changes('B'));
      expect((await countFailedRounds(changeRoot, 'requirements')).count).toBe(1);
      expect((await countFailedRounds(changeRoot, 'code')).count).toBe(0);
    });

    it('stops at the limit without starting the reviewer or writing evidence', async () => {
      await runReview(limited(), changes('A'));
      await runReview(limited(), changes('B', 'C'));
      const before = await evidence();
      let started = false;
      const result = await runReview(limited(), async () => { started = true; return passed(); });
      expect(started).toBe(false);
      expect(result).toMatchObject({ outcome: 'limit_reached', stage: 'requirements', count: 2, limit: 2, extraRounds: 0, findingsRound: 2, latestRound: 2 });
      expect((result as { openFindings: { id: string }[] }).openFindings.map(item => item.id)).toEqual(['B', 'C']);
      expect(result).not.toHaveProperty('latestBlockedSummary');
      expect(await evidence()).toEqual(before);
      expect(await readCurrentReview(request())).not.toMatchObject({ outcome: 'passed' });
    });

    it('reports findings from the newest changes_required round when the latest round is blocked', async () => {
      await runReview(limited(), changes('A'));
      await runReview(limited(), changes('B'));
      await runReview(limited({ extraRounds: 1 }), blocked);
      const result = await runReview(limited(), passed);
      expect(result).toMatchObject({ outcome: 'limit_reached', findingsRound: 2, latestRound: 3, latestBlockedSummary: 'codex timed out' });
      expect((result as { openFindings: { id: string }[] }).openFindings.map(item => item.id)).toEqual(['B']);
    });

    it('omits fixed findings from the open list', async () => {
      await runReview(limited({ maxRounds: 1 }), async () => ({ outcome: 'changes_required', summary: 'Fix', findings: [finding('A', 'fixed'), finding('B')] }));
      const result = await runReview(limited({ maxRounds: 1 }), passed);
      expect((result as { openFindings: { id: string }[] }).openFindings.map(item => item.id)).toEqual(['B']);
    });

    it('allows extra rounds only for the command that carries them and records the allowance', async () => {
      await runReview(limited(), changes('A'));
      await runReview(limited(), changes('B'));
      const extra = await runReview(limited({ extraRounds: 2 }), changes('C'));
      expect(extra.outcome).toBe('changes_required');
      expect((extra as { request: { extraRounds?: number } }).request.extraRounds).toBe(2);
      expect((await runReview(limited(), passed)).outcome).toBe('limit_reached');
      await runReview(limited({ extraRounds: 2 }), changes('D'));
      expect((await runReview(limited({ extraRounds: 2 }), passed))).toMatchObject({ outcome: 'limit_reached', count: 4, extraRounds: 2 });
      expect((await runReview(limited({ extraRounds: 3 }), passed)).outcome).toBe('passed');
      expect((await runReview(limited(), changes('E'))).outcome).toBe('changes_required');
    });

    it('defaults to three rounds when no limit is supplied', async () => {
      for (const id of ['A', 'B', 'C']) await runReview(request(), changes(id));
      expect((await runReview(request(), passed)).outcome).toBe('limit_reached');
    });

    it('rejects invalid extra rounds and effort before reviewing', async () => {
      await expect(runReview(limited({ extraRounds: 0 }), passed)).rejects.toThrow(/extra-rounds/);
      await expect(runReview(limited({ extraRounds: 21 }), passed)).rejects.toThrow(/extra-rounds/);
      // mainHarness codex is reviewed by Claude, which has no "minimal" effort.
      await expect(runReview(limited({ effort: 'minimal' }), passed)).rejects.toThrow(/claude.*minimal/);
      await expect(fs.readdir(path.join(changeRoot, 'reviews'))).rejects.toThrow();
    });
  });

  it('records reviewer settings and keeps reviews current when settings change', async () => {
    const result = await runReview({ ...request(), model: 'opus', effort: 'high' }, async () => ({ outcome: 'passed', summary: 'OK', findings: [] }));
    expect(result).toMatchObject({ request: { model: 'opus', effort: 'high' } });
    const saved = JSON.parse(await fs.readFile(path.join(changeRoot, 'reviews/requirements.json'), 'utf8'));
    expect(saved.request).toMatchObject({ model: 'opus', effort: 'high' });
    expect((await readCurrentReview({ ...request(), effort: 'low' }))?.outcome).toBe('passed');
  });

  it('saves the reviewer diagnostic when a model is rejected', async () => {
    const result = await runReview({ ...request(), model: 'nope' }, async () => { throw new Error('Claude review did not complete successfully: model "nope" is not available'); });
    expect(result).toMatchObject({ outcome: 'blocked', request: { model: 'nope' } });
    const saved = JSON.parse(await fs.readFile(path.join(changeRoot, 'reviews/requirements.json'), 'utf8'));
    expect(saved.summary).toMatch(/model "nope" is not available/);
  });

  it('keeps reports written before reviewer settings existed valid', async () => {
    await runReview(request(), async () => ({ outcome: 'passed', summary: 'OK', findings: [] }));
    const file = path.join(changeRoot, 'reviews/requirements.json');
    const legacy = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(legacy.request).not.toHaveProperty('model');
    expect(legacy.request).not.toHaveProperty('effort');
    expect(legacy.request).not.toHaveProperty('extraRounds');
    expect((await readCurrentReview(request()))?.outcome).toBe('passed');
  });

});
