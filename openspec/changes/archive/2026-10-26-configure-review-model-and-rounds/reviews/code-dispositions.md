# Code review dispositions

## Round 1

- **CODE-001**: fixed.
  - `src/core/review/adapters/claude.ts` now appends the envelope's `result` and any `errors` (capped at 2000 characters) to the thrown error. `runReview` saves that message as the blocked report summary.
  - Tests:
    - `test/core/review/adapters.test.ts` "keeps Claude diagnostics when it rejects the model" covers a Claude model-rejection envelope.
    - `test/core/review/service.test.ts` "saves the reviewer diagnostic when a model is rejected" checks that the saved blocked report carries the diagnostic.
