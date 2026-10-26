# Proposal

## Why

Independent reviews deliberately ignore the reviewer CLI's personal settings, so every review runs on that CLI's built-in default model and reasoning effort. Teams cannot choose a stronger model for code review or a cheaper one for requirements review. The documented `review.maxRounds` limit is only advice to the implementing agent: nothing stops an agent from requesting review after review, which wastes reviewer time and budget and hides stalled disagreements from the user.

## What Changes

- Projects can choose the reviewer model and reasoning effort for each reviewer (Codex, Claude Code), with optional overrides for each review stage (requirements, code).
- A single review run can override the configured model and effort from the command line.
- Unsupported effort values are rejected before any reviewer starts. An unknown model makes the review blocked, never passed.
- Each review report records the model and effort that produced it.
- The CLI enforces the round limit: consecutive `changes_required` reviews for a stage stop at the configured limit. The CLI then reports `limit_reached` with the open findings, without starting the reviewer.
- The round limit can be set for each stage. A user can explicitly allow additional rounds from the command line, and the report records that allowance.
- Workflow skills tell agents to stop and report when the limit is reached, and to use extra rounds or model/effort overrides only when the user asks.
- Projects that configure none of this keep today's reviewer defaults and the existing default limit of 3 rounds. The only difference is that the limit is now enforced.

## Capabilities

### New Capabilities
- `review-reviewer-settings`: choosing the reviewer model and reasoning effort for independent reviews, and recording what was used.
- `review-round-limit`: bounding how many consecutive unsuccessful review rounds a stage may run before the user decides how to continue.

### Modified Capabilities

## Impact

- Users of the private CLI and the installed workflow skills (all supported harnesses). After this ships, users should run `openspec update` so skills carry the new guidance.
- `openspec/config.yaml` `review` section gains optional fields. Existing configurations stay valid.
- **BREAKING (behavioral):** an agent that kept reviewing past `maxRounds` is now stopped by the CLI with `limit_reached` and a non-zero exit. The user has to approve extra rounds explicitly.
- Existing review reports remain readable and valid.
