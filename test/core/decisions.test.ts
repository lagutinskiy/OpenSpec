import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureDecisionRegister, acknowledgeDecisions, decisionsAcknowledged, blockingDecisions } from '../../src/core/decisions.js';

describe('persistent decisions', () => {
  let root: string;
  let changeRoot: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-decisions-'));
    changeRoot = path.join(root, 'openspec/changes/example');
    await fs.mkdir(changeRoot, { recursive: true });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  it('retains a project register and invalidates acknowledgement on edits', async () => {
    const file = await ensureDecisionRegister(root);
    await acknowledgeDecisions(root, changeRoot, 'example');
    expect(await decisionsAcknowledged(root, changeRoot, 'example')).toBe(true);
    await fs.appendFile(file, '\nA follow-up question.\n');
    expect(await decisionsAcknowledged(root, changeRoot, 'example')).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toContain('Decisions');
  });
  it('blocks only unresolved decisions affecting this change', async () => {
    const file = await ensureDecisionRegister(root);
    await fs.appendFile(file, '\n| D-001 | Export format? | open | owner | example | yes | Decide | |\n| D-002 | Another feature? | open | owner | other | yes | Decide | |\n');
    expect(await blockingDecisions(root, 'example')).toEqual(['D-001']);
    await expect(acknowledgeDecisions(root, changeRoot, 'example')).rejects.toThrow(/D-001/);
  });
  it.each(['D-O01', 'D-001'])('rejects malformed or duplicate decision IDs: %s', async id => {
    const file = await ensureDecisionRegister(root);
    await fs.appendFile(file, `\n| D-001 | Question | open | owner | example | yes | Decide | |\n| ${id} | Other | open | owner | example | yes | Decide | |`);
    await expect(blockingDecisions(root, 'example')).rejects.toThrow(/Malformed or duplicate/);
  });

});
