# Tasks

## 1. Configuration and request model

- [x] 1.1 Add `REVIEWER_EFFORT_LEVELS`, `ReviewerSettingsSchema`, `reviewers` and `stages` (with stage `maxRounds`) to `ReviewPolicySchema`, validating effort for each reviewer
- [x] 1.2 Add optional `model`, `effort`, `extraRounds` to `ReviewRequest` and `ReviewResultSchema.request`; confirm existing reports still parse
- [x] 1.3 Resolve effective model/effort (flag > stage+reviewer > reviewer > default) and the stage round limit in `resolveReviewRequest`; validate the `--effort` flag against the selected reviewer

## 2. Reviewer adapters

- [x] 2.1 Pass `--model`/`--effort` to Claude Code and `-m`/`-c model_reasoning_effort="…"` to Codex only when set
- [x] 2.2 Ensure a reviewer rejecting the model produces a `blocked` report that includes the error

## 3. Round limit

- [x] 3.1 Count consecutive `changes_required` reports since the last `passed` for each stage (skip `blocked` and unreadable reports)
- [x] 3.2 Enforce limit + extra rounds inside the review lock; return `limit_reached` with open findings from the newest `changes_required` report (plus the latest blocked summary when applicable), write no evidence, exit 1

## 4. CLI

- [x] 4.1 Add `--model`, `--effort`, `--extra-rounds` to `openspec review`; reject them for non-review stages; validate `--extra-rounds` as an integer from 1 to 20
- [x] 4.2 Register the new flags in shell completions

## 5. Skills and docs

- [x] 5.1 Update `REVIEW_GUIDANCE` for the enforced limit, `limit_reached` handling, and user-approved overrides; run `npm run build` and `npm run regen:parity-hashes`
- [x] 5.2 Update `docs/workflow.md` review configuration and resolve-findings sections

## 6. Tests

- [x] 6.1 Policy parsing: valid/invalid effort per reviewer, stage overrides, stage `maxRounds` bounds, legacy config unchanged
- [x] 6.2 Resolution precedence and partial overrides
- [x] 6.3 Adapter argument construction with and without settings
- [x] 6.4 Round counting (blocked skipped, pass resets, stages independent), `limit_reached` writes nothing, extra rounds allow and expire
- [x] 6.5 Old report without new fields remains current for readiness; a report made with different model/effort remains current for unchanged content; editing `openspec/config.yaml` stales code evidence
- [x] 6.7 `limit_reached` when the latest report is blocked returns findings from the newest `changes_required` report and the blocked summary
- [x] 6.6 Run `npm run check`; use `path.join` for expected paths so tests pass on Windows
