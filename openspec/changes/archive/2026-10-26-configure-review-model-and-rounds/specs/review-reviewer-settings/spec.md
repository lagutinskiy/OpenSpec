# Spec Delta

## Purpose
Let a project choose which model and how much reasoning effort the independent reviewer uses for each review stage, and make the choice visible in review evidence.

## ADDED Requirements

### Requirement: Configure reviewer model and effort per reviewer
A project SHALL be able to set a model and a reasoning effort for each reviewer (Codex and Claude Code) in the `review` section of the implementation project's `openspec/config.yaml`. The settings apply to every review stage performed by that reviewer unless a stage override applies.

#### Scenario: Configured settings are used
- **GIVEN** the project configures Claude Code with model `opus` and effort `high`
- **WHEN** a review runs with Claude Code as the reviewer
- **THEN** the reviewer runs with model `opus` and effort `high`

#### Scenario: Nothing configured
- **GIVEN** the project configures no model or effort for the selected reviewer
- **WHEN** a review runs
- **THEN** the reviewer runs with its own built-in defaults, as before this change

#### Scenario: Only one setting configured
- **GIVEN** the project configures an effort but no model for Codex
- **WHEN** a review runs with Codex as the reviewer
- **THEN** the configured effort is used and the model stays the reviewer's built-in default

### Requirement: Override reviewer settings per stage
A project SHALL be able to override the model and/or effort for a specific review stage and reviewer. A stage override replaces only the fields it sets. Fields it leaves out come from the reviewer-wide settings.

#### Scenario: Stage override applies to its stage only
- **GIVEN** Codex is configured with effort `high` and the `requirements` stage overrides Codex effort to `medium`
- **WHEN** a requirements review and then a code review run with Codex
- **THEN** the requirements review uses effort `medium` and the code review uses effort `high`

#### Scenario: Partial stage override keeps the reviewer-wide model
- **GIVEN** Claude Code is configured with model `opus` and effort `high`, and the `code` stage overrides only effort to `max`
- **WHEN** a code review runs with Claude Code
- **THEN** it uses model `opus` and effort `max`

### Requirement: Override reviewer settings for one run
`openspec review requirements` and `openspec review code` SHALL accept `--model <name>` and `--effort <level>`. These apply to that run only and take precedence over all configuration.

#### Scenario: Command-line override wins
- **GIVEN** configuration selects effort `medium` for the current stage and reviewer
- **WHEN** the user runs a review with `--effort high`
- **THEN** that review uses effort `high`, and later reviews without the flag use `medium` again

### Requirement: Validate effort levels before reviewing
The effort SHALL be one of the levels the selected reviewer supports:
- Claude Code: `low`, `medium`, `high`, `xhigh`, `max`
- Codex: `minimal`, `low`, `medium`, `high`, `xhigh`

An unsupported effort, whether from configuration or the command line, SHALL be reported as an error before any reviewer starts. No review report is written.

#### Scenario: Unsupported effort in configuration
- **GIVEN** the project configures Codex effort `max`
- **WHEN** a review is requested with Codex as the reviewer
- **THEN** the command fails with a message naming the reviewer, the invalid value and the supported levels, and no review report is written

#### Scenario: Settings for the non-selected reviewer are still validated
- **GIVEN** the configuration contains an unsupported effort for the reviewer that is not selected
- **WHEN** any review command runs
- **THEN** the configuration is rejected as invalid, so mistakes surface immediately

### Requirement: Unavailable model blocks the review
A model name SHALL be passed to the reviewer as given. If the reviewer cannot run with that model, the review outcome SHALL be `blocked`, never `passed`.

#### Scenario: Unknown model
- **WHEN** a review runs with a model name the reviewer CLI rejects
- **THEN** the report outcome is `blocked` and the summary includes the reviewer's error

### Requirement: Record reviewer settings in evidence
Each review report SHALL record the model and effort that were requested for it, or show that the reviewer default was used. Reports written before this change remain valid.

#### Scenario: Report shows settings
- **WHEN** a review completes with model `opus` and effort `high`
- **THEN** the saved report states model `opus` and effort `high`

### Requirement: Reviewer settings do not affect review freshness
The settings recorded in a report SHALL NOT be compared when deciding whether a review is current. Editing the implementation project's `openspec/config.yaml` SHALL remain a content change like any other reviewed file.

#### Scenario: Different flags after a passed review
- **GIVEN** a passed code review for the current content, made with `--effort high`
- **WHEN** readiness is checked, or the user later passes a different `--effort`
- **THEN** the existing passed review still counts toward readiness while the content is unchanged

#### Scenario: Configuration edit after a passed code review
- **GIVEN** a passed code review for the current content
- **WHEN** the project edits the review settings in `openspec/config.yaml`
- **THEN** the code review and verification evidence become stale and must be refreshed, like any other content change
