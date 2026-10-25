import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { getAvailableTools } from '../../src/core/available-tools.js';

describe('available-tools', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-test-'));
    vi.stubEnv('HOME', path.join(testDir, 'home'));
    vi.stubEnv('USERPROFILE', path.join(testDir, 'home'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('getAvailableTools', () => {
    it('should return empty array when no tool directories exist', () => {
      const tools = getAvailableTools(testDir);
      expect(tools).toEqual([]);
    });

    it('should detect Grok Build from a project .grok directory', async () => {
      await fs.mkdir(path.join(testDir, '.grok'));

      expect(getAvailableTools(testDir)).toEqual([
        expect.objectContaining({
          name: 'Grok Build',
          value: 'grok',
          skillsDir: '.grok',
          available: true,
        }),
      ]);
    });

    it('should not detect Grok Build from a .grok file', async () => {
      await fs.writeFile(path.join(testDir, '.grok'), 'not a directory');

      expect(getAvailableTools(testDir)).toEqual([]);
    });

    it('should detect multiple tool directories', async () => {
      await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });
      await fs.mkdir(path.join(testDir, '.cursor'), { recursive: true });
      await fs.mkdir(path.join(testDir, '.windsurf'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('claude');
      expect(toolValues).toContain('cursor');
      // Windsurf was rebranded to Devin Desktop, so .windsurf detects as devin
      expect(toolValues).toContain('devin');
      expect(tools).toHaveLength(3);
    });

    it('should detect Devin Desktop when .devin directory exists', async () => {
      await fs.mkdir(path.join(testDir, '.devin'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('devin');

      const devinTool = tools.find((t) => t.value === 'devin');
      expect(devinTool).toBeDefined();
      expect(devinTool?.name).toBe('Devin Desktop (formerly Windsurf)');
      expect(devinTool?.skillsDir).toBe('.devin');
    });

    it('should detect Devin Desktop from the legacy .windsurf directory', async () => {
      // The rebrand moved the config dir; a project set up before it still has
      // only .windsurf/, and that user must still be recognized.
      await fs.mkdir(path.join(testDir, '.windsurf'), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools.map((t) => t.value)).toContain('devin');
      expect(tools.find((t) => t.value === 'devin')?.skillsDir).toBe('.devin');
    });

    it('should not detect Devin Desktop when neither .devin nor .windsurf exists', async () => {
      await fs.mkdir(path.join(testDir, '.cursor'), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools.map((t) => t.value)).not.toContain('devin');
    });

    it('should ignore files that are not directories', async () => {
      // Create a file named .claude instead of a directory
      await fs.writeFile(path.join(testDir, '.claude'), 'not a directory');

      const tools = getAvailableTools(testDir);
      expect(tools).toEqual([]);
    });

    it('should return tools that support project-local or global skills', async () => {
      await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools.map((t) => t.value)).toContain('claude');
      expect(tools.every((tool) => tool.skillsDir || tool.globalSkillsDir)).toBe(true);
    });

    it('should detect valid legacy Codex skills beside an escaped managed link', async () => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-legacy-outside-'));
      try {
        const legacySkills = path.join(testDir, '.codex', 'skills');
        await fs.mkdir(path.join(legacySkills, 'openspec-propose'), { recursive: true });
        await fs.writeFile(
          path.join(legacySkills, 'openspec-propose', 'SKILL.md'),
          'Next: $openspec-apply-change'
        );
        await fs.mkdir(outsideDir, { recursive: true });
        await fs.symlink(
          outsideDir,
          path.join(legacySkills, 'openspec-explore'),
          process.platform === 'win32' ? 'junction' : 'dir'
        );

        const tools = getAvailableTools(testDir);
        expect(tools.map((tool) => tool.value)).toEqual(['codex']);
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('should return full AIToolOption objects', async () => {
      await fs.mkdir(path.join(testDir, '.cursor'), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'Cursor',
        value: 'cursor',
        available: true,
        skillsDir: '.cursor',
      });
    });

    it('should handle paths with spaces', async () => {
      const spacedDir = path.join(testDir, 'path with spaces');
      await fs.mkdir(spacedDir, { recursive: true });
      await fs.mkdir(path.join(spacedDir, '.claude'), { recursive: true });

      const tools = getAvailableTools(spacedDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].value).toBe('claude');
    });

    it('should still use skillsDir detection for tools without detectionPaths', async () => {
      // Claude Code has no detectionPaths, so .claude/ directory should still work
      await fs.mkdir(path.join(testDir, '.claude'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const toolValues = tools.map((t) => t.value);
      expect(toolValues).toContain('claude');
    });

    it('should detect DeepSeek Harness when .dsh/skills exists', async () => {
      // dsh discovers skills from <project>/.dsh/skills, its rank-100 project root.
      await fs.mkdir(path.join(testDir, '.dsh', 'skills'), { recursive: true });

      const tools = getAvailableTools(testDir);
      const dsh = tools.find((t) => t.value === 'dsh');
      expect(dsh).toMatchObject({
        name: 'DeepSeek Harness',
        skillsDir: '.dsh',
      });
    });

    it('should detect DeepSeek Harness from a bare .dsh project directory', async () => {
      // .dsh is DeepSeek Harness's project config root, so its presence is a
      // meaningful signal even before any skill directory exists.
      await fs.mkdir(path.join(testDir, '.dsh'), { recursive: true });

      const tools = getAvailableTools(testDir);
      expect(tools.map((t) => t.value)).toContain('dsh');
    });

    it('should not detect DeepSeek Harness when no .dsh signal exists', () => {
      const tools = getAvailableTools(testDir);
      expect(tools.map((t) => t.value)).not.toContain('dsh');
    });

    it('should not detect DeepSeek Harness when .dsh is a regular file', async () => {
      await fs.writeFile(path.join(testDir, '.dsh'), 'not a tool directory');

      expect(getAvailableTools(testDir).map((tool) => tool.value)).not.toContain('dsh');
    });


  });
});
