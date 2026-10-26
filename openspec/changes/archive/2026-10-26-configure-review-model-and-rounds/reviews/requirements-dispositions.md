# Requirements review dispositions

## Round 1

- **REQ-001**: fixed.
  - The requirement now states that recorded settings are not compared when deciding whether a review is current, so different `--model`/`--effort` flags do not stale evidence.
  - Editing `openspec/config.yaml` stays a fingerprinted content change that stales code evidence, as today.
  - The scenarios are updated, design adds "Settings vs. snapshot freshness" with the rejected alternative, and task 6.5 covers both cases.
- **REQ-002**: fixed.
  - `limit_reached` now returns open findings from the newest `changes_required` report, plus the latest blocked summary when the newest report is blocked.
  - Added the scenario "Latest report is blocked at the limit", design output fields `findingsRound`/`latestBlockedSummary`, and task 6.7.

## Round 2 follow-up

Round 2 passed. Strict validation then flagged two requirements as longer than 500 characters, so each was split without changing its behavior:
- "Reviewer settings do not affect review freshness" was split from "Record reviewer settings in evidence".
- "Limit-reached leaves evidence untouched" was split from "Stop at the limit".
