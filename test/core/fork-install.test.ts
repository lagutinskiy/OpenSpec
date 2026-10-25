import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { InitCommand } from '../../src/core/init.js';
import { UpdateCommand } from '../../src/core/update.js';

const harnesses = ['codex', 'claude', 'pi', 'cursor', 'devin', 'opencode', 'warp', 'dsh', 'grok'];
describe('private harness installation', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fork-install-'));
    vi.stubEnv('XDG_CONFIG_HOME', path.join(root, 'config'));
    vi.stubEnv('HOME', path.join(root, 'home'));
    vi.stubEnv('USERPROFILE', path.join(root, 'home'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
  it.each(harnesses)('installs review and verification skills for %s', async harness => {
    await new InitCommand({ tools: harness, force: true }).execute(root);
    expect(await fs.readdir(root)).not.toContain('.github');
    const skillRoot = path.join(root, harness === 'codex' ? '.agents' : '.' + harness, 'skills');
    expect(await fs.readFile(path.join(skillRoot, 'openspec-review-change/SKILL.md'), 'utf8')).toContain('Independent review lifecycle');
    expect(await fs.stat(path.join(skillRoot, 'openspec-verify-change/SKILL.md'))).toBeDefined();
  });
  it('refreshes retained skills without changing a removed harness directory', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(root);
    await fs.mkdir(path.join(root, '.gemini'), { recursive: true });
    await fs.writeFile(path.join(root, '.gemini/custom.txt'), 'preserve');
    await new UpdateCommand({ force: true }).execute(root);
    expect(await fs.readFile(path.join(root, '.gemini/custom.txt'), 'utf8')).toBe('preserve');
    expect(await fs.readdir(path.join(root, '.gemini'))).toEqual(['custom.txt']);
  });
  it('rejects removed tool selection before generating tool files', async () => {
    await expect(new InitCommand({ tools: 'gemini', force: true }).execute(root)).rejects.toThrow(/gemini/);
    await expect(fs.stat(path.join(root, '.gemini'))).rejects.toThrow();
  });
});
