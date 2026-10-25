# Review a change

Review requirements before implementing. Verify and independently review code before archiving.

## Choose the reviewer

| Implementing harness | Reviewer |
| --- | --- |
| Codex | Claude Code |
| Claude Code | Codex |
| Other supported harness | Project-configured Codex or Claude Code |

Install and authenticate the reviewer CLI separately. OpenSpec does not install
it, log in, or bypass its permissions. Each review starts a fresh session.
The reviewer inspects files; the implementing agent fixes findings.

## Review data

A requested review supplies planning artifacts, the code diff and file manifest,
relevant decisions, finding dispositions, and verification output to the selected
Codex or Claude Code CLI and its configured model provider. Reports are saved
locally under `<changeRoot>/reviews/`.

This fork contains no usage analytics, anonymous-ID collection, background version
checks, self-updaters, or GitHub Copilot integration.

## Review requirements

Finish the applicable planning artifacts, then ask your agent to review the
requirements. The agent runs:

```sh
openspec review requirements --change export-data --main-harness codex --json
openspec review ready-to-implement --change export-data --main-harness codex --json
```

Check the intended outcome, scope, business rules, acceptance scenarios, failure
cases, and unresolved decisions. Questions that affect requirements or approach
must be resolved before implementation.

## Verify and review code

Choose the Git revision the change starts from. Pass it explicitly with
`--base`, or set `review.base` in `openspec/config.yaml`.

```sh
openspec review verify --change export-data --main-harness codex --base main --check '["npm","test"]' --json
openspec review code --change export-data --main-harness codex --base main --json
```

Repeat `--check` for each applicable check. Checks run as argument arrays without
a shell. Use the installed executable appropriate to your environment.

Reports live in `<changeRoot>/reviews/`. They identify the reviewed content,
reviewer, findings, and outcome. Uncommitted and untracked code is included.
Content changes invalidate previous evidence. Task completion is a separate state.

## Resolve findings

1. Evaluate each finding against the requirements.
2. Fix accepted findings. Record a reason for rejected findings in `reviews/<stage>-dispositions.md` (`requirements` or `code`).
3. Rerun affected checks.
4. Request another independent review.

Critical/high unresolved findings block completion. Lower findings need a recorded
disposition. The reviewer must accept a rejected finding's reasoning before it
can pass. The skill stops after `review.maxRounds` rounds per invocation
(default 3); resume from the saved evidence in a later invocation.

**Blocked review:** missing authentication or CLI, timeout, invalid output,
concurrent edits, or unresolved findings do not count as passed.

## Preserve decisions

`openspec/decisions.md` belongs to the planning root and survives change archival.
Use its table with stable IDs such as `D-001`. Record context, status, owner,
affected changes, whether the question blocks implementation, next action, and
resolution. Open entries require an owner and next action. Resolved entries
require a resolution. Put settled behavior in the relevant proposal/spec/design too.

Before archive, review and update the affected entries. Changes to relevant decision content invalidate review evidence; refresh it before archiving. Deferrable questions may
remain open. Acknowledge the current register and check readiness:

```sh
openspec review decisions --change export-data --main-harness codex --json
openspec review status --change export-data --main-harness codex --base main --json
openspec archive export-data --yes --json
```

Archive requires current requirements review, code review, verification, and
decision acknowledgement. `--yes`, `--skip-specs`, and `--no-validate` do not
bypass these checks. Archive performs its own spec synchronization; the archive
skill does not move directories manually.

## Planning stores

Keep `--store <id>` on every command when using a store. Review processes run in
the declaring implementation project. If no project can be resolved, select
`--implementation-root <path>` explicitly. The decision register stays in the store.

## Small changes

Use `openspec new change <name> --schema small-change` for bounded work that does
not need architectural design. It uses a brief proposal, behavioral specs, and
tasks. Nonbehavioral work may explicitly declare `skip_specs: true`; behavioral
changes still require specs. Both review stages and verification remain required.
Use `spec-driven` for security-sensitive, migration-heavy, cross-cutting, or
uncertain work.

## Review configuration

```yaml
schema: spec-driven
review:
  reviewer: codex # Required for main harnesses other than Codex/Claude
  base: main
  timeoutMs: 600000
  maxRounds: 3
```

`timeoutMs` is a positive integer up to 3600000. `maxRounds` is a positive integer
up to 20. Configuration lives in the implementation project's `openspec/config.yaml`.
CLI `--base` and `--reviewer` override the corresponding configuration fields.
The reciprocal Codex/Claude pairing always applies.
