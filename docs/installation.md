# Install in your projects

Requires Node.js 20.19.0 or newer. Install the reviewer CLI separately and authenticate it.

## Build once

From this private repository:

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npm run pack:local
```

If pnpm 10.34.5 is already installed, use `pnpm install --frozen-lockfile` for the first command.

## Install the private package

Use the tarball path printed by `pack:local`:

```sh
npm install --global ./artifacts/private-openspec-1.15.0.tgz
```

This provides the `openspec` command. Keep your private fork separate from an
upstream global OpenSpec installation; both use the same command name.

For development, run `node /absolute/path/to/this/repo/bin/openspec.js` instead.

## Configure a project

In each target project:

```sh
openspec init --tools codex,claude
```

Choose any comma-separated subset of `codex`, `claude`, `pi`, `cursor`, `devin`,
`opencode`, `warp`, `dsh`, and `grok`. `--tools all` selects all nine.

Skills go into the selected harness directories. Claude Code, Pi, Cursor, Devin,
and OpenCode also receive commands when the delivery setting includes commands.
Codex uses `.agents/skills/` and `$openspec-<skill>` invocations.

## Refresh project skills

There are no automatic version checks or self-updaters. After rebuilding and reinstalling your local tarball, refresh the installed project skills:

```sh
openspec update
```

Review settings and usage are in [Workflow](workflow.md). Custom harness files are preserved. Known OpenSpec-managed legacy files may be reconciled during setup or refresh. Remove unwanted old installations yourself.

## Develop this fork

```sh
npm run check
npm run generate:skills
```

The npm package contains `dist/`, `bin/`, and `schemas/`. Source tests, historical
plans, and project planning data are not installed into target projects.
