import { relevantDecisions } from '../decision-register.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ReviewRequest, ReviewSnapshot } from './types.js';

export const hashContent = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export async function assertInside(root: string, candidate: string): Promise<void> {
  const canonicalRoot = await fs.realpath(root);
  const canonicalCandidate = await fs.realpath(candidate);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path outside managed root: ${candidate}`);
  }
}
export function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function walk(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    if (item.name === 'reviews') continue;
    const file = path.join(root, item.name);
    if (item.isSymbolicLink()) { output.push(file); continue; }
    if (item.isDirectory()) output.push(...await walk(file));
    else if (item.isFile()) output.push(file);
  }
  return output;
}
export async function getReviewSnapshot(request: ReviewRequest): Promise<ReviewSnapshot> {
  await assertInside(path.join(request.planningRoot, 'openspec', 'changes'), request.changeRoot);
  const manifest: ReviewSnapshot['files'] = [];
  const add = async (file: string, label: string) => {
    let bytes: Buffer;
    const scope = label.startsWith('planning/') ? request.planningRoot : request.implementationRoot;
    let parent = path.dirname(file);
    while (true) {
      try { await assertInside(scope, parent); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const next = path.dirname(parent);
        if (next === parent) throw error;
        parent = next;
      }
    }
    try {
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(file);
        const scope = label.startsWith('planning/') ? request.planningRoot : request.implementationRoot;
        let content = `[symbolic link: ${target}]`;
        try {
          await assertInside(scope, file);
          if ((await fs.stat(file)).isFile()) content += '\n' + (await fs.readFile(file)).toString('base64');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof Error && error.message.includes('outside managed root'))) throw error;
          content += '\n[target unavailable within reviewed root]';
        }
        manifest.push({ path: label, hash: hashContent(content), content });
        return;
      }
      if (stat.isDirectory()) {
        let subRoot: string;
        try { subRoot = git(file, ['rev-parse', '--show-toplevel']).trim(); }
        catch { throw new Error(`Initialize submodule ${file} before reviewing it.`); }
        if (await fs.realpath(subRoot) !== await fs.realpath(file)) throw new Error(`Initialize submodule ${file} before reviewing it.`);
        const head = git(file, ['rev-parse', '--verify', 'HEAD']).trim();
        manifest.push({ path: `${label}/.gitlink`, hash: hashContent(head), content: `Submodule commit: ${head}` });
        const children = new Set([
          ...git(file, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0'),
          ...git(file, ['ls-tree', '-r', '--name-only', '-z', head]).split('\0'),
        ].filter(Boolean));
        for (const child of [...children].sort()) await add(path.join(file, child), `${label}/${child}`);
        return;
      }
      if (!stat.isFile()) throw new Error(`Review requires a regular file: ${file}`);
      bytes = await fs.readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      manifest.push({ path: label, hash: 'deleted', content: '[deleted]' });
      return;
    }
    const text = bytes.includes(0) ? '[binary content]' : bytes.toString('utf8');
    // Completing checkboxes cannot invalidate the requirements being implemented.
    const normalized = label.endsWith('/tasks.md') ? text.replace(/- \[[ xX]\]/g, '- [ ]') : text;
    manifest.push({ path: label, hash: hashContent(label.endsWith('/tasks.md') ? normalized : label.startsWith('implementation/') ? Buffer.concat([Buffer.from(`mode:${(await fs.stat(file)).mode & 0o111}\n`), bytes]) : bytes), content: normalized });
  };
  for (const file of await walk(request.changeRoot)) {
    await add(file, `planning/${path.relative(request.changeRoot, file).split(path.sep).join('/')}`);
  }
  const decisionProjection = JSON.stringify(await relevantDecisions(request.planningRoot, request.changeName));
  manifest.push({ path: 'planning/relevant-decisions.json', hash: hashContent(decisionProjection), content: decisionProjection });
  const dispositions = path.join(request.changeRoot, `reviews/${request.stage}-dispositions.md`);
  try {
    await assertInside(request.changeRoot, dispositions);
    await add(dispositions, 'planning/review-dispositions.md');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let base: string | undefined;
  if (request.stage === 'code') {
    if (!request.base) throw new Error('An explicit review base is required (--base or review.base).');
    base = git(request.implementationRoot, ['rev-parse', '--verify', `${request.base}^{commit}`]).trim();
    const files = new Set([
      ...git(request.implementationRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0'),
      ...git(request.implementationRoot, ['ls-tree', '-r', '--name-only', '-z', base]).split('\0'),
    ].filter(Boolean));
    for (const name of [...files].sort()) {
      const file = path.resolve(request.implementationRoot, name);
      const relativeChange = path.relative(request.changeRoot, file);
      if (!relativeChange.startsWith(`..${path.sep}`) && relativeChange !== '..' && !path.isAbsolute(relativeChange)) continue;
      if (name === 'openspec/decisions.md') continue;
      // A symlinked parent must not read outside the implementation root.
      let parent = path.dirname(file);
      while (true) {
        try { await assertInside(request.implementationRoot, parent); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          const next = path.dirname(parent);
          if (next === parent) throw error;
          parent = next;
        }
      }
      await add(file, `implementation/${name}`);
    }
  }
  manifest.sort((a, b) => a.path.localeCompare(b.path));
  return { hash: hashContent(JSON.stringify({ base, files: manifest.map(({ path: file, hash }) => [file, hash]) })), base, files: manifest };
}
