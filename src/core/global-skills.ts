import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AI_TOOLS } from './config.js';
import { resolveCommandInvocation, resolveCommandSurfaceCapability } from './command-surface.js';
import { generateSkillContent, getSkillTemplates } from './shared/skill-generation.js';
import { getTransformerForTool } from '../utils/command-references.js';

const OWNERSHIP_DIRECTORY = '.openspec';
const OWNERSHIP_FILE = 'managed-skills.json';
const OWNERSHIP_VERSION = 2;

const GLOBAL_SKILL_DIRECTORY: Record<string, (homeDir: string, configHome: string) => string> = {
  codex: (home) => path.join(home, '.agents', 'skills'),
  claude: (home) => path.join(home, '.claude', 'skills'),
  pi: (home) => path.join(home, '.agents', 'skills'),
  cursor: (home) => path.join(home, '.agents', 'skills'),
  devin: (_home, config) => path.join(config, 'devin', 'skills'),
  opencode: (_home, config) => path.join(config, 'opencode', 'skills'),
  warp: (home) => path.join(home, '.agents', 'skills'),
  dsh: (home) => path.join(home, '.agents', 'skills'),
  grok: (home) => path.join(home, '.grok', 'skills'),
};

export interface GlobalSkillTarget {
  directory: string;
  tools: string[];
}

export interface GlobalSkillInstallOptions {
  homeDir?: string;
  configHome?: string;
  tools?: string[];
  version: string;
  fileSystem?: GlobalSkillFileSystem;
}

export type GlobalSkillFileSystem = Pick<
  typeof fs,
  'mkdir' | 'open' | 'writeFile' | 'rename' | 'rm' | 'lstat' | 'readFile' | 'readdir' | 'rmdir' | 'unlink'
>;

export interface GlobalSkillInstallResult {
  targets: GlobalSkillTarget[];
  installed: string[];
  updated: string[];
  restored: string[];
  skipped: string[];
  conflicts: string[];
}

interface OwnershipManifest {
  formatVersion: typeof OWNERSHIP_VERSION;
  managedSkills: string[];
  contentHashes: Record<string, string>;
}

class MalformedOwnershipMetadataError extends Error {}

export function resolveGlobalConfigHome(
  homeDir: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (environment.XDG_CONFIG_HOME && (platform === 'win32'
    ? path.win32.isAbsolute(environment.XDG_CONFIG_HOME)
    : path.isAbsolute(environment.XDG_CONFIG_HOME))) return path.resolve(environment.XDG_CONFIG_HOME);
  if (platform === 'win32' && environment.APPDATA) return path.resolve(environment.APPDATA);
  return path.join(homeDir, '.config');
}

export function resolveOpenCodeConfigHome(
  homeDir: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (environment.XDG_CONFIG_HOME && (platform === 'win32'
    ? path.win32.isAbsolute(environment.XDG_CONFIG_HOME)
    : path.isAbsolute(environment.XDG_CONFIG_HOME))) return path.resolve(environment.XDG_CONFIG_HOME);
  if (platform === 'win32') return path.join(homeDir, '.config');
  return resolveGlobalConfigHome(homeDir, environment, platform);
}

export function resolveGlobalSkillTargets(
  toolIds: string[],
  roots: { homeDir?: string; configHome?: string; platform?: NodeJS.Platform; environment?: NodeJS.ProcessEnv } = {}
): GlobalSkillTarget[] {
  const homeDir = path.resolve(roots.homeDir ?? os.homedir());
  const configHome = path.resolve(roots.configHome ?? resolveGlobalConfigHome(homeDir, roots.environment, roots.platform));
  const openCodeConfigHome = path.resolve(roots.configHome ?? resolveOpenCodeConfigHome(homeDir, roots.environment, roots.platform));
  const grouped = new Map<string, string[]>();

  for (const toolId of toolIds) {
    const directoryResolver = GLOBAL_SKILL_DIRECTORY[toolId];
    if (!directoryResolver || !AI_TOOLS.some((tool) => tool.value === toolId)) {
      throw new Error(`Unsupported harness: ${toolId}`);
    }
    const directory = path.resolve(directoryResolver(homeDir, toolId === 'opencode' ? openCodeConfigHome : configHome));
    const tools = grouped.get(directory) ?? [];
    if (!tools.includes(toolId)) tools.push(toolId);
    grouped.set(directory, tools);
  }

  return [...grouped.entries()].map(([directory, tools]) => ({ directory, tools }));
}

function parseOwnershipManifest(contents: string): OwnershipManifest {
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid ownership metadata');
  const manifest = parsed as { formatVersion?: number; managedSkills?: unknown[]; contentHashes?: Record<string, string> };
  if ((manifest.formatVersion !== 1 && manifest.formatVersion !== OWNERSHIP_VERSION) || !Array.isArray(manifest.managedSkills) ||
    manifest.managedSkills.some((name) =>
      typeof name !== 'string' || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
    ) || (manifest.contentHashes !== undefined && (typeof manifest.contentHashes !== 'object' || manifest.contentHashes === null))) {
    throw new Error('Invalid ownership metadata');
  }
  return {
    formatVersion: OWNERSHIP_VERSION,
    managedSkills: [...new Set(manifest.managedSkills as string[])],
    contentHashes: manifest.contentHashes ?? {},
  };
}

function contentHash(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

async function acquireInstallLock(lockPath: string, fileSystem: GlobalSkillFileSystem): Promise<string> {
  const lockDirectory = path.dirname(lockPath);
  const lockDirectoryExisted = await exists(lockDirectory, fileSystem);
  await fileSystem.mkdir(lockDirectory, { recursive: true });
  const token = randomUUID();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let lockHandle;
    try {
      lockHandle = await fileSystem.open(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        if (!lockDirectoryExisted) await removeEmptySkillDirectory(lockDirectory, fileSystem);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    try {
      await lockHandle.writeFile(`${process.pid}\n${token}\n`);
      await lockHandle.close();
      return token;
    } catch (error) {
      let openedStat;
      try { openedStat = await lockHandle.stat(); } catch { /* Best-effort identity check. */ }
      await lockHandle.close().catch(() => {});
      try {
        const pathStat = await fileSystem.lstat(lockPath);
        if (openedStat && pathStat.dev === openedStat.dev && pathStat.ino === openedStat.ino) {
          await fileSystem.rm(lockPath, { force: true });
        }
      } catch { /* Keep any lock whose ownership cannot be verified. */ }
      if (!lockDirectoryExisted) await removeEmptySkillDirectory(lockDirectory, fileSystem);
      throw error;
    }
  }
  let ownerPid: number | undefined;
  try {
    ownerPid = Number.parseInt(await fileSystem.readFile(lockPath, 'utf8'), 10);
  } catch { /* The lock may have disappeared while being inspected. */ }
  let active = false;
  if (ownerPid && Number.isInteger(ownerPid) && ownerPid !== process.pid) {
    try {
      process.kill(ownerPid, 0);
      active = true;
    } catch (error) {
      active = (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
  throw new Error(active
    ? `an install is still running (PID ${ownerPid}); wait for it to finish`
    : `a stale install lock remains${ownerPid ? ` from PID ${ownerPid}` : ''}; verify that process is stopped before removing it`);
}

async function removeEmptySkillDirectory(
  directory: string,
  fileSystem: GlobalSkillFileSystem
): Promise<boolean> {
  try {
    if ((await fileSystem.readdir(directory)).length !== 0) return false;
    await fileSystem.rmdir(directory);
    return true;
  } catch {
    return false;
  }
}

async function releaseInstallLock(
  lockPath: string,
  token: string,
  targetDirectory: string,
  result: GlobalSkillInstallResult,
  fileSystem: GlobalSkillFileSystem
): Promise<void> {
  try {
    const contents = await fileSystem.readFile(lockPath, 'utf8');
    if (!contents.split(/\r?\n/).includes(token)) {
      result.skipped.push(targetDirectory);
      result.conflicts.push(`${lockPath}: install lock ownership changed; left it untouched`);
      return;
    }
    await fileSystem.rm(lockPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    result.skipped.push(targetDirectory);
    result.conflicts.push(`${lockPath}: could not remove install lock (${(error as Error).message})`);
  }
}

async function readOwnershipManifest(
  filePath: string,
  fileSystem: GlobalSkillFileSystem
): Promise<OwnershipManifest | undefined> {
  let contents: string;
  try {
    contents = await fileSystem.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return parseOwnershipManifest(contents);
  } catch {
    throw new MalformedOwnershipMetadataError('Invalid ownership metadata');
  }
}

async function exists(filePath: string, fileSystem: GlobalSkillFileSystem): Promise<boolean> {
  try {
    await fileSystem.lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicWrite(
  filePath: string,
  contents: string,
  fileSystem: GlobalSkillFileSystem
): Promise<void> {
  await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fileSystem.writeFile(temporaryPath, contents, { flag: 'wx' });
    await fileSystem.rename(temporaryPath, filePath);
  } finally {
    await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function ensureOwnershipDirectoryWritable(
  ownershipDirectory: string,
  fileSystem: GlobalSkillFileSystem
): Promise<void> {
  await fileSystem.mkdir(ownershipDirectory, { recursive: true });
  const probePath = path.join(ownershipDirectory, `.write-probe-${process.pid}-${randomUUID()}`);
  try {
    await fileSystem.writeFile(probePath, '', { flag: 'wx' });
  } finally {
    await fileSystem.rm(probePath, { force: true }).catch(() => {});
  }
}

async function rollbackNewSkill(
  skillDirectory: string,
  skillFile: string,
  generated: string,
  fileSystem: GlobalSkillFileSystem
): Promise<boolean> {
  try {
    const stat = await fileSystem.lstat(skillFile);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    if (await fileSystem.readFile(skillFile, 'utf8') !== generated) return false;
    const entries = await fileSystem.readdir(skillDirectory);
    if (entries.length !== 1 || entries[0] !== 'SKILL.md') return false;
    await fileSystem.unlink(skillFile);
    await fileSystem.rmdir(skillDirectory);
    return true;
  } catch {
    return false;
  }
}

function ownershipContents(manifest: OwnershipManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function installGlobalSkills(
  options: GlobalSkillInstallOptions
): Promise<GlobalSkillInstallResult> {
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const tools = options.tools ?? AI_TOOLS.map((tool) => tool.value);
  const targets = resolveGlobalSkillTargets(tools, {
    homeDir,
    ...(options.configHome ? { configHome: path.resolve(options.configHome) } : {}),
  });
  const fileSystem = options.fileSystem ?? fs;
  const result: GlobalSkillInstallResult = {
    targets,
    installed: [],
    updated: [],
    restored: [],
    skipped: [],
    conflicts: [],
  };
  const templates = getSkillTemplates();

  for (const target of targets) {
    const manifestPath = path.join(target.directory, OWNERSHIP_DIRECTORY, OWNERSHIP_FILE);
    const ownershipDirectory = path.join(target.directory, OWNERSHIP_DIRECTORY);
    const lockPath = path.join(ownershipDirectory, 'install.lock');
    const targetDirectoryExisted = await exists(target.directory, fileSystem);
    const ownershipDirectoryExisted = await exists(ownershipDirectory, fileSystem);
    let lockToken: string;
    try {
      lockToken = await acquireInstallLock(lockPath, fileSystem);
    } catch (error) {
      result.skipped.push(target.directory);
      result.conflicts.push(`${lockPath}: ${ (error as Error).message }`);
      if (!targetDirectoryExisted) await removeEmptySkillDirectory(target.directory, fileSystem);
      continue;
    }
    try {
    let manifest: OwnershipManifest;
    try {
      manifest = (await readOwnershipManifest(manifestPath, fileSystem)) ?? {
        formatVersion: OWNERSHIP_VERSION,
        managedSkills: [],
        contentHashes: {},
      };
    } catch (error) {
      result.skipped.push(target.directory);
      result.conflicts.push(error instanceof MalformedOwnershipMetadataError
        ? `${manifestPath}: malformed ownership metadata`
        : `${manifestPath}: could not read ownership metadata (${(error as Error).message})`);
      continue;
    }

    const ownershipDirectory = path.dirname(manifestPath);
    try {
      await ensureOwnershipDirectoryWritable(ownershipDirectory, fileSystem);
    } catch (error) {
      result.skipped.push(target.directory);
      result.conflicts.push(
        `${ownershipDirectory}: ownership directory is not writable (${(error as Error).message})`
      );
      continue;
    }

    for (const entry of templates) {
      const skillFile = path.join(target.directory, entry.dirName, 'SKILL.md');
      const skillDirectory = path.dirname(skillFile);
      const alreadyOwned = manifest.managedSkills.includes(entry.dirName);
      let generated = '';
      let wasMissing = false;
      let skillDirectoryExisted: boolean | undefined;
      try {
        skillDirectoryExisted = await exists(skillDirectory, fileSystem);
        if (skillDirectoryExisted) {
          const directoryStat = await fileSystem.lstat(skillDirectory);
          if (directoryStat.isSymbolicLink()) {
            result.skipped.push(skillDirectory);
            result.conflicts.push(`${skillDirectory}: skill directory is a symbolic link`);
            continue;
          }
          if (!alreadyOwned) {
            result.skipped.push(skillDirectory);
            result.conflicts.push(
              `${skillDirectory}: ${directoryStat.isDirectory() ? 'skill directory' : 'skill path'} exists without OpenSpec ownership metadata`
            );
            continue;
          }
          if (!directoryStat.isDirectory()) {
            result.skipped.push(skillDirectory);
            result.conflicts.push(`${skillDirectory}: owned skill is missing or malformed`);
            continue;
          }
        }

        const referenceTool = target.directory === path.join(homeDir, '.agents', 'skills')
          ? 'codex'
          : target.tools[0];
        const transformer = getTransformerForTool(
          referenceTool,
          'skills',
          resolveCommandSurfaceCapability(referenceTool),
          resolveCommandInvocation(referenceTool)
        );
        generated = generateSkillContent(entry.template, options.version, transformer);

        if (alreadyOwned) {
          let skillStat;
          try {
            skillStat = await fileSystem.lstat(skillFile);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          if (skillStat && (!skillStat.isFile() || skillStat.isSymbolicLink())) {
            result.skipped.push(skillDirectory);
            result.conflicts.push(`${skillDirectory}: owned skill is missing or malformed`);
            continue;
          }
          if (skillStat) {
            const current = await fileSystem.readFile(skillFile, 'utf8');
            const expectedHash = manifest.contentHashes[entry.dirName];
            if (expectedHash ? contentHash(current) !== expectedHash : current !== generated) {
              result.skipped.push(skillDirectory);
              result.conflicts.push(`${skillFile}: skill was modified locally`);
              continue;
            }
          } else {
            wasMissing = true;
          }
        }

        const previousContent = alreadyOwned && await exists(skillFile, fileSystem)
          ? await fileSystem.readFile(skillFile, 'utf8')
          : undefined;
        await atomicWrite(skillFile, generated, fileSystem);
        const nextManifest: OwnershipManifest = {
          formatVersion: OWNERSHIP_VERSION,
          managedSkills: alreadyOwned ? manifest.managedSkills : [...manifest.managedSkills, entry.dirName],
          contentHashes: { ...manifest.contentHashes, [entry.dirName]: contentHash(generated) },
        };
        try {
          await atomicWrite(manifestPath, ownershipContents(nextManifest), fileSystem);
          manifest = nextManifest;
          const label = `${target.directory}:${entry.dirName}`;
          if (wasMissing) result.restored.push(label);
          else if (alreadyOwned) result.updated.push(label);
          else result.installed.push(label);
        } catch (error) {
          result.skipped.push(skillDirectory);
          let rollbackDetail = 'changes were rolled back where possible';
          try {
            if (previousContent !== undefined) {
              await atomicWrite(skillFile, previousContent, fileSystem);
            } else if (wasMissing) {
              if (await exists(skillFile, fileSystem) && await fileSystem.readFile(skillFile, 'utf8') === generated) {
                await fileSystem.unlink(skillFile);
                await removeEmptySkillDirectory(skillDirectory, fileSystem);
              } else {
                rollbackDetail = `could not safely remove the restored skill at ${skillFile}`;
              }
            } else if (!await rollbackNewSkill(skillDirectory, skillFile, generated, fileSystem)) {
              rollbackDetail = `could not safely remove the new skill at ${skillFile}`;
            }
          } catch (rollbackError) {
            rollbackDetail = `rollback failed (${(rollbackError as Error).message}); inspect ${skillFile}`;
          }
          result.conflicts.push(
            `${skillFile}: could not record ownership in ${manifestPath} for ${entry.dirName} (${(error as Error).message}); ${rollbackDetail}`
          );
        }
      } catch (error) {
        result.skipped.push(skillDirectory);
        const removedEmptyDirectory = skillDirectoryExisted === false &&
          await removeEmptySkillDirectory(skillDirectory, fileSystem);
        result.conflicts.push(
          `${skillFile}: could not install skill (${(error as Error).message})${removedEmptyDirectory ? '; removed the empty skill directory' : ''}`
        );
      }
    }
    } finally {
      await releaseInstallLock(lockPath, lockToken, target.directory, result, fileSystem);
      const wroteSkills = [...result.installed, ...result.updated, ...result.restored]
        .some((entry) => entry.startsWith(`${target.directory}:`));
      if (!ownershipDirectoryExisted && !wroteSkills && !await exists(manifestPath, fileSystem)) {
        await removeEmptySkillDirectory(ownershipDirectory, fileSystem);
        if (!targetDirectoryExisted) await removeEmptySkillDirectory(target.directory, fileSystem);
      }
    }
  }

  return result;
}
