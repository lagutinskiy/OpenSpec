import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface DecisionEntry {
  id: string; question: string; status: 'open' | 'resolved'; owner: string;
  changes: string[]; blocking: boolean; nextAction: string; resolution: string;
}
/** Parse every data row, so malformed identifiers cannot silently disable a blocker. */
export function parseDecisions(text: string): DecisionEntry[] {
  const entries: DecisionEntry[] = [];
  const ids = new Set<string>();
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().split('|').slice(1, -1).map(cell => cell.trim());
    if (cells[0] === 'ID' || cells.every(cell => /^:?-+:?$/.test(cell))) continue;
    const [id, question, status, owner, changes, blocking, nextAction, resolution] = cells;
    if (cells.length !== 8 || !/^D-\d+$/.test(id ?? '') || ids.has(id) ||
      !['open', 'resolved'].includes(status) || !['yes', 'no'].includes(blocking) || !question || !changes) {
      throw new Error(`Malformed or duplicate decision ${id || '(missing ID)'}; use unique D-<digits> IDs and the register table format.`);
    }
    if (status === 'open' && (!owner || !nextAction)) throw new Error(`Open decision ${id} requires owner and next action.`);
    if (status === 'resolved' && !resolution) throw new Error(`Resolved decision ${id} requires a resolution.`);
    ids.add(id);
    entries.push({ id, question, status: status as DecisionEntry['status'], owner,
      changes: changes.split(',').map(change => change.trim()), blocking: blocking === 'yes', nextAction, resolution });
  }
  return entries;
}
export async function relevantDecisions(planningRoot: string, changeName: string): Promise<DecisionEntry[]> {
  let text: string;
  try { text = await fs.readFile(path.join(planningRoot, 'openspec/decisions.md'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return parseDecisions(text).filter(entry => entry.changes.includes(changeName) || entry.changes.includes('*')).sort((a, b) => a.id.localeCompare(b.id));
}
