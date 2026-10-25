import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveSharedSkillWriters,
  sharedSkillRootOwnedByOther,
  sharedSkillRootOwner,
} from '../../src/core/shared-skill-target.js';
import { AI_TOOLS } from '../../src/core/config.js';

/**
 * `.agents` is shared by the vendor-neutral `agents` target and Codex. When a
 * legacy Codex install is detected only from global `~/.codex/prompts`, the
 * update path must not rewrite an existing `agents`-owned `.agents` tree. This
 * guards the predicate that decides that.
 */
describe('sharedSkillRootOwnedByOther', () => {
  let projectPath: string;

  const writeAgentsSkill = async (marker?: string) => {
    const skillsRoot = path.join(projectPath, '.agents', 'skills');
    const skillDir = path.join(skillsRoot, 'openspec-propose');
    await fs.mkdir(skillDir, { recursive: true });
    // Generic invocation syntax => inferred owner is `agents` (not `$openspec-`).
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '# openspec-propose\n\nRun /openspec-propose to start.\n'
    );
    if (marker !== undefined) {
      await fs.writeFile(path.join(skillsRoot, '.openspec-target'), `${marker}\n`);
    }
  };

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-shared-target-'));
  });

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true });
  });

  it('does NOT block Codex when the marker names Codex', async () => {
    await writeAgentsSkill('codex');
    expect(sharedSkillRootOwnedByOther(projectPath, 'codex')).toBe(false);
  });
});
