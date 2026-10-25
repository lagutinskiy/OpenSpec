import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { UpdateCommand } from '../../src/core/update.js';
import { InitCommand } from '../../src/core/init.js';
import { ALL_WORKFLOWS } from '../../src/core/profiles.js';
import { getGlobalConfigPath, type GlobalConfig } from '../../src/core/global-config.js';
import type { UpdatePlanChange } from '../../src/core/update-plan.js';

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));

vi.mock('@inquirer/prompts', () => ({ confirm: confirmMock }));

vi.mock('../../src/utils/interactive.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/interactive.js')>();
  return { ...actual, isInteractive: () => false };
});

/**
 * Writes the real global config file, so the dry run and the real update read
 * the same settings the way they do in production.
 */
async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  const configPath = getGlobalConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

/** Absolute path -> file content, for every file under `root`. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.set(full, await fs.readFile(full, 'utf-8'));
      }
    }
  }
  await walk(root);
  return files;
}

function diffTrees(
  before: Map<string, string>,
  after: Map<string, string>,
  projectPath: string
): Array<{ path: string; action: 'add' | 'update' | 'delete' }> {
  const changes: Array<{ path: string; action: 'add' | 'update' | 'delete' }> = [];
  const rel = (file: string) => path.relative(projectPath, file).split(path.sep).join('/');

  for (const [file, content] of after) {
    if (!before.has(file)) {
      changes.push({ path: rel(file), action: 'add' });
    } else if (before.get(file) !== content) {
      changes.push({ path: rel(file), action: 'update' });
    }
  }
  for (const file of before.keys()) {
    if (!after.has(file)) {
      changes.push({ path: rel(file), action: 'delete' });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

function withoutTool(changes: UpdatePlanChange[]) {
  return changes
    .map(({ path: filePath, action }) => ({ path: filePath, action }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe('openspec update --dry-run', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-dry-run-'));
    process.env.CODEX_HOME = path.join(testDir, 'codex-home');
    process.env.HOME = path.join(testDir, 'home');
    process.env.USERPROFILE = path.join(testDir, 'home');
    process.env.XDG_CONFIG_HOME = path.join(testDir, 'xdg-config');
    await writeGlobalConfig({ profile: 'core', delivery: 'both' });
    confirmMock.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
  });

  afterEach(async () => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * The contract: the plan lists exactly what a real update then changes.
   */
  async function expectPlanMatchesRealUpdate(
    options: { force?: boolean } = {}
  ): Promise<UpdatePlanChange[]> {
    return (await expectFullPlanMatchesRealUpdate(options)).changes;
  }

  /**
   * The same contract, including failures: a tool the real update fails on is
   * one the plan reports in `failures`, and the files either side of the
   * failure are the ones the real update leaves.
   */
  async function expectFullPlanMatchesRealUpdate(options: { force?: boolean } = {}) {
    const before = await snapshotTree(testDir);

    const plan = await new UpdateCommand({ ...options, dryRun: true }).plan(testDir);

    // A dry run writes nothing.
    expect(await snapshotTree(testDir)).toEqual(before);

    let realError: Error | undefined;
    try {
      await new UpdateCommand(options).execute(testDir);
    } catch (error) {
      realError = error as Error;
    }
    const after = await snapshotTree(testDir);

    expect(withoutTool(plan.changes)).toEqual(diffTrees(before, after, testDir));
    const failedTools = realError?.message.match(/^OpenSpec update failed for: (.*)$/u)?.[1];
    expect(new Set(plan.failures.map((failure) => failure.tool)).size).toBe(
      failedTools ? failedTools.split(', ').length : 0
    );
    if (!failedTools && realError) throw realError;
    return plan;
  }

  it('plans nothing for a fresh install', async () => {
    const changes = await expectPlanMatchesRealUpdate();
    expect(changes).toEqual([]);
  });

  it('plans an update for a skill file that drifted from the generated content', async () => {
    const skillFile = path.join(testDir, '.claude', 'skills', 'openspec-propose', 'SKILL.md');
    await fs.writeFile(skillFile, 'hand-edited\n');

    const changes = await expectPlanMatchesRealUpdate();

    expect(changes).toContainEqual({
      path: '.claude/skills/openspec-propose/SKILL.md',
      action: 'update',
      tool: 'claude',
    });
  });

  it('plans additions for newly selected workflows', async () => {
    await writeGlobalConfig({ profile: 'custom', delivery: 'both', workflows: [...ALL_WORKFLOWS] });

    const changes = await expectPlanMatchesRealUpdate();

    expect(changes).toContainEqual({
      path: '.claude/skills/openspec-onboard/SKILL.md',
      action: 'add',
      tool: 'claude',
    });
    expect(changes.every((change) => change.tool === 'claude')).toBe(true);
  });

  it('plans deletions for deselected workflows', async () => {
    await writeGlobalConfig({ profile: 'custom', delivery: 'both', workflows: ['propose'] });

    const changes = await expectPlanMatchesRealUpdate();

    expect(changes).toContainEqual({
      path: '.claude/skills/openspec-archive-change/SKILL.md',
      action: 'delete',
      tool: 'claude',
    });
  });

  it('plans deletions for command files when delivery becomes skills-only', async () => {
    await writeGlobalConfig({ profile: 'core', delivery: 'skills' });

    const changes = await expectPlanMatchesRealUpdate();

    expect(changes).toContainEqual({
      path: '.claude/commands/opsx/propose.md',
      action: 'delete',
      tool: 'claude',
    });
  });

  it('plans a forced upgrade of tools found only in legacy artifacts, and their cleanup', async () => {
    // Cursor is not configured; only its pre-opsx command remains. A forced
    // update sets Cursor up and removes the legacy files. The plan has to list
    // both, from the same code path.
    const legacyBlock = '<!-- OPENSPEC:START -->\nold instructions\n<!-- OPENSPEC:END -->\n';
    await fs.mkdir(path.join(testDir, '.cursor', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, '.cursor', 'commands', 'openspec-proposal.md'),
      legacyBlock
    );
    await fs.writeFile(path.join(testDir, 'CLAUDE.md'), `# Project\n\n${legacyBlock}`);
    await fs.writeFile(path.join(testDir, 'openspec', 'AGENTS.md'), 'legacy agents\n');

    const changes = await expectPlanMatchesRealUpdate({ force: true });

    expect(changes).toContainEqual({
      path: '.cursor/skills/openspec-propose/SKILL.md',
      action: 'add',
      tool: 'cursor',
    });
    expect(changes).toContainEqual({
      path: '.cursor/commands/openspec-proposal.md',
      action: 'delete',
      tool: 'openspec',
    });
    expect(changes).toContainEqual({ path: 'CLAUDE.md', action: 'update', tool: 'openspec' });
    expect(changes).toContainEqual({
      path: 'openspec/AGENTS.md',
      action: 'delete',
      tool: 'openspec',
    });
  });

  it('plans a forced cleanup of a configured tool\'s legacy commands without re-adding the tool', async () => {
    const legacyDir = path.join(testDir, '.claude', 'commands', 'openspec');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, 'proposal.md'),
      '<!-- OPENSPEC:START -->\nold command\n<!-- OPENSPEC:END -->\n'
    );
    await fs.writeFile(path.join(legacyDir, 'notes.md'), 'mine\n');

    const changes = await expectPlanMatchesRealUpdate({ force: true });

    expect(changes).toContainEqual({
      path: '.claude/commands/openspec/proposal.md',
      action: 'delete',
      tool: 'openspec',
    });
    expect(changes.map((change) => change.path)).not.toContain('.claude/commands/openspec/notes.md');
  });

  it('plans Codex workflows inferred from legacy prompt names in a forced upgrade', async () => {
    await writeGlobalConfig({ profile: 'core', delivery: 'skills' });
    const promptDir = path.join(process.env.CODEX_HOME!, 'prompts');
    await fs.mkdir(promptDir, { recursive: true });
    await fs.writeFile(path.join(promptDir, 'opsx-archive.md'), 'legacy archive prompt');

    await expectPlanMatchesRealUpdate({ force: true });
  });

  it('plans the global Codex prompts a forced update retires once their skills exist', async () => {
    // The prompts are removed only after the replacement skills are written,
    // which in a dry run exist only in the plan.
    await writeGlobalConfig({ profile: 'core', delivery: 'skills' });
    const promptDir = path.join(process.env.CODEX_HOME!, 'prompts');
    await fs.mkdir(promptDir, { recursive: true });
    await fs.writeFile(path.join(promptDir, 'opsx-explore.md'), 'legacy explore prompt');
    await fs.writeFile(path.join(promptDir, 'personal-notes.md'), 'user');

    const changes = await expectPlanMatchesRealUpdate({ force: true });

    expect(changes).toContainEqual({
      path: 'codex-home/prompts/opsx-explore.md',
      action: 'delete',
      tool: 'openspec',
    });
    expect(changes.map((change) => change.path)).not.toContain('codex-home/prompts/personal-notes.md');
  });

  it('reports a symlinked skills directory as the one link that is removed', async () => {
    // `fs.rm` with `recursive` unlinks a symlinked directory and leaves the tree
    // it points at alone, so the plan must not promise the target's files.
    await writeGlobalConfig({ profile: 'custom', delivery: 'both', workflows: ['propose'] });
    const skills = path.join(testDir, '.claude', 'skills');
    const real = path.join(testDir, 'elsewhere', 'openspec-archive-change');
    await fs.mkdir(real, { recursive: true });
    await fs.writeFile(path.join(real, 'SKILL.md'), 'kept\n');
    await fs.rm(path.join(skills, 'openspec-archive-change'), { recursive: true, force: true });
    // A junction needs no privilege on Windows, and Node reports it as a link.
    await fs.symlink(real, path.join(skills, 'openspec-archive-change'), 'junction');

    const plan = await new UpdateCommand({ dryRun: true }).plan(testDir);

    expect(plan.changes).toContainEqual({
      path: '.claude/skills/openspec-archive-change',
      action: 'delete',
      tool: 'claude',
    });
    expect(plan.changes.map((change) => change.path)).not.toContain(
      'elsewhere/openspec-archive-change/SKILL.md'
    );
  });

  it('never prompts, and says the preview is partial, when legacy artifacts exist', async () => {
    // A pre-opsx Cursor command file (see LEGACY_SLASH_COMMAND_PATHS).
    await fs.mkdir(path.join(testDir, '.cursor', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, '.cursor', 'commands', 'openspec-proposal.md'),
      'legacy command\n'
    );

    const plan = await new UpdateCommand({ dryRun: true }).plan(testDir);

    expect(confirmMock).not.toHaveBeenCalled();
    expect(plan.notes.map((note) => note.code)).toContain('legacy-artifacts');
  });

  it('matches a real non-interactive update that leaves legacy artifacts alone', async () => {
    await fs.mkdir(path.join(testDir, '.cursor', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, '.cursor', 'commands', 'openspec-proposal.md'),
      'legacy command\n'
    );
    await writeGlobalConfig({ profile: 'custom', delivery: 'both', workflows: ['propose'] });

    await expectPlanMatchesRealUpdate();
  });

  it('lists the global config the one-time profile migration writes', async () => {
    // A config written before profiles existed: workflows are installed, but no
    // `profile` is recorded, so a real update saves one.
    await writeGlobalConfig({} as GlobalConfig);

    const changes = await expectPlanMatchesRealUpdate();

    const configPath = path
      .relative(testDir, getGlobalConfigPath())
      .split(path.sep)
      .join('/');
    expect(changes).toContainEqual({ path: configPath, action: 'update', tool: 'openspec' });
  });

  it('plans a consent-gated move as a non-interactive update makes it, and says so', async () => {
    // Windsurf became Devin Desktop. At a terminal the move is offered; without
    // one it is made, which is what the plan lists.
    await new InitCommand({ tools: 'devin', force: true }).execute(testDir);
    await fs.rename(path.join(testDir, '.devin'), path.join(testDir, '.windsurf'));

    const before = await snapshotTree(testDir);
    const plan = await new UpdateCommand({ dryRun: true }).plan(testDir);
    expect(plan.notes.map((note) => note.code)).toContain('legacy-tool-directories');
    await new UpdateCommand().execute(testDir);
    expect(withoutTool(plan.changes)).toEqual(
      diffTrees(before, await snapshotTree(testDir), testDir)
    );
    expect(plan.changes.some((change) => change.path.startsWith('.windsurf/'))).toBe(true);
  });

  it('stops planning a tool where the real write would fail, as the real update stops', async () => {
    // A directory where a SKILL.md belongs: the real write fails with EISDIR
    // and the tool's remaining files are never written. A plan that recorded
    // the write would list them.
    const blocked = path.join(testDir, '.claude', 'skills', 'openspec-explore', 'SKILL.md');
    await fs.rm(blocked);
    await fs.mkdir(blocked);
    await fs.writeFile(path.join(blocked, 'x'), 'x');

    const plan = await expectFullPlanMatchesRealUpdate({ force: true });

    expect(plan.failures).toEqual([
      { tool: 'claude', error: expect.stringContaining('EISDIR') },
    ]);
  });

  it('reports a tool the forced legacy upgrade fails on, and still plans the rest', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    await fs.mkdir(path.join(testDir, '.cursor', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, '.cursor', 'commands', 'openspec-proposal.md'),
      '<!-- OPENSPEC:START -->\nold\n<!-- OPENSPEC:END -->\n'
    );
    // Cursor's skills root is a file, so setting Cursor up fails.
    await fs.mkdir(path.join(testDir, '.cursor'), { recursive: true });
    await fs.writeFile(path.join(testDir, '.cursor', 'skills'), 'not a directory');

    const plan = await expectFullPlanMatchesRealUpdate({ force: true });

    expect(plan.failures.map((failure) => failure.tool)).toEqual(['cursor']);
  });

  it('stops where a real update stops when a legacy upgrade fails in an unconfigured project', async () => {
    // No configured tools, so the real update runs the unconfigured-project
    // branch: it throws for failed legacy migration. Unrelated files stay untouched.
    await fs.rm(path.join(testDir, '.claude'), { recursive: true, force: true });
    await fs.mkdir(path.join(testDir, '.cursor', 'commands'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, '.cursor', 'commands', 'openspec-proposal.md'),
      '<!-- OPENSPEC:START -->\nold\n<!-- OPENSPEC:END -->\n'
    );
    await fs.writeFile(path.join(testDir, '.cursor', 'skills'), 'not a directory');
    const setupSteps = path.join(testDir, 'user-notes.txt');
    await fs.mkdir(path.dirname(setupSteps), { recursive: true });
    await fs.writeFile(setupSteps, 'preserve user notes');

    const plan = await expectFullPlanMatchesRealUpdate({ force: true });

    expect(plan.failures.map((failure) => failure.tool)).toEqual(['cursor']);
    expect(plan.changes.map((change) => change.path)).not.toContain(
      'user-notes.txt'
    );
  });

  it('refuses to plan without dryRun', async () => {
    await expect(new UpdateCommand().plan(testDir)).rejects.toThrow('dryRun: true');
  });
});
