import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { AI_TOOLS } from '../../../src/core/config.js';
import {
  getSkillCapableTools,
  resolveToolSkillsDir,
  toolSupportsSkills,
} from '../../../src/core/shared/skill-paths.js';

describe('skill-paths', () => {

  it('resolves project-local skills under the project root', () => {
    const claude = AI_TOOLS.find((tool) => tool.value === 'claude');
    expect(claude && toolSupportsSkills(claude)).toBe(true);
    if (!claude || !toolSupportsSkills(claude)) return;

    expect(resolveToolSkillsDir('/repo/app', claude)).toBe(
      path.join('/repo/app', '.claude', 'skills')
    );
  });

  it('resolves DeepSeek Harness skills under the project .dsh root', () => {
    const dsh = AI_TOOLS.find((tool) => tool.value === 'dsh');
    expect(dsh && toolSupportsSkills(dsh)).toBe(true);
    if (!dsh || !toolSupportsSkills(dsh)) return;

    expect(resolveToolSkillsDir('/repo/app', dsh)).toBe(
      path.join('/repo/app', '.dsh', 'skills')
    );
  });
});
