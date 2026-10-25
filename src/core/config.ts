export const OPENSPEC_DIR_NAME = 'openspec';

export const OPENSPEC_SKILL_NAMES = [
  'openspec-explore',
  'openspec-new-change',
  'openspec-continue-change',
  'openspec-apply-change',
  'openspec-update-change',
  'openspec-ff-change',
  'openspec-sync-specs',
  'openspec-archive-change',
  'openspec-bulk-archive-change',
  'openspec-verify-change',
  'openspec-review-change',
  'openspec-onboard',
  'openspec-propose',
] as const;

export const OPENSPEC_MARKERS = {
  start: '<!-- OPENSPEC:START -->',
  end: '<!-- OPENSPEC:END -->'
};

export interface OpenSpecConfig {
  aiTools: string[];
}

export interface AIToolOption {
  name: string;
  value: string;
  available: boolean;
  successLabel?: string;
  skillsDir?: string; // e.g., '.claude' - /skills suffix per Agent Skills spec
  legacySkillsDirs?: string[]; // Former roots read for detection and migrated after replacement
  detectionPaths?: string[]; // Override skillsDir for auto-detection; any path existing triggers detection
  requiresIdeRestart?: boolean; // True when slash commands are loaded by an IDE/editor process (a CLI picks them up immediately, so no restart hint — see #1067)
}

export const AI_TOOLS: AIToolOption[] = [
  { name: 'Claude Code', value: 'claude', available: true, successLabel: 'Claude Code', skillsDir: '.claude' },
  { name: 'Codex', value: 'codex', available: true, successLabel: 'Codex', skillsDir: '.agents', legacySkillsDirs: ['.codex'], detectionPaths: ['.agents/skills', '.codex/skills'] },
  { name: 'DeepSeek Harness', value: 'dsh', available: true, successLabel: 'DeepSeek Harness', skillsDir: '.dsh' },
  { name: 'Devin Desktop (formerly Windsurf)', value: 'devin', available: true, successLabel: 'Devin Desktop', skillsDir: '.devin', detectionPaths: ['.devin', '.windsurf'], requiresIdeRestart: true },
  { name: 'Cursor', value: 'cursor', available: true, successLabel: 'Cursor', skillsDir: '.cursor', requiresIdeRestart: true },
  { name: 'Grok Build', value: 'grok', available: true, successLabel: 'Grok Build', skillsDir: '.grok' },
  { name: 'OpenCode', value: 'opencode', available: true, successLabel: 'OpenCode', skillsDir: '.opencode' },
  { name: 'Pi', value: 'pi', available: true, successLabel: 'Pi', skillsDir: '.pi' },
  { name: 'Warp', value: 'warp', available: true, successLabel: 'Warp', skillsDir: '.warp', detectionPaths: ['.warp', 'WARP.md'] },
];

/**
 * Retired tool ids that still resolve, so a rebrand does not break scripted
 * `--tools` invocations. Windsurf was rebranded to Devin Desktop on
 * 2026-06-02 and its config directory moved from `.windsurf/` to `.devin/`;
 * `--tools windsurf` therefore configures `devin`.
 */
export const TOOL_ID_ALIASES: Record<string, string> = {
  windsurf: 'devin',
};

/**
 * Resolves a tool id through TOOL_ID_ALIASES, leaving current ids untouched.
 */
export function resolveToolIdAlias(toolId: string): string {
  return TOOL_ID_ALIASES[toolId] ?? toolId;
}
