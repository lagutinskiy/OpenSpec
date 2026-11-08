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
  // Fake CLIs echo their argv as the summary so the test sees exactly what was passed.
  const echoCodex = `const fs=require('fs');const a=process.argv.slice(2);process.stdin.resume();process.stdin.on('end',()=>fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify({outcome:'passed',summary:JSON.stringify(a),findings:[]})));`;
  const echoClaude = `const a=process.argv.slice(2);process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({subtype:'success',structured_output:{outcome:'passed',summary:JSON.stringify(a),findings:[]}})));`;
  const argsOf = (report: unknown) => JSON.parse((report as { summary: string }).summary) as string[];
  it('passes Codex model and effort only when configured', async () => {
    await fake('codex', echoCodex);
    const plain = argsOf(await reviewWithCodex('review', {}, root, 5000));
    expect(plain).not.toContain('-m');
    expect(plain.some(arg => arg.startsWith('model_reasoning_effort'))).toBe(false);
    const tuned = argsOf(await reviewWithCodex('review', {}, root, 5000, { model: 'gpt-6.1-sol', effort: 'xhigh' }));
    expect(tuned[tuned.indexOf('-m') + 1]).toBe('gpt-6.1-sol');
    expect(tuned).toContain('model_reasoning_effort="xhigh"');
    expect(tuned).toContain('--ignore-user-config');
    expect(tuned[tuned.length - 1]).toBe('-');
  });
  it('passes Claude model and effort only when configured', async () => {
    await fake('claude', echoClaude);
    const plain = argsOf(await reviewWithClaude('review', {}, root, 5000));
    expect(plain).not.toContain('--model');
    expect(plain).not.toContain('--effort');
    const tuned = argsOf(await reviewWithClaude('review', {}, root, 5000, { effort: 'max' }));
    expect(tuned[tuned.indexOf('--effort') + 1]).toBe('max');
    expect(tuned).not.toContain('--model');
  });
  // --bare reads only ANTHROPIC_API_KEY or an apiKeyHelper, never the user's login,
  // so a subscription user's reviewer answered "Not logged in". --safe-mode keeps the
  // login and still disables CLAUDE.md, hooks, plugins, skills and MCP servers.
  it('runs Claude isolated in safe mode, which keeps the user\'s login', async () => {
    await fake('claude', echoClaude);
    const args = argsOf(await reviewWithClaude('review', {}, root, 5000));
    expect(args).toContain('--safe-mode');
    expect(args).not.toContain('--bare');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args).toContain('--strict-mcp-config');
  });
  // Zod stamps draft 2020-12 on its JSON Schema, and Claude Code's --json-schema
  // validator cannot resolve that meta-schema, so it refused every review.
  it('passes Claude a schema without a $schema declaration, leaving the caller\'s intact', async () => {
    await fake('claude', echoClaude);
    const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { ok: { type: 'boolean' } } };
    const args = argsOf(await reviewWithClaude('review', schema, root, 5000));
    const passed = JSON.parse(args[args.indexOf('--json-schema') + 1]);
    expect(passed).toEqual({ type: 'object', properties: { ok: { type: 'boolean' } } });
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });
  it('surfaces a reviewer rejecting the model', async () => {
    await fake('codex', `process.stdin.resume();process.stdin.on('end',()=>{console.error('model "nope" not found');process.exit(1);});`);
    await expect(reviewWithCodex('review', {}, root, 5000, { model: 'nope' })).rejects.toThrow(/model "nope" not found/);
  });
  it('keeps Claude diagnostics when it rejects the model', async () => {
    await fake('claude', `process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({is_error:true,subtype:'error',result:'model "nope" is not available'})));`);
    await expect(reviewWithClaude('review', {}, root, 5000, { model: 'nope' })).rejects.toThrow(/did not complete successfully: model "nope" is not available/);
  });
  it('rejects Claude error envelopes and malformed output', async () => {
    await fake('claude', `process.stdin.resume();process.stdin.on('end',()=>console.log('{"is_error":true}'));`);
    await expect(reviewWithClaude('review', {}, root, 5000)).rejects.toThrow(/complete/);
    await fake('claude', `process.stdin.resume();process.stdin.on('end',()=>console.log('truncated'));`);
    await expect(reviewWithClaude('review', {}, root, 5000)).rejects.toThrow();
  });
});
