import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { PROJECT_ROOT_GUARD } from './project-root.js';
import { REVIEW_GUIDANCE } from './review-change.js';

export function getBulkArchiveChangeSkillTemplate(): SkillTemplate {
  return {
    name: 'openspec-bulk-archive-change', description: 'Archive several reviewed OpenSpec changes. Also use when the user says "openspec bulk-archive", "opsx bulk-archive", "openspec archive all", or "openspec archive these changes".',
    instructions: `Archive selected changes sequentially through the enforcing CLI.

${STORE_SELECTION_GUIDANCE}

${PROJECT_ROOT_GUARD}

${REVIEW_GUIDANCE}

**Input**: Optionally specify the change names. Use conversation context when unambiguous; otherwise ask.

1. Run openspec list --json and select the requested changes. Ask when selection is ambiguous.
2. Read each change's status and planning artifacts. Identify overlapping requirements and dependencies; agree the order before changing main specs when conflicts need a user decision.
3. For EACH change, review/update affected project decisions and acknowledge the current register. Check openspec review status with the correct main harness, base, planning store and implementation root.
4. Archive ready changes one at a time with openspec archive "<name>" --yes --json and selected --store. Do not pre-sync specs, move directories manually, bypass checks, or launch background archival.
5. Earlier archives may change the content reviewed for a later change. Refresh review/verification evidence if it becomes stale; never reuse a pre-batch readiness result after content changes.
6. Stop on failure, preserve remaining active changes, and report succeeded, blocked and unattempted changes separately. Never claim the batch succeeded from task checkboxes alone.`, license: 'MIT', compatibility: 'Requires openspec CLI.', metadata: { author: 'openspec', version: '1.0' },
  };
}
export function getOpsxBulkArchiveCommandTemplate(): CommandTemplate {
  return { name: 'OPSX: Bulk Archive', description: 'Archive reviewed changes sequentially', category: 'Workflow', tags: ['workflow', 'archive'], content: getBulkArchiveChangeSkillTemplate().instructions };
}
