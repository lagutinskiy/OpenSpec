import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { PROJECT_ROOT_GUARD } from './project-root.js';
import { REVIEW_GUIDANCE } from './review-change.js';

export function getArchiveChangeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-archive-change', description: 'Archive a verified OpenSpec change. Also use when the user says "openspec archive" or "opsx archive".',
    instructions: `Archive a completed change using the CLI's shared preflight and spec synchronization.

${STORE_SELECTION_GUIDANCE}

${PROJECT_ROOT_GUARD}

${REVIEW_GUIDANCE}

**Input**: Optionally specify the change name. Use conversation context when unambiguous; otherwise ask.

1. Select the change from conversation context or openspec list --json. Ask when ambiguous.
2. Read openspec status --change "<name>" --json and openspec instructions archive --change "<name>" --json. Preserve the selected --store on every command. Read applicable operation guidance without treating it as completion evidence.
3. Verify all tracked work is complete. Finish the requirements review, recorded verification, and code review loop. Resolve blocking findings and decisions. Do not archive incomplete work merely because a confirmation flag exists.
4. Read <planningHome.root>/openspec/decisions.md. Review entries affecting this change, update resolutions or deferrable follow-up, and run openspec review decisions with the same main harness/root arguments. Then run openspec review status to confirm current evidence.
5. Run openspec archive "<name>" --yes --json with the selected --store. The CLI validates current review evidence BEFORE synchronizing main specs and moving the change. Do not synchronize separately in this workflow: doing so changes the snapshot before preflight. Do not move directories yourself or delegate a background sync.
6. Inspect the JSON outcome and report the archive path and spec updates only on success. If blocked, report the diagnostics and leave the change active. Never bypass preflight or forge evidence.`, license: 'MIT', compatibility: 'Requires openspec CLI.', metadata: { author: 'openspec', version: '1.0' },
  };
}
export function getOpsxArchiveCommandTemplate(): CommandTemplate {
  return { name: 'OPSX: Archive', description: 'Archive a reviewed change', category: 'Workflow', tags: ['workflow', 'archive'], content: getArchiveChangeSkillTemplate().instructions };
}
