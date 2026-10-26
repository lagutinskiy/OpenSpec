# review-round-limit Specification

## Purpose
Bound the number of consecutive unsuccessful independent review rounds per stage so that stalled review loops stop and the user decides how to continue.

## Requirements

### Requirement: Count consecutive changes-required rounds
For each change and review stage, the CLI SHALL count the review reports with outcome `changes_required` made since the most recent `passed` report for that stage, or since the first review if there was no pass.
- A `passed` report resets the count to zero.
- `blocked` reports (for example authentication failure, timeout, invalid output or concurrent edits) neither add to the count nor reset it.

#### Scenario: Failures accumulate
- **GIVEN** the code stage has reports `changes_required`, `blocked`, `changes_required`
- **WHEN** the count is evaluated
- **THEN** the count is 2

#### Scenario: Pass resets the count
- **GIVEN** the requirements stage has reports `changes_required`, `changes_required`, `passed`, `changes_required`
- **WHEN** the count is evaluated
- **THEN** the count is 1

#### Scenario: Stages are counted separately
- **GIVEN** the requirements stage has reached its limit
- **WHEN** a code review is requested
- **THEN** the code review is limited only by its own count

### Requirement: Configure the round limit globally and per stage
The limit SHALL come from `review.maxRounds` (default 3). A stage-specific limit, when configured, replaces it for that stage. Every limit SHALL be a whole number from 1 to 20.

#### Scenario: Stage limit replaces the global limit
- **GIVEN** `maxRounds` is 3 and the `code` stage sets `maxRounds` to 5
- **WHEN** code reviews are requested
- **THEN** up to 5 consecutive `changes_required` rounds are allowed for code, and 3 for requirements

#### Scenario: Invalid limit
- **WHEN** a configured limit is 0, above 20 or not a whole number
- **THEN** review commands fail with an invalid configuration error

### Requirement: Stop at the limit
When the count for a stage has reached its limit, a review request for that stage SHALL NOT start the reviewer. Instead it SHALL return outcome `limit_reached` with exit code 1, including:
- the stage
- the count and the limit
- the open findings from the most recent `changes_required` report
- if the latest report is `blocked`, its summary
- how to continue (user-approved extra rounds)

#### Scenario: Limit reached
- **GIVEN** the code stage limit is 3 and the last 3 code reports are `changes_required`
- **WHEN** `openspec review code` runs without extra rounds
- **THEN** no reviewer process starts, the output reports `limit_reached` with the latest open findings, and the command exits with code 1

#### Scenario: Latest report is blocked at the limit
- **GIVEN** the code stage limit is 2 and the code reports are `changes_required`, `changes_required`, `blocked`
- **WHEN** `openspec review code` runs without extra rounds
- **THEN** the output reports `limit_reached` with the open findings of the second `changes_required` report and the summary of the `blocked` report

#### Scenario: Below the limit
- **GIVEN** the code stage limit is 3 and the count is 2
- **WHEN** `openspec review code` runs
- **THEN** the reviewer runs normally

### Requirement: Limit-reached leaves evidence untouched
A `limit_reached` response SHALL NOT write or replace any review report, and SHALL never count as a passed review for readiness or archive.

#### Scenario: Evidence unchanged at the limit
- **GIVEN** the code stage has reached its limit
- **WHEN** `openspec review code` returns `limit_reached`
- **THEN** the saved review reports are byte-for-byte unchanged and readiness still reports the code review as not passed

### Requirement: Allow extra rounds on explicit request
`openspec review requirements` and `openspec review code` SHALL accept `--extra-rounds <n>`, a whole number from 1 to 20. With it, a review may run while the count is below the limit plus `n`. The allowance applies only to the command that carries it; later commands without it are limited by the configured limit again. A report produced under an allowance SHALL record the allowance.

#### Scenario: Extra rounds allow one more review
- **GIVEN** the limit is 3 and the count is 3
- **WHEN** the user runs `openspec review code --extra-rounds 2`
- **THEN** the review runs and its report records an extra-round allowance of 2

#### Scenario: Extra rounds exhausted
- **GIVEN** the limit is 3 and the count is 5
- **WHEN** `openspec review code --extra-rounds 2` runs
- **THEN** the outcome is `limit_reached`

#### Scenario: Allowance does not persist
- **GIVEN** a review ran with `--extra-rounds 2` and returned `changes_required`
- **WHEN** the next review runs without `--extra-rounds`
- **THEN** the outcome is `limit_reached`

### Requirement: Agents defer to the user at the limit
The installed workflow skills SHALL instruct agents to stop when a review reports `limit_reached` and to summarize the open findings for the user. Agents SHALL use `--extra-rounds`, `--model` or `--effort` only when the user explicitly asks.

#### Scenario: Agent hits the limit
- **WHEN** an agent receives `limit_reached` during the fix/verify/review loop
- **THEN** it pauses, reports the remaining findings and asks the user how to proceed, without adding extra rounds on its own
