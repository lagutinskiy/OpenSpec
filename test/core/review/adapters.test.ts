import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { reviewWithCodex } from '../../../src/core/review/adapters/codex.js';
import { reviewWithClaude } from '../../../src/core/review/adapters/claude.js';

// Real subprocesses stand in for authenticated CLIs; adapters still build arguments,
// send stdin, read final output, and reject execution/output failures themselves.
describe('review CLI adapters', () => {
  let root: string;
  let oldPath: string | undefined;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-adapter-'));
    oldPath = process.env.PATH;
    process.env.PATH = root + path.delimiter + oldPath;
  });
  afterEach(async () => {
    process.env.PATH = oldPath;
    await fs.rm(root, { recursive: true, force: true });
  });
  async function fake(name: string, code: string) {
    await fs.writeFile(path.join(root, name), `#!${process.execPath}\n${code}`, { mode: 0o755 });
  }
  it('runs Codex read-only and reads the final structured message', async () => {
    await fake('codex', `const fs=require('fs');const a=process.argv.slice(2);if(!a.includes('read-only')||!a.includes('--ephemeral'))process.exit(2);let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify({outcome:'passed',summary:s,findings:[]})));`);
    expect(await reviewWithCodex('review this', {}, root, 5000)).toEqual({ outcome: 'passed', summary: 'review this', findings: [] });
  });
  it('runs Claude with inspection tools only and unwraps its structured report', async () => {
    await fake('claude', `const a=process.argv.slice(2);if(a[a.indexOf('--tools')+1]!=='Read,Glob,Grep'||!a.includes('--strict-mcp-config'))process.exit(2);process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({subtype:'success',structured_output:{outcome:'passed',summary:'Reviewed',findings:[]}})));`);
    expect(await reviewWithClaude('review', {}, root, 5000)).toEqual({ outcome: 'passed', summary: 'Reviewed', findings: [] });
  });
  it('rejects Claude error envelopes and malformed output', async () => {
    await fake('claude', `process.stdin.resume();process.stdin.on('end',()=>console.log('{"is_error":true}'));`);
    await expect(reviewWithClaude('review', {}, root, 5000)).rejects.toThrow(/complete/);
    await fake('claude', `process.stdin.resume();process.stdin.on('end',()=>console.log('truncated'));`);
    await expect(reviewWithClaude('review', {}, root, 5000)).rejects.toThrow();
  });
});
