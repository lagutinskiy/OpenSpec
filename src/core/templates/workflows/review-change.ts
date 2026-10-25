import type { SkillTemplate, CommandTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';
import { PROJECT_ROOT_GUARD } from './project-root.js';

export const REVIEW_GUIDANCE = `
**Independent review lifecycle**

Identify the actual implementing harness; pass its supported tool ID as --main-harness.
Claude Code uses Codex as reviewer; Codex uses Claude Code. Other supported
harnesses require review.reviewer configured as codex or claude. Never substitute
self-review when a reviewer is unavailable. Keep the selected --store and explicit
--implementation-root (when needed) on every review command. Use --base with an
explicit agreed Git revision, or review.base configuration, for code/verification.
Do not guess a base branch.

Before implementation, finish applicable planning artifacts, preserve unresolved
decisions in <planningHome.root>/openspec/decisions.md, and run:
  openspec review requirements --change "<name>" --main-harness <id> --json
Then run openspec review ready-to-implement with the same selection arguments.
Do not implement until that command reports ready. Resolve questions affecting
requirements/approach first; deferrable questions need an owner and next action.

After implementation, execute appropriate checks through:
  openspec review verify --change "<name>" --main-harness <id> --base <revision> --check '["executable","argument"]' --json
Repeat --check for each applicable check. These commands execute real checks and
record output. Explain applicable checks that could not run; do not claim them as
passed. Verification evidence is separate from code review and task checkboxes.
Then run:
  openspec review code --change "<name>" --main-harness <id> --base <revision> --json

Evaluate findings against the requirements. Fix accepted findings, rerun relevant
checks, then request a fresh review. Record each finding ID and disposition with
reason/evidence in <changeRoot>/reviews/<stage>-dispositions.md; rejected findings need a
reason and reviewer reconsideration, not a silent dismissal. Do not weaken
requirements to satisfy a finding. A reviewer must accept dispositions before a
passed report. Critical/high unresolved findings block completion; lower findings
need a recorded disposition. Limit this fix/verify/review loop to review.maxRounds
(default 3) per invocation; when exhausted, report remaining findings and pause.
Resume later from saved reports; never restart by discarding findings.

Treat tasks-complete, requirements-reviewed, verified, code-reviewed and
archive-ready as distinct states. Missing CLI/authentication, timeout, invalid
output or stale evidence blocks review. Reports live under <changeRoot>/reviews/;
current content must match the reviewed snapshot. Do not hand-write passing
reports. Reviewer processes inspect only and must not launch other agents.

Before archive, read and update the project decisions register: resolve affected
entries or retain deferrable entries with owner and next action. Reflect settled
behavior in proposal/spec/design. If relevant decision content changes, refresh
requirements/code reviews and verification before archive. Then run openspec review decisions with the
same selection arguments to acknowledge the current register, and openspec review
status --base <revision> to confirm readiness. Use openspec archive for the actual
archive; do not move the change directory manually. Existing archive bypass flags
do not bypass independent review, verification, or decisions acknowledgement.
`;
export function getReviewChangeSkillTemplate(): SkillTemplate {
  return { name: 'openspec-review-change', description: 'Review OpenSpec requirements and code. Also use when the user says "openspec review" or "opsx review".',
    instructions: `**Input**: Optionally specify review stage and change name. Infer from the current change when unambiguous; otherwise ask.

${STORE_SELECTION_GUIDANCE}\n\n${PROJECT_ROOT_GUARD}\n${REVIEW_GUIDANCE}`,
    license: 'MIT', compatibility: 'Requires openspec CLI and an authenticated Codex or Claude Code CLI.', metadata: { author: 'openspec', version: '1.0' } };
}
export function getOpsxReviewCommandTemplate(): CommandTemplate {
  return { name: 'OPSX: Review', description: 'Independent requirements and code review', category: 'Workflow', tags: ['workflow', 'review'], content: getReviewChangeSkillTemplate().instructions };
}
