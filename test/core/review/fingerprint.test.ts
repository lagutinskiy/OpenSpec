import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { getReviewSnapshot } from '../../../src/core/review/fingerprint.js';
import { ReviewReportSchema } from '../../../src/core/review/types.js';

describe('review evidence identity', () => {
  let root: string;
  let changeRoot: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-snapshot-'));
    changeRoot = path.join(root, 'openspec/changes/example');
    await fs.mkdir(changeRoot, { recursive: true });
    execFileSync('git', ['init', '-q', root]);
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored\n');
    await fs.writeFile(path.join(root, 'app.ts'), 'old');
    await fs.writeFile(path.join(changeRoot, 'proposal.md'), 'Outcome');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], { cwd: root });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const request = () => ({ stage: 'code' as const, changeName: 'example', planningRoot: root, implementationRoot: root, changeRoot, mainHarness: 'codex', base: 'HEAD' });
  it('hashes actual staged, unstaged and untracked content, excluding review output', async () => {
    const original = await getReviewSnapshot(request());
    await fs.writeFile(path.join(root, 'app.ts'), 'new');
    const modified = await getReviewSnapshot(request());
    expect(modified.hash).not.toBe(original.hash);
    execFileSync('git', ['add', 'app.ts'], { cwd: root });
    expect((await getReviewSnapshot(request())).hash).toBe(modified.hash);
    await fs.writeFile(path.join(root, 'extra.ts'), 'extra');
    const untracked = await getReviewSnapshot(request());
    expect(untracked.hash).not.toBe(modified.hash);
    await fs.mkdir(path.join(changeRoot, 'reviews'));
    await fs.writeFile(path.join(changeRoot, 'reviews/code.json'), '{}');
    await fs.writeFile(path.join(root, 'ignored'), 'ignore');
    expect((await getReviewSnapshot(request())).hash).toBe(untracked.hash);
  });
  it('invalidates requirements review on planning edits, not implementation edits', async () => {
    const req = { ...request(), stage: 'requirements' as const };
    const original = await getReviewSnapshot(req);
    await fs.writeFile(path.join(root, 'app.ts'), 'new');
    expect((await getReviewSnapshot(req)).hash).toBe(original.hash);
    await fs.writeFile(path.join(changeRoot, 'proposal.md'), 'Changed outcome');
    expect((await getReviewSnapshot(req)).hash).not.toBe(original.hash);
  });
  it('rejects change paths outside the planning root', async () => {
    await expect(getReviewSnapshot({ ...request(), changeRoot: path.dirname(root) })).rejects.toThrow(/outside/);
  });
  it('rejects passed reports containing unresolved blocking findings', () => {
    expect(ReviewReportSchema.safeParse({ outcome: 'passed', summary: 'OK', findings: [{ id: 'R1', severity: 'high', message: 'Loss', evidence: 'app.ts', disposition: 'open' }] }).success).toBe(false);
  });
  it('tracks application reviews directories while keeping code dispositions out of requirements approval', async () => {
    const requirementRequest = { ...request(), stage: 'requirements' as const };
    const before = await getReviewSnapshot(requirementRequest);
    await fs.mkdir(path.join(changeRoot, 'reviews'));
    await fs.writeFile(path.join(changeRoot, 'reviews/code-dispositions.md'), 'Code finding fixed');
    expect((await getReviewSnapshot(requirementRequest)).hash).toBe(before.hash);
    await fs.mkdir(path.join(root, 'src/reviews'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/reviews/api.ts'), 'old');
    const code = await getReviewSnapshot(request());
    await fs.writeFile(path.join(root, 'src/reviews/api.ts'), 'new');
    expect((await getReviewSnapshot(request())).hash).not.toBe(code.hash);
  });

  it.skipIf(process.platform === 'win32')('invalidates code evidence on executable mode changes', async () => {
    const before = await getReviewSnapshot(request());
    await fs.chmod(path.join(root, 'app.ts'), 0o755);
    expect((await getReviewSnapshot(request())).hash).not.toBe(before.hash);
  });
  it('invalidates relevant decision changes but permits unrelated decisions', async () => {
    const file = path.join(root, 'openspec/decisions.md');
    const req = { ...request(), stage: 'requirements' as const };
    const before = await getReviewSnapshot(req);
    await fs.writeFile(file, '| D-001 | Other question | open | owner | other | no | Follow up | |');
    expect((await getReviewSnapshot(req)).hash).toBe(before.hash);
    await fs.appendFile(file, '\n| D-002 | Export format | resolved | owner | example | no | | CSV |');
    const relevant = await getReviewSnapshot(req);
    expect(relevant.hash).not.toBe(before.hash);
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('CSV', 'JSON'));
    expect((await getReviewSnapshot(req)).hash).not.toBe(relevant.hash);
  });

  it('fingerprints checked-out submodule contents and catches dirty edits', async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), 'review-submodule-'));
    try {
      execFileSync('git', ['init', '-q', source]);
      await fs.writeFile(path.join(source, 'lib.ts'), 'old');
      execFileSync('git', ['-C', source, 'add', '.']);
      execFileSync('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'library']);
      execFileSync('git', ['-C', root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'vendor/library']);
      const before = await getReviewSnapshot(request());
      await fs.writeFile(path.join(root, 'vendor/library/lib.ts'), 'new');
      expect((await getReviewSnapshot(request())).hash).not.toBe(before.hash);
    } finally { await fs.rm(source, { recursive: true, force: true }); }
  });

});
