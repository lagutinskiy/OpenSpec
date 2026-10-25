---
name: openspec-new-change
description: Start a new OpenSpec change using the experimental artifact workflow. Use when the user wants to create a new feature, fix, or modification with a structured step-by-step approach. Also use when the user says "openspec new change" or "opsx new".
allowed-tools: Bash(openspec:*)
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---

Start a new change using the experimental artifact-driven approach.

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


When all applicable planning artifacts are ready, run the requirements review before presenting the change as ready to implement. Choose small-change for bounded work without design complexity; behavioral changes still require specs. Write outcomes and business rules in proposals/specs; put implementation mechanics in design/tasks unless the interface is the requested subject.

**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build.

**Steps**

1. **If no clear input provided, ask what they want to build**

   Ask the user (open-ended, no preset options):
   > "What change do you want to work on? Describe what you want to build or fix."

   From their description, derive a kebab-case name (e.g., "add user authentication" → `add-user-auth`).

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

2. **Determine the workflow schema**

   Use the default schema (omit `--schema`) unless the user explicitly requests a different workflow.

   **Use a different schema only if the user mentions:**
   - A specific schema name → use `--schema <name>`
   - "show workflows" or "what workflows" → run `openspec schemas --json` and let them choose

   **Otherwise**: Omit `--schema` to use the default.

3. **Create the change directory**
   ```bash
   openspec new change "<name>"
   ```
   Add `--schema <name>` only if the user requested a specific workflow.
   This creates a scaffolded change in the planning home resolved by the CLI.

4. **Show the artifact status**
   ```bash
   openspec status --change "<name>" --json
   ```
   Use the returned `planningHome`, `changeRoot`, `artifactPaths`, and `nextSteps` instead of assuming repo-local paths.

5. **Get instructions for the first artifact**
   The first artifact depends on the schema (e.g., `proposal` for spec-driven).
   Check the status output to find the first artifact with status "ready".
   ```bash
   openspec instructions <first-artifact-id> --change "<name>"
   ```
   This outputs the template and context for creating the first artifact.

6. **STOP and wait for user direction**

**Output**

After completing the steps, summarize:
- Change name and location
- Schema/workflow being used and its artifact sequence
- Current status (0/N artifacts complete)
- The template for the first artifact
- Prompt: "Ready to create the first artifact? Just describe what this change is about and I'll draft it, or ask me to continue."

**Guardrails**
- Do NOT create any artifacts yet - just show the instructions
- Do NOT advance beyond showing the first artifact template
- If the name is invalid (not kebab-case), ask for a valid name
- If a change with that name already exists, suggest continuing that change instead
- Pass --schema if using a non-default workflow
