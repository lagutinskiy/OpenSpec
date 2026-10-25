import path from 'node:path';

import { AI_TOOLS, type AIToolOption } from '../config.js';

export type SkillCapableTool = AIToolOption & { skillsDir: string };

export function toolSupportsSkills(tool: AIToolOption): tool is SkillCapableTool {
  return Boolean(tool.skillsDir);
}

export function getSkillCapableTools(): SkillCapableTool[] {
  return AI_TOOLS.filter(toolSupportsSkills);
}

export function resolveToolSkillsDir(
  projectRoot: string,
  tool: SkillCapableTool
): string {
  return path.join(projectRoot, tool.skillsDir, 'skills');
}
