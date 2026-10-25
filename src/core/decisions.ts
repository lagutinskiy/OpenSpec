import { parseDecisions } from './decision-register.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertInside, hashContent } from './review/fingerprint.js';
import { writeEvidence } from './review/service.js';

const TEMPLATE = `# Decisions

Keep stable IDs. Record unresolved questions when discovered; resolve requirements
and approach blockers before implementation. Reflect settled behavior in the
proposal/spec/design as well as this register. At archive, review entries affecting
the change and record resolution or an owner and next action for deferrable work.
Use comma-separated change names, or * for all changes. Status is open or resolved.
Use yes/no for Blocks implementation. Do not use pipe characters inside cells.

| ID | Question / context | Status | Owner | Affected changes | Blocks implementation | Next action | Resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
`;
export async function ensureDecisionRegister(planningRoot: string): Promise<string> {
  const dir = path.join(planningRoot, 'openspec');
  await assertInside(planningRoot, dir);
  const file = path.join(dir, 'decisions.md');
  try { await fs.writeFile(file, TEMPLATE, { flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  await assertInside(dir, file);
  return file;
}
export async function blockingDecisions(planningRoot: string, changeName: string): Promise<string[]> {
  const file = await ensureDecisionRegister(planningRoot);
  const text = await fs.readFile(file, 'utf8');
  return parseDecisions(text).filter(entry => entry.status === 'open' && entry.blocking &&
    (entry.changes.includes(changeName) || entry.changes.includes('*'))).map(entry => entry.id);
}
export async function acknowledgeDecisions(planningRoot: string, changeRoot: string, changeName: string): Promise<void> {
  const blocked = await blockingDecisions(planningRoot, changeName);
  if (blocked.length) throw new Error(`Resolve blocking decisions: ${blocked.join(', ')}`);
  const file = await ensureDecisionRegister(planningRoot);
  await writeEvidence(changeRoot, 'archive-decisions.json', {
    version: 1, changeName, hash: hashContent(await fs.readFile(file)), acknowledgedAt: new Date().toISOString(),
  });
}
export async function decisionsAcknowledged(planningRoot: string, changeRoot: string, changeName: string): Promise<boolean> {
  if ((await blockingDecisions(planningRoot, changeName)).length) return false;
  const file = path.join(changeRoot, 'reviews', 'archive-decisions.json');
  try {
    await assertInside(changeRoot, file);
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    return record.version === 1 && record.changeName === changeName && record.hash === hashContent(await fs.readFile(path.join(planningRoot, 'openspec/decisions.md')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
}
