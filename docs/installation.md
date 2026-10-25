# Install in your projects

Requires Node.js 20.19.0 or newer. Install the reviewer CLI separately and authenticate it.

## Clone and build the private repository

Clone the repository using your private Git URL, then build a local package:

```sh
git clone "YOUR_PRIVATE_REPOSITORY_URL" ~/src/openspec-private
cd ~/src/openspec-private
npx --yes pnpm@10.34.5 install --frozen-lockfile
npm run pack:local
```

If pnpm 10.34.5 is already installed, use `pnpm install --frozen-lockfile` for the first command.

## Install the private package

Install the tarball produced in `artifacts/`:

```sh
npm install --global ./artifacts/private-openspec-1.15.0.tgz
```

This provides the `openspec` command. Keep your private fork separate from an
upstream global OpenSpec installation; both use the same command name.

To use the CLI directly from the clone without a global install, run
`node /path/to/openspec-private/bin/openspec.js <command>`.

## Install skills for every project on this machine

Install the workflow skills into the global user directories supported by the
selected harnesses:

```sh
openspec skills install --global
```

This installs skills for all nine supported harnesses. To select only some,
pass a comma-separated list:

```sh
openspec skills install --global --tools codex,claude
```

The shared destination for Codex, Pi, Cursor, Warp, and DSH is
`~/.agents/skills`. Claude Code uses `~/.claude/skills`; Devin uses
`~/.config/devin/skills` (Windows: `%APPDATA%\devin\skills`); OpenCode uses
`~/.config/opencode/skills` (Windows: `%USERPROFILE%\.config\opencode\skills`);
and Grok uses `~/.grok/skills`. `XDG_CONFIG_HOME` overrides the config-based
paths when set to an absolute path; relative values are ignored. `--json`
emits structured skill entries with separate `directory` and `skill` fields,
and path-only entries where no skill name applies, so Windows drive letters
remain unambiguous.

The global command installs skills only. It does not create an `openspec/`
planning directory or install project commands or configuration. After pulling
and installing a newer private package, run the same command again to refresh
the installed skills. Open harness sessions may need to be restarted to load
the updated files.

Custom skills are preserved. If an OpenSpec skill name already exists without
installer ownership metadata, the command leaves it unchanged, reports the
conflict, and exits with a nonzero status. To retry, move or rename the
conflicting `openspec-*` directory from the destination path shown in the
message, preserving any content you need, then rerun the command.

If you edit a skill that OpenSpec installed, later runs detect the changed
content, preserve it, report a conflict, and continue refreshing the other
skills. To accept a newer OpenSpec copy, save your edits elsewhere, remove the
changed skill directory, and rerun installation. Missing installer-owned skills
are recreated automatically. If an interrupted install leaves
`<skills directory>/.openspec/install.lock`, remove that stale lock and rerun.
First confirm that the PID recorded in the lock is no longer running; do not
remove a lock held by an active install. If a skill came from an older install
that predates content hashes, the first refresh preserves it and reports a
conflict when the generated content differs. Save or remove that skill before
retrying to accept the generated version.

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

There are no automatic version checks or self-updaters. To update the installed
CLI, pull the private repository, rebuild the tarball, and install it again.
Then refresh a project's generated skills and commands:

```sh
openspec update
```

Review settings and usage are in [Workflow](workflow.md). Custom harness files are preserved. Known OpenSpec-managed legacy files may be reconciled during setup or refresh. Remove unwanted old installations yourself.

## Develop this fork

```sh
npm run check
```

The npm package contains `dist/`, `bin/`, and `schemas/`. Source tests, historical
plans, and project planning data are not installed into target projects.
