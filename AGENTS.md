# Private OpenSpec

This repository builds local development skills and the CLI that installs them.

- Support exactly `codex`, `claude`, `pi`, `cursor`, `devin`, `opencode`, `warp`, `dsh`, and `grok`.
- Keep telemetry, anonymous identities, remote version checks, self-updaters, remote installers, Copilot integration, websites, and GitHub CI out of this fork.
- `openspec update` refreshes project skills from the installed local package; it does not upgrade the CLI.
- Proposals and specs describe business outcomes and observable behavior. Keep implementation details in design/tasks unless the interface itself is the requested subject.
- Requirements review precedes implementation. Codex and Claude Code review each other's work. Do not substitute self-review or fabricated evidence when a reviewer is unavailable.
- Keep unresolved decisions in the planning root's `openspec/decisions.md`; review and reconcile affected entries at archive.
- Edit workflow sources under `src/core/templates/workflows/`, then run `npm run build`, `npm run generate:skills`, and `npm run regen:parity-hashes`.
- Run `npm run check` for local build, lint, and tests. Use `npm run pack:local` to create an installable private tarball without install-time scripts.
- Preserve custom project files when installing or refreshing skills.
