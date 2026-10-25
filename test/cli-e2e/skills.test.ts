import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runCLI } from '../helpers/run-cli.js';
import { formatGlobalSkillEntry } from '../../src/cli/commands/skills.js';

const temporaryHomes: string[] = [];

async function createEnvironment(): Promise<NodeJS.ProcessEnv> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-skills-cli-'));
  temporaryHomes.push(home);
  return {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
  };
}

afterAll(async () => {
  await Promise.all(temporaryHomes.map((home) => fs.rm(home, { recursive: true, force: true })));
});

describe('openspec skills install', () => {
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    env = await createEnvironment();
  });

  it('formats Windows JSON paths without splitting the drive letter', () => {
    expect(formatGlobalSkillEntry('C:\\Users\\u\\.agents\\skills:openspec-propose'))
      .toEqual({ directory: 'C:\\Users\\u\\.agents\\skills', skill: 'openspec-propose' });
    expect(formatGlobalSkillEntry('C:\\Users\\u\\.agents\\skills\\openspec-propose'))
      .toEqual({ directory: 'C:\\Users\\u\\.agents\\skills', skill: 'openspec-propose' });
    expect(formatGlobalSkillEntry('C:\\Users\\u\\.agents\\skills\\openspec-propose\\SKILL.md'))
      .toEqual({ directory: 'C:\\Users\\u\\.agents\\skills', skill: 'openspec-propose' });
    expect(formatGlobalSkillEntry('C:\\Users\\u\\.agents\\skills\\.openspec\\install.lock'))
      .toEqual({ path: 'C:\\Users\\u\\.agents\\skills\\.openspec\\install.lock' });
  });

  it('uses absolute XDG_CONFIG_HOME for Devin and OpenCode on Windows', async () => {
    const { resolveGlobalSkillTargets } = await import('../../src/core/global-skills.js');
    const xdgHome = path.join(env.HOME!, 'windows-xdg');
    expect(resolveGlobalSkillTargets(['devin', 'opencode'], {
      homeDir: env.HOME!,
      environment: { XDG_CONFIG_HOME: xdgHome },
      platform: 'win32',
    })).toEqual([
      { directory: path.join(xdgHome, 'devin', 'skills'), tools: ['devin'] },
      { directory: path.join(xdgHome, 'opencode', 'skills'), tools: ['opencode'] },
    ]);
  });

  it('documents the explicit global option and tool selector', async () => {
    const result = await runCLI(['skills', 'install', '--help'], { env });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('--global');
    expect(result.stdout).toContain('--tools <tools>');
  });

  it('installs all supported harness skills by default and emits JSON only', async () => {
    const result = await runCLI(['skills', 'install', '--global', '--json'], { env });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const payload = JSON.parse(result.stdout);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.targets).toHaveLength(5);
    expect(payload.installed).toHaveLength(65);
    expect(payload.conflicts).toEqual([]);
    expect(payload.status).toEqual([]);
  });

  it('installs only the selected harnesses', async () => {
    const result = await runCLI(
      ['skills', 'install', '--global', '--tools', 'claude,cursor', '--json'],
      { env }
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.targets).toHaveLength(2);
    expect(payload.installed).toHaveLength(26);
    expect(payload.installed[0]).toMatchObject({ directory: expect.any(String), skill: expect.any(String) });
    expect(payload.targets.flatMap((target: { tools: string[] }) => target.tools).sort())
      .toEqual(['claude', 'cursor']);
  });

  it('reports restored skills in JSON output', async () => {
    await runCLI(['skills', 'install', '--global', '--tools', 'grok'], { env });
    const skillDirectory = path.join(env.HOME!, '.grok', 'skills', 'openspec-propose');
    await fs.rm(skillDirectory, { recursive: true });

    const result = await runCLI(['skills', 'install', '--global', '--tools', 'grok', '--json'], { env });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.restored).toContainEqual({ directory: path.join(env.HOME!, '.grok', 'skills'), skill: 'openspec-propose' });
    expect(payload.status).toEqual([]);
  });

  it('reports restored skills in human-readable output', async () => {
    await runCLI(['skills', 'install', '--global', '--tools', 'grok'], { env });
    await fs.rm(path.join(env.HOME!, '.grok', 'skills', 'openspec-propose'), { recursive: true });

    const result = await runCLI(['skills', 'install', '--global', '--tools', 'grok'], { env });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Restored: openspec-propose');
  });

  it('rejects combining all with named harnesses as JSON', async () => {
    const result = await runCLI(
      ['skills', 'install', '--global', '--tools', 'all,claude', '--json'],
      { env }
    );
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout).status[0].message).toContain('all cannot be combined');
  });

  it('reports conflicts in a structured JSON result', async () => {
    const collision = path.join(env.HOME!, '.claude', 'skills', 'openspec-propose', 'SKILL.md');
    await fs.mkdir(path.dirname(collision), { recursive: true });
    await fs.writeFile(collision, 'user content');
    const result = await runCLI(
      ['skills', 'install', '--global', '--tools', 'claude', '--json'],
      { env }
    );
    expect(result.exitCode).not.toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.conflicts[0]).toMatchObject({ directory: expect.any(String), skill: 'openspec-propose' });
    expect(payload.status[0]).toMatchObject({ severity: 'error', code: 'global_skill_conflict' });
  });

  it('reports an active install lock as a JSON failure', async () => {
    const lockPath = path.join(env.HOME!, '.claude', 'skills', '.openspec', 'install.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, `${process.pid}\n`);

    const result = await runCLI(
      ['skills', 'install', '--global', '--tools', 'claude', '--json'],
      { env }
    );

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.status[0]).toMatchObject({ severity: 'error', code: 'global_skill_conflict' });
    expect(payload.conflicts[0].reason).toContain('install is still running');
  });

  it('lists installed and refreshed skill paths in human-readable output', async () => {
    const first = await runCLI(
      ['skills', 'install', '--global', '--tools', 'grok'],
      { env }
    );
    const second = await runCLI(
      ['skills', 'install', '--global', '--tools', 'grok'],
      { env }
    );

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('Installed 13 skill files, refreshed 0, and restored 0 across 1 directory.');
    expect(first.stdout).toContain('Installed:');
    expect(first.stdout).toContain('openspec-propose');
    expect(first.stderr).toBe('');
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('refreshed 13, and restored 0');
    expect(second.stdout).toContain('Refreshed:');
    expect(second.stdout).toContain('openspec-propose');
  });

  it('rejects invalid harnesses before writing files', async () => {
    const result = await runCLI(
      ['skills', 'install', '--global', '--tools', 'codex,unknown'],
      { env }
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unsupported harness: unknown');
    await expect(fs.readdir(path.join(env.HOME!, '.agents'))).rejects.toThrow();
  });

  it('rejects an explicitly blank harness selection instead of installing everything', async () => {
    const result = await runCLI(
      ['skills', 'install', '--global', '--tools', ''],
      { env }
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Invalid --tools list');
    await expect(fs.readdir(path.join(env.HOME!, '.agents'))).rejects.toThrow();
  });

  it('requires explicit global scope', async () => {
    const result = await runCLI(['skills', 'install'], { env });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--global');
  });

  it('formats missing global scope as JSON when requested', async () => {
    const result = await runCLI(['skills', 'install', '--json'], { env });
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout).status[0].message).toContain('--global is required');
    expect(JSON.parse(result.stdout)).toMatchObject({ targets: [], installed: [], updated: [], restored: [], skipped: [], conflicts: [] });
  });
});
