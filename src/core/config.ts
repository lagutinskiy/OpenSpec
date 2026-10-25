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
  globalSkillsDir?: string; // e.g., '.minimax' - /skills suffix, resolved from the user's home directory
  detectionPaths?: string[]; // Override skillsDir for auto-detection; any path existing triggers detection
  searchAliases?: string[]; // Extra single-word terms the init tool picker matches; never displayed
  setupNote?: string; // Manual setup required before the tool picks up generated files; shown after init/update
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
 * The vendor-neutral target every assistant that is not listed above can use.
 * Named wherever a tool lookup comes up empty, so "my tool isn't here" is never
 * a dead end (#653).
 */
export const UNIVERSAL_TOOL_ID = 'agents';

/** The universal target's entry, or undefined if it was removed from AI_TOOLS. */
export function getUniversalTool(): AIToolOption | undefined {
  return AI_TOOLS.find((tool) => tool.value === UNIVERSAL_TOOL_ID);
}

/**
 * One-line pointer at the universal target for non-interactive errors, the
 * scripted counterpart of the picker's empty-search hint. Undefined when the
 * target is not among the tools on offer, so the hint never names a choice the
 * caller cannot make.
 */
export function universalToolFallbackHint(offeredToolIds: string[]): string | undefined {
  const universal = getUniversalTool();
  if (!universal || !offeredToolIds.includes(universal.value)) return undefined;
  return `Tool not listed? Use --tools ${universal.value}: the vendor-neutral target that writes ${universal.skillsDir}/skills/ for any assistant.`;
}

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
