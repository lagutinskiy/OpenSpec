---
name: openspec-archive-change
description: Archive a verified OpenSpec change. Also use when the user says "openspec archive" or "opsx archive".
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---

Archive a completed change using the CLI's shared preflight and spec synchronization.

**Store selection:** If the user names a store (a store is a standalone OpenSpec repo registered on this machine) or the work lives in one, run `openspec store list --json` to discover registered store ids, then pass `--store <id>` on the commands that read or write specs and changes (`new change`, `status`, `instructions`, `list`, `show`, `validate`, `archive`, `review`, `doctor`, `context`, `schemas`, `view`). Once selected, treat `--store <id>` as sticky for the rest of the workflow. Every unscoped example of those commands below is shorthand: before running it, append the flag. For example, run `openspec status --change "<name>" --json --store "<id>"`, not the unscoped form shown below. Other commands do not take the flag. Hints printed by commands already carry the flag; keep it on follow-ups. Without a store, commands act on the nearest local `openspec/` root.

**Project check:** These steps expect a project that already uses OpenSpec. Before the first step that writes anything (`new change`, `archive`, `sync specs`, or authoring an artifact file), confirm the project has a root: run `openspec list --json` (with `--store <id>` when a store is selected, since the store is then the root) and read `root`. A root object means the project is set up. `"root": null` means it is not - there is no `openspec/` directory here, and a write such as `openspec new change` would create one as a side effect. The command also exits non-zero, which is that answer rather than a broken CLI, so read the JSON instead of retrying or working around it.

One `"root": null` is not about setup: when a `status` error message starts with `Declared in` or `Invalid store declaration in` and names this project's `openspec/config.yaml` (or `config.yml`), the project does use OpenSpec through a store it declares, which this machine cannot resolve (the store is not registered, or the `store:` line is malformed). Do not treat it as uninitialized and skip the branches below: stop before writing and show the user that error's `message` and `fix`.

Otherwise, with no root, what happens next depends on how this workflow was reached:

- **Auto-selected**: you chose this workflow yourself, without the user naming OpenSpec, naming this skill, or running its slash command. Stop using OpenSpec and answer the request normally, as you would with no OpenSpec installed. Do not ask them to set anything up and do not mention OpenSpec setup.
- **Explicit OpenSpec request**: the user named OpenSpec, named this skill, or ran its slash command. Stop before writing and ask how to proceed: set this project up (`openspec init`), target a store they already have (`--store <id>`), or continue without OpenSpec for this request. Wait for their answer.

In both branches, never create the root as a side effect: do not run `openspec init` until the user asks for it, do not hand-create `openspec/` files, and do not let a command create it.


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


**Input**: Optionally specify the change name. Use conversation context when unambiguous; otherwise ask.

1. Select the change from conversation context or openspec list --json. Ask when ambiguous.
2. Read openspec status --change "<name>" --json and openspec instructions archive --change "<name>" --json. Preserve the selected --store on every command. Read applicable operation guidance without treating it as completion evidence.
3. Verify all tracked work is complete. Finish the requirements review, recorded verification, and code review loop. Resolve blocking findings and decisions. Do not archive incomplete work merely because a confirmation flag exists.
4. Read <planningHome.root>/openspec/decisions.md. Review entries affecting this change, update resolutions or deferrable follow-up, and run openspec review decisions with the same main harness/root arguments. Then run openspec review status to confirm current evidence.
5. Run openspec archive "<name>" --yes --json with the selected --store. The CLI validates current review evidence BEFORE synchronizing main specs and moving the change. Do not synchronize separately in this workflow: doing so changes the snapshot before preflight. Do not move directories yourself or delegate a background sync.
6. Inspect the JSON outcome and report the archive path and spec updates only on success. If blocked, report the diagnostics and leave the change active. Never bypass preflight or forge evidence.
