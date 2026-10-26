# Design

## Context

- Review policy is `ReviewPolicySchema` (`src/core/review/types.ts`). It is parsed from the implementation project's `openspec/config.yaml` in `resolveReviewRequest` (`src/commands/review.ts`) and in `src/core/project-config.ts`.
- `runReview` (`src/core/review/service.ts`) calls the adapters `reviewWithClaude` and `reviewWithCodex`. The adapters isolate the reviewer from user configuration:
  - Claude: `--bare --setting-sources ''`
  - Codex: `--ignore-user-config`
  
  So today the only way to choose a model or effort is through adapter arguments.
- `maxRounds` is parsed in `runReview` but never enforced.
- Each round writes `reviews/<stage>-<round>.json` plus `reviews/<stage>.json` (latest). `round` increases monotonically across the change's lifetime.
- Codex 0.159 passes `model_reasoning_effort` through without validation; an invalid value only fails later at the provider. Claude Code 2.1.x validates `--effort`.

## Goals / Non-Goals

**Goals:**
- Model/effort settings resolved deterministically: CLI flag > stage+reviewer config > reviewer config > reviewer default.
- Effort validated locally before any reviewer starts.
- The round limit is enforced inside the review service, under the existing per-stage review lock, so it cannot race.

**Non-Goals:**
- Choosing which reviewer to use (the reciprocal pairing is unchanged).
- Validating model names against a catalog.
- Persisting an extra-rounds grant between commands.
- Changing `timeoutMs` per stage.

## Decisions

### Configuration shape

```yaml
review:
  reviewer: codex          # unchanged
  base: main               # unchanged
  timeoutMs: 600000        # unchanged
  maxRounds: 3             # unchanged meaning (now enforced), default 3
  reviewers:
    claude: { model: opus, effort: high }
    codex:  { model: gpt-6.1-sol, effort: high }
  stages:
    requirements:
      maxRounds: 2
      reviewers:
        claude: { effort: medium }
    code:
      reviewers:
        codex: { effort: xhigh }
```

- `ReviewerSettingsSchema` is `{ model?: non-empty string, effort?: string }`, strict.
- `reviewers` is a strict object with optional `claude`/`codex` keys.
- `stages` is a strict object with optional `requirements`/`code` keys, each `{ maxRounds?, reviewers? }`.
- A `superRefine` checks each reviewer's effort against `REVIEWER_EFFORT_LEVELS` in `types.ts`:
  - `claude: ['low','medium','high','xhigh','max']`
  - `codex: ['minimal','low','medium','high','xhigh']`
- **Why nest by stage and then reviewer instead of a flat per-reviewer map:** the stage is the dimension users tune most (cheap requirements review, deep code review), and the reviewer key keeps settings meaningful when other harnesses pick a configured reviewer.
- **Alternative rejected:** a single `model`/`effort` pair. Codex and Claude model names and effort scales differ, and a harness may be reviewed by either reviewer.

### Resolution and adapter arguments

- `resolveReviewRequest` resolves the effective `{ model?, effort? }` after selecting the reviewer, by field-wise merging in the precedence order above.
- `--effort` from the CLI goes through the same validation against the selected reviewer.
- `ReviewRequest` gains `model?`, `effort?` and `extraRounds?`. It is already persisted inside the report as `request`, so the settings are recorded without a new top-level field.
- `ReviewResultSchema.request` adds these as optional fields. Old reports still parse, and `version` stays 1.
- Adapter arguments when set:
  - Claude: `--model <m>`, `--effort <e>`
  - Codex: `-m <m>`, `-c model_reasoning_effort="<e>"`
  
  Values are passed as separate argv entries; nothing goes through a shell. The Codex `-c` value is TOML, so the effort is emitted as a quoted string; it comes from a fixed list, so no escaping issues arise.
- Adapters take an optional trailing `settings: { model?, effort? }` argument (default `{}`), so existing call sites and tests stay unchanged.
- `selectReviewer` is unchanged.

### Round counting

- `countFailedRounds(changeRoot, stage)` reads `reviews/<stage>-<n>.json` from the latest round downwards until it finds `passed` or runs out.
  - It counts `changes_required` and skips `blocked`.
  - Files that are missing or invalid are skipped. They cannot pass, so they would not reset the count, and treating them as `changes_required` would unfairly block.
- It runs inside `runReview` after `acquireReviewLock`, so two concurrent invocations cannot both slip under the limit.
- `limit = stages[stage].maxRounds ?? maxRounds`. If `count >= limit + (extraRounds ?? 0)`, return a `limit_reached` result. That result is not schema-parsed as a `ReviewResult`, is not written, and the command exits 1.
- **Alternative rejected:** storing a running counter in the latest report. The per-round history already exists, and deriving the count from it avoids a second source of truth.

### `limit_reached` output

```json
{ "outcome": "limit_reached", "stage": "code", "count": 3, "limit": 3, "extraRounds": 0,
  "openFindings": [...], "findingsRound": 6, "latestRound": 7, "latestBlockedSummary": "codex timed out",
  "next": "Ask the user; rerun with --extra-rounds <n> only with their approval." }
```

- `openFindings` are the non-`fixed` findings from the newest `changes_required` report found while counting (`findingsRound`).
- `latestBlockedSummary` is present only when the newest report is `blocked`.
- `readCurrentReview` and readiness are unaffected, because nothing is written.

### Settings vs. snapshot freshness

- `readCurrentReview` keeps comparing only the reviewer, the roots and the snapshot hash; it does not compare `model`/`effort`.
- `openspec/config.yaml` stays in the code snapshot, so editing it stales code evidence as today.
- **Alternative rejected:** hashing config.yaml with the review settings stripped. It special-cases one file, and changing reviewer strength mid-change is rare enough that a fresh review is acceptable.

### CLI flags

`--model <name>`, `--effort <level>`, `--extra-rounds <n>` on `openspec review`. They apply only to the `requirements` and `code` stages; other stages reject them with an error. Shell completions are registered in `src/core/completions/command-registry.ts`.

### Skill guidance

`REVIEW_GUIDANCE` (`src/core/templates/workflows/review-change.ts`) replaces the "per invocation" wording with:
- the enforced limit
- what to do on `limit_reached`
- the rule that `--extra-rounds`, `--model` and `--effort` are used only on explicit user request

Then run `npm run build` and `npm run regen:parity-hashes`.

## Risks / Trade-offs

- **The Codex effort list may drift from what Codex supports.** Mitigation: one constant, easy to update; a provider rejection still results in `blocked`.
- **Agents could pass `--extra-rounds` themselves.** Mitigation: skill guidance plus the allowance recorded in evidence, so it is auditable. The CLI cannot distinguish human from agent callers.
- **Platform:** no new file paths. Round files are discovered via `path.join` with numeric names, so behavior is the same on macOS, Linux and Windows.
