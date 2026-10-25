import type { Command } from 'commander';
import path from 'node:path';
import { AI_TOOLS } from '../../core/config.js';

export function formatGlobalSkillEntry(label: string): { directory: string; skill: string } | { path: string } {
  const skillSeparator = label.lastIndexOf(':openspec-');
  if (skillSeparator >= 0) {
    return { directory: label.slice(0, skillSeparator), skill: label.slice(skillSeparator + 1) };
  }
  const windowsPath = label.includes('\\');
  const pathApi = windowsPath ? path.win32 : path;
  const base = pathApi.basename(label);
  const skill = base === 'SKILL.md' ? pathApi.basename(pathApi.dirname(label)) : base;
  if (!skill.startsWith('openspec-')) return { path: label };
  const skillDirectory = base === 'SKILL.md' ? pathApi.dirname(label) : label;
  return { directory: skillDirectory.slice(0, -(skill.length + 1)), skill };
}

function parseToolSelection(value?: string): string[] {
  if (value === undefined || value.trim() === 'all') return AI_TOOLS.map((tool) => tool.value);
  const tools = value.split(',').map((tool) => tool.trim());
  if (tools.includes('all')) throw new Error('Invalid --tools list: all cannot be combined with named harnesses.');
  if (tools.some((tool) => !tool)) {
    throw new Error('Invalid --tools list: provide harness IDs separated by commas, or use all.');
  }
  const supported = new Set(AI_TOOLS.map((tool) => tool.value));
  const unknown = tools.find((tool) => !supported.has(tool));
  if (unknown) throw new Error(`Unsupported harness: ${unknown}`);
  return [...new Set(tools)];
}

export function registerSkillsCommand(program: Command, version: string): void {
  program
    .command('skills')
    .description('Install OpenSpec workflow skills')
    .command('install')
    .description('Install or refresh OpenSpec skills for your user account')
    .option('--global', 'Install skills for all projects on this machine')
    .option('--tools <tools>', `Harnesses: all or a comma-separated list of ${AI_TOOLS.map((tool) => tool.value).join(', ')}`)
    .option('--json', 'Output machine-readable JSON')
    .action(async (options: { global?: boolean; tools?: string; json?: boolean }) => {
      try {
        if (!options.global) throw new Error('--global is required for skills installation.');
        const tools = parseToolSelection(options.tools);
        const { installGlobalSkills } = await import('../../core/global-skills.js');
        const result = await installGlobalSkills({ tools, version });

        if (options.json) {
          const status = result.conflicts.map((message) => ({
            severity: 'error',
            code: 'global_skill_conflict',
            message,
          }));
          console.log(JSON.stringify({
            schemaVersion: 1,
            ...result,
            installed: result.installed.map(formatGlobalSkillEntry),
            updated: result.updated.map(formatGlobalSkillEntry),
            restored: result.restored.map(formatGlobalSkillEntry),
            skipped: result.skipped.map(formatGlobalSkillEntry),
            conflicts: result.conflicts.map((entry) => {
              const separator = entry.indexOf(': ');
              const location = separator >= 0 ? entry.slice(0, separator) : entry;
              const reason = separator >= 0 ? entry.slice(separator + 2) : entry;
              return { ...formatGlobalSkillEntry(location), reason };
            }),
            status,
          }, null, 2));
        } else {
          const directoryLabel = result.targets.length === 1 ? 'directory' : 'directories';
          console.log(
            `Installed ${result.installed.length} skill files, refreshed ${result.updated.length}, and restored ${result.restored.length} across ${result.targets.length} ${directoryLabel}.`
          );
          for (const target of result.targets) {
            console.log(`  ${target.directory} (${target.tools.join(', ')})`);
            const prefix = `${target.directory}:`;
            const installed = result.installed
              .filter((entry) => entry.startsWith(prefix))
              .map((entry) => entry.slice(prefix.length));
            const updated = result.updated
              .filter((entry) => entry.startsWith(prefix))
              .map((entry) => entry.slice(prefix.length));
            const restored = result.restored
              .filter((entry) => entry.startsWith(prefix))
              .map((entry) => entry.slice(prefix.length));
            if (installed.length > 0) console.log(`    Installed: ${installed.join(', ')}`);
            if (updated.length > 0) console.log(`    Refreshed: ${updated.join(', ')}`);
            if (restored.length > 0) console.log(`    Restored: ${restored.join(', ')}`);
          }
          for (const conflict of result.conflicts) console.error(`Skipped: ${conflict}`);
          if (result.installed.length > 0 || result.updated.length > 0 || result.restored.length > 0) {
            console.log('Restart open harness sessions to load the installed skills.');
          }
        }

        if (result.conflicts.length > 0 || result.skipped.length > 0) process.exitCode = 1;
      } catch (error) {
        const message = (error as Error).message;
        if (options.json) {
          console.log(JSON.stringify({
            schemaVersion: 1,
            targets: [],
            installed: [],
            updated: [],
            restored: [],
            skipped: [],
            conflicts: [],
            status: [{ severity: 'error', code: 'global_skills_install_failed', message }],
          }, null, 2));
        } else {
          console.error(`Error: ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
