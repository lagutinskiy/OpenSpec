import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  type GlobalSkillFileSystem,
  installGlobalSkills,
  resolveGlobalConfigHome,
  resolveGlobalSkillTargets,
} from '../../src/core/global-skills.js';

describe('global OpenSpec skills', () => {
  let homeDir: string;
  let configHome: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-global-skills-'));
    configHome = path.join(homeDir, 'config');
  });

  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('maps all nine harnesses to deduplicated global skill roots', () => {
    const targets = resolveGlobalSkillTargets(
      ['codex', 'claude', 'pi', 'cursor', 'devin', 'opencode', 'warp', 'dsh', 'grok'],
      { homeDir, configHome }
    );

    expect(targets).toEqual([
      { directory: path.join(homeDir, '.agents', 'skills'), tools: ['codex', 'pi', 'cursor', 'warp', 'dsh'] },
      { directory: path.join(homeDir, '.claude', 'skills'), tools: ['claude'] },
      { directory: path.join(configHome, 'devin', 'skills'), tools: ['devin'] },
      { directory: path.join(configHome, 'opencode', 'skills'), tools: ['opencode'] },
      { directory: path.join(homeDir, '.grok', 'skills'), tools: ['grok'] },
    ]);
  });

  it('uses APPDATA only on Windows and gives XDG_CONFIG_HOME precedence', () => {
    expect(resolveGlobalConfigHome(homeDir, { APPDATA: path.join(homeDir, 'roaming') }, 'linux'))
      .toBe(path.join(homeDir, '.config'));
    expect(resolveGlobalConfigHome(homeDir, { APPDATA: path.join(homeDir, 'roaming') }, 'win32'))
      .toBe(path.join(homeDir, 'roaming'));
    expect(resolveGlobalConfigHome(homeDir, {
      APPDATA: path.join(homeDir, 'roaming'),
      XDG_CONFIG_HOME: path.join(homeDir, 'xdg'),
    }, 'win32')).toBe(path.join(homeDir, 'xdg'));

    expect(resolveGlobalSkillTargets(['devin', 'opencode'], {
      homeDir,
      environment: { APPDATA: path.join(homeDir, 'roaming') },
      platform: 'win32',
    })).toEqual([
      { directory: path.join(homeDir, 'roaming', 'devin', 'skills'), tools: ['devin'] },
      { directory: path.join(homeDir, '.config', 'opencode', 'skills'), tools: ['opencode'] },
    ]);
  });

  it('ignores relative XDG_CONFIG_HOME values', () => {
    expect(resolveGlobalConfigHome(homeDir, { XDG_CONFIG_HOME: 'relative/config' }, 'linux'))
      .toBe(path.join(homeDir, '.config'));
  });

  it('installs all workflow skills and preserves unrelated files', async () => {
    const customSkill = path.join(homeDir, '.agents', 'skills', 'my-custom-skill', 'SKILL.md');
    await fs.mkdir(path.dirname(customSkill), { recursive: true });
    await fs.writeFile(customSkill, 'custom content');

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['codex', 'pi'],
      version: '1.15.0',
    });

    expect(result.targets).toHaveLength(1);
    expect(result.installed).toHaveLength(13);
    expect(result.updated).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(await fs.readFile(customSkill, 'utf8')).toBe('custom content');
    expect(await fs.readFile(
      path.join(homeDir, '.agents', 'skills', 'openspec-propose', 'SKILL.md'),
      'utf8'
    )).toContain('generatedBy: "1.15.0"');
  });

  it('writes harness-compatible skill references with no uninstalled command references', async () => {
    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['codex', 'claude', 'pi', 'cursor', 'devin', 'opencode', 'warp', 'dsh', 'grok'],
      version: '1.15.0',
    });

    for (const target of result.targets) {
      for (const skillName of (await fs.readdir(target.directory)).filter((name) => name.startsWith('openspec-'))) {
        const content = await fs.readFile(path.join(target.directory, skillName, 'SKILL.md'), 'utf8');
        expect(content, `${target.directory}/${skillName}`).not.toMatch(/\/opsx:/);
      }
    }

    const shared = await fs.readFile(
      path.join(homeDir, '.agents', 'skills', 'openspec-propose', 'SKILL.md'),
      'utf8'
    );
    expect(shared).toContain('$openspec-apply-change (Codex) or /openspec-apply-change (other agents)');
  });

  it('reports local edits to owned skills without overwriting them', async () => {
    const options = { homeDir, configHome, tools: ['claude'], version: '1.15.0' };
    await installGlobalSkills(options);

    const firstSkill = path.join(homeDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md');
    await fs.writeFile(firstSkill, 'locally edited but installer-owned');

    const result = await installGlobalSkills({ ...options, version: '1.16.0' });

    expect(result.updated).toHaveLength(12);
    expect(result.conflicts.some((entry) => entry.includes(`${firstSkill}: skill was modified locally`))).toBe(true);
    expect(await fs.readFile(firstSkill, 'utf8')).toBe('locally edited but installer-owned');
  });

  it('preserves edited skills from an older manifest without content hashes', async () => {
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const skillPath = path.join(skillsRoot, 'openspec-propose', 'SKILL.md');
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, 'user edits from a legacy install');
    await fs.mkdir(path.join(skillsRoot, '.openspec'), { recursive: true });
    await fs.writeFile(path.join(skillsRoot, '.openspec', 'managed-skills.json'), JSON.stringify({
      formatVersion: 1,
      managedSkills: ['openspec-propose'],
    }));

    const result = await installGlobalSkills({ homeDir, configHome, tools: ['claude'], version: '1.16.0' });

    expect(await fs.readFile(skillPath, 'utf8')).toBe('user edits from a legacy install');
    expect(result.conflicts.some((entry) => entry.includes(`${skillPath}: skill was modified locally`))).toBe(true);
  });

  it('serializes concurrent installs that share a destination', async () => {
    const options = { homeDir, configHome, tools: ['codex'], version: '1.15.0' };
    const results = await Promise.all([installGlobalSkills(options), installGlobalSkills(options)]);

    expect(results.flatMap((result) => result.conflicts)).toEqual([]);
    const manifest = JSON.parse(await fs.readFile(
      path.join(homeDir, '.agents', 'skills', '.openspec', 'managed-skills.json'),
      'utf8'
    ));
    expect(manifest.managedSkills).toHaveLength(13);
    expect(Object.keys(manifest.contentHashes)).toHaveLength(13);
  });

  it('distinguishes a stale lock from a live install', async () => {
    const skillsRoot = path.join(homeDir, '.grok', 'skills');
    const lockPath = path.join(skillsRoot, '.openspec', 'install.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, String(process.pid) + '\n');

    const result = await installGlobalSkills({ homeDir, configHome, tools: ['grok'], version: '1.15.0' });

    expect(result.conflicts.some((entry) => entry.includes('stale install lock remains'))).toBe(true);
    expect(await fs.readFile(lockPath, 'utf8')).toBe(String(process.pid) + '\n');
  });

  it('removes a partially written install lock after lock creation fails', async () => {
    const skillsRoot = path.join(homeDir, '.grok', 'skills');
    const lockPath = path.join(skillsRoot, '.openspec', 'install.lock');
    const fileSystem = Object.assign(Object.create(fs), {
      open: async (filePath: string, flags: Parameters<typeof fs.open>[1]) => {
        if (filePath === lockPath) {
          const handle = await fs.open(filePath, flags);
          return {
            writeFile: async () => { throw new Error('simulated lock write failure'); },
            stat: () => handle.stat(),
            close: () => handle.close(),
          };
        }
        return fs.open(filePath, flags);
      },
    }) as GlobalSkillFileSystem;

    const result = await installGlobalSkills({ homeDir, configHome, tools: ['grok'], version: '1.15.0', fileSystem });

    expect(result.conflicts.some((entry) => entry.includes('simulated lock write failure'))).toBe(true);
    await expect(fs.access(lockPath)).rejects.toThrow();
    await expect(fs.access(path.join(skillsRoot, 'openspec-propose'))).rejects.toThrow();
    await expect(fs.access(skillsRoot)).rejects.toThrow();
  });

  it('removes an empty new skill directory after its first file write fails', async () => {
    const skillDirectory = path.join(homeDir, '.grok', 'skills', 'openspec-propose');
    const fileSystem = Object.assign(Object.create(fs), {
      writeFile: async (filePath: string, ...args: Parameters<typeof fs.writeFile>) => {
        if (filePath.startsWith(`${skillDirectory}${path.sep}SKILL.md.`)) {
          throw new Error('simulated skill write failure');
        }
        return fs.writeFile(filePath, ...args);
      },
    }) as GlobalSkillFileSystem;

    const result = await installGlobalSkills({ homeDir, configHome, tools: ['grok'], version: '1.15.0', fileSystem });

    expect(result.conflicts.some((entry) => entry.includes('simulated skill write failure'))).toBe(true);
    await expect(fs.access(skillDirectory)).rejects.toThrow();
  });

  it('reports a lock release failure without throwing away the install result', async () => {
    const skillsRoot = path.join(homeDir, '.grok', 'skills');
    const lockPath = path.join(skillsRoot, '.openspec', 'install.lock');
    const fileSystem = Object.assign(Object.create(fs), {
      rm: async (filePath: string, options?: Parameters<typeof fs.rm>[1]) => {
        if (filePath === lockPath) throw new Error('simulated lock release failure');
        return fs.rm(filePath, options);
      },
    }) as GlobalSkillFileSystem;

    const result = await installGlobalSkills({ homeDir, configHome, tools: ['grok'], version: '1.15.0', fileSystem });

    expect(result.installed).toHaveLength(13);
    expect(result.conflicts.some((entry) => entry.includes('simulated lock release failure'))).toBe(true);
    await fs.rm(lockPath, { force: true });
  });

  it('leaves a replacement lock owned by another installer untouched', async () => {
    const skillsRoot = path.join(homeDir, '.grok', 'skills');
    const manifestPath = path.join(skillsRoot, '.openspec', 'managed-skills.json');
    const lockPath = path.join(skillsRoot, '.openspec', 'install.lock');
    const fileSystem = Object.assign(Object.create(fs), {
      rename: async (sourcePath: string, destinationPath: string) => {
        const result = await fs.rename(sourcePath, destinationPath);
        if (destinationPath === manifestPath) await fs.writeFile(lockPath, '99999999\nreplacement-token\n');
        return result;
      },
    }) as GlobalSkillFileSystem;

    const result = await installGlobalSkills({ homeDir, configHome, tools: ['grok'], version: '1.15.0', fileSystem });

    expect(result.conflicts.some((entry) => entry.includes('install lock ownership changed'))).toBe(true);
    expect(await fs.readFile(lockPath, 'utf8')).toBe('99999999\nreplacement-token\n');
    await fs.rm(lockPath, { force: true });
  });

  it('reinstalls an owned skill directory that was deleted', async () => {
    const options = { homeDir, configHome, tools: ['claude'], version: '1.15.0' };
    await installGlobalSkills(options);
    const missingDir = path.join(homeDir, '.claude', 'skills', 'openspec-propose');
    await fs.rm(missingDir, { recursive: true });

    const result = await installGlobalSkills({ ...options, version: '1.16.0' });

    expect(result.restored).toHaveLength(1);
    expect(result.updated).toHaveLength(12);
    expect(result.conflicts).toEqual([]);
    expect(await fs.readFile(path.join(missingDir, 'SKILL.md'), 'utf8')).toContain('generatedBy: "1.16.0"');
  });

  it('leaves an unowned skill-name collision untouched and reports it', async () => {
    const collision = path.join(homeDir, '.grok', 'skills', 'openspec-explore', 'SKILL.md');
    await fs.mkdir(path.dirname(collision), { recursive: true });
    await fs.writeFile(collision, 'user-owned skill');

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['grok'],
      version: '1.15.0',
    });

    expect(result.conflicts).toContain(`${path.dirname(collision)}: skill directory exists without OpenSpec ownership metadata`);
    expect(await fs.readFile(collision, 'utf8')).toBe('user-owned skill');
    expect(result.installed).toHaveLength(12);
  });

  it('leaves an unowned skill directory without SKILL.md untouched', async () => {
    const draftDirectory = path.join(homeDir, '.grok', 'skills', 'openspec-explore');
    const notes = path.join(draftDirectory, 'NOTES.md');
    await fs.mkdir(draftDirectory, { recursive: true });
    await fs.writeFile(notes, 'unfinished user draft');

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['grok'],
      version: '1.15.0',
    });

    expect(result.conflicts).toContain(`${draftDirectory}: skill directory exists without OpenSpec ownership metadata`);
    expect(await fs.readFile(notes, 'utf8')).toBe('unfinished user draft');
    await expect(fs.access(path.join(draftDirectory, 'SKILL.md'))).rejects.toThrow();
  });

  it('does not write to a destination with malformed ownership metadata', async () => {
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const manifestPath = path.join(skillsRoot, '.openspec', 'managed-skills.json');
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, '{bad json');

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['claude'],
      version: '1.15.0',
    });

    expect(result.conflicts).toContain(
      `${manifestPath}: malformed ownership metadata`
    );
    expect(await fs.readdir(skillsRoot)).toEqual(['.openspec']);
    await expect(fs.access(path.join(skillsRoot, '.openspec', 'install.lock'))).rejects.toThrow();
  });

  it('preserves ownership entries for skills unknown to this version', async () => {
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const manifestPath = path.join(skillsRoot, '.openspec', 'managed-skills.json');
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify({
      formatVersion: 1,
      managedSkills: ['openspec-retired-workflow'],
    }));

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['claude'],
      version: '1.16.0',
    });

    expect(result.installed).toHaveLength(13);
    expect(result.conflicts).toEqual([]);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    expect(manifest.managedSkills).toContain('openspec-retired-workflow');
  });

  it('does not follow a symlinked managed skill directory during refresh', async () => {
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const externalSkill = path.join(homeDir, 'external-skill');
    const linkedSkill = path.join(skillsRoot, 'openspec-propose');
    await fs.mkdir(path.join(skillsRoot, '.openspec'), { recursive: true });
    await fs.mkdir(externalSkill, { recursive: true });
    await fs.writeFile(path.join(externalSkill, 'SKILL.md'), 'external content');
    await fs.writeFile(
      path.join(skillsRoot, '.openspec', 'managed-skills.json'),
      JSON.stringify({ formatVersion: 1, managedSkills: ['openspec-propose'] })
    );
    await fs.symlink(externalSkill, linkedSkill, process.platform === 'win32' ? 'junction' : 'dir');

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['claude'],
      version: '1.15.0',
    });

    expect(result.conflicts).toContain(`${linkedSkill}: skill directory is a symbolic link`);
    expect(await fs.readFile(path.join(externalSkill, 'SKILL.md'), 'utf8')).toBe('external content');
  });

  it('reports a blocked owned skill and continues with other skills', async () => {
    const skillsRoot = path.join(homeDir, '.agents', 'skills');
    const manifestPath = path.join(skillsRoot, '.openspec', 'managed-skills.json');
    const blockedDirectory = path.join(skillsRoot, 'openspec-review-change', 'SKILL.md');
    const sentinel = path.join(blockedDirectory, 'user-file.txt');
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(blockedDirectory, { recursive: true });
    await fs.writeFile(sentinel, 'user-owned data');
    await fs.writeFile(manifestPath, JSON.stringify({
      formatVersion: 1,
      managedSkills: ['openspec-review-change'],
    }));

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['codex', 'claude'],
      version: '1.15.0',
    });

    expect(result.conflicts).toContain(
      `${path.dirname(blockedDirectory)}: owned skill is missing or malformed`
    );
    expect(await fs.readFile(sentinel, 'utf8')).toBe('user-owned data');
    expect(result.installed).toHaveLength(25);
    expect(result.updated).toEqual([]);
    expect(result.targets).toHaveLength(2);
  });

  it('checks ownership-directory writability before writing skills', async () => {
    const grokSkills = path.join(homeDir, '.grok', 'skills');
    const ownershipDirectory = path.join(grokSkills, '.openspec');
    await fs.mkdir(ownershipDirectory, { recursive: true });
    const fileSystem = Object.assign(Object.create(fs), {
      writeFile: async (filePath: string, ...args: Parameters<typeof fs.writeFile>) => {
        if (filePath.startsWith(`${ownershipDirectory}${path.sep}.write-probe-`)) {
          throw Object.assign(new Error('simulated permission failure'), { code: 'EACCES' });
        }
        return fs.writeFile(filePath, ...args);
      },
    }) as GlobalSkillFileSystem;
    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['grok', 'claude'],
      version: '1.15.0',
      fileSystem,
    });

    expect(result.skipped).toContain(grokSkills);
    expect(result.conflicts.some((entry) => entry.includes(`${ownershipDirectory}: ownership directory is not writable`)))
      .toBe(true);
    await expect(fs.access(path.join(grokSkills, 'openspec-propose'))).rejects.toThrow();
    expect(result.installed).toHaveLength(13);
    await expect(fs.access(path.join(grokSkills, '.openspec', 'install.lock'))).rejects.toThrow();
  });

  it('rolls back a newly created skill if ownership metadata cannot be recorded', async () => {
    const skillsRoot = path.join(homeDir, '.grok', 'skills');
    const manifestPath = path.join(skillsRoot, '.openspec', 'managed-skills.json');
    const fileSystem = Object.assign(Object.create(fs), {
      rename: async (sourcePath: string, destinationPath: string) => {
        if (destinationPath === manifestPath) throw new Error('simulated manifest write failure');
        return fs.rename(sourcePath, destinationPath);
      },
    }) as GlobalSkillFileSystem;

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['grok'],
      version: '1.15.0',
      fileSystem,
    });

    expect(result.skipped).toContain(path.join(skillsRoot, 'openspec-explore'));
    expect(result.conflicts.some((entry) => entry.includes('simulated manifest write failure'))).toBe(true);
    await expect(fs.access(path.join(skillsRoot, 'openspec-explore'))).rejects.toThrow();
    expect(result.installed).toHaveLength(0);
  });

  it('removes a failed restoration file while preserving other files in its directory', async () => {
    const skillsRoot = path.join(homeDir, '.grok', 'skills');
    const manifestPath = path.join(skillsRoot, '.openspec', 'managed-skills.json');
    const skillDirectory = path.join(skillsRoot, 'openspec-propose');
    const skillPath = path.join(skillDirectory, 'SKILL.md');
    const notesPath = path.join(skillDirectory, 'NOTES.md');
    await installGlobalSkills({ homeDir, configHome, tools: ['grok'], version: '1.15.0' });
    await fs.rm(skillPath);
    await fs.writeFile(notesPath, 'user notes');
    const fileSystem = Object.assign(Object.create(fs), {
      rename: async (sourcePath: string, destinationPath: string) => {
        if (destinationPath === manifestPath) throw new Error('simulated manifest write failure');
        return fs.rename(sourcePath, destinationPath);
      },
    }) as GlobalSkillFileSystem;

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['grok'],
      version: '1.16.0',
      fileSystem,
    });

    expect(result.conflicts.some((entry) => entry.includes('simulated manifest write failure'))).toBe(true);
    expect(await fs.readFile(notesPath, 'utf8')).toBe('user notes');
    await expect(fs.access(skillPath)).rejects.toThrow();
  });

  it('reports a plain file at a skill path without calling it a directory', async () => {
    const blockedPath = path.join(homeDir, '.grok', 'skills', 'openspec-explore');
    await fs.mkdir(path.dirname(blockedPath), { recursive: true });
    await fs.writeFile(blockedPath, 'user-owned file');

    const result = await installGlobalSkills({
      homeDir,
      configHome,
      tools: ['grok'],
      version: '1.15.0',
    });

    expect(result.conflicts).toContain(`${blockedPath}: skill path exists without OpenSpec ownership metadata`);
    expect(result.skipped).toContain(blockedPath);
    expect(await fs.readFile(blockedPath, 'utf8')).toBe('user-owned file');
  });

  it('rejects unsupported harnesses before writing any skills', async () => {
    await expect(installGlobalSkills({
      homeDir,
      configHome,
      tools: ['codex', 'unknown'],
      version: '1.15.0',
    })).rejects.toThrow('Unsupported harness: unknown');

    await expect(fs.access(path.join(homeDir, '.agents'))).rejects.toThrow();
  });
});
