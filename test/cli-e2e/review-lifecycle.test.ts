import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { runCLI } from '../helpers/run-cli.js';

describe('private development workflow', () => {
  let root: string;
  let project: string;
  let env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-lifecycle-'));
    project = path.join(root, 'project');
    const bin = path.join(root, 'bin');
    await fs.mkdir(bin, { recursive: true });
    await fs.mkdir(path.join(project, 'openspec/changes/example'), { recursive: true });
    await fs.mkdir(path.join(project, 'openspec/specs'), { recursive: true });
    env = { PATH: bin + path.delimiter + process.env.PATH, XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' };
    for (const name of ['codex', 'claude']) {
      const code = `#!${process.execPath}\nconst fs=require('fs');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const report={outcome:'passed',summary:'Independent fixture review',findings:[]};const args=process.argv.slice(2);if(args.includes('--output-last-message'))fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(report));else console.log(JSON.stringify({subtype:'success',structured_output:report}));});\n`;
      await fs.writeFile(path.join(bin, name), code, { mode: 0o755 });
    }
    const change = path.join(project, 'openspec/changes/example');
    await fs.writeFile(path.join(change, '.openspec.yaml'), 'schema: small-change\nskip_specs: true\n');
    await fs.writeFile(path.join(change, 'proposal.md'), '# Proposal\n\n## Why\nMake the help text clearer.\n\n## What Changes\nClarify help text.\n\n## Capabilities\n\n### New Capabilities\n\n### Modified Capabilities\n\n## Impact\nDocumentation only.\n');
    await fs.writeFile(path.join(change, 'tasks.md'), '## Work\n- [x] Clarify help\n');
    await fs.writeFile(path.join(project, 'app.txt'), 'help');
    execFileSync('git', ['init', '-q', project]);
    execFileSync('git', ['-C', project, 'add', '.']);
    execFileSync('git', ['-C', project, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base']);
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const cli = (args: string[]) => runCLI(args, { cwd: project, env });
  const review = (stage: string, harness = 'codex', extra: string[] = []) => cli(['review', stage, '--change', 'example', '--main-harness', harness, '--base', 'HEAD', '--json', ...extra]);
  it.each(['codex', 'claude'])('completes both independent review stages for %s, checks and archive', async harness => {
    const blocked = await cli(['archive', 'example', '--yes', '--json']);
    expect(blocked.exitCode, blocked.stdout).toBe(1);
    expect(await fs.stat(path.join(project, 'openspec/changes/example'))).toBeDefined();
    expect((await review('requirements', harness)).exitCode).toBe(0);
    expect((await review('ready-to-implement', harness)).exitCode).toBe(0);
    const verified = await review('verify', harness, ['--check', JSON.stringify([process.execPath, '-e', 'console.log("checked")'])]);
    expect(verified.exitCode, verified.stdout).toBe(0);
    const code = await review('code', harness);
    expect(code.exitCode, code.stdout).toBe(0);
    expect(JSON.parse(code.stdout).reviewer).toBe(harness === 'codex' ? 'claude' : 'codex');
    expect((await review('status', harness)).exitCode).toBe(1);
    expect((await review('decisions', harness)).exitCode).toBe(0);
    const ready = await review('status', harness);
    expect(ready.exitCode, ready.stdout).toBe(0);
    const archived = await cli(['archive', 'example', '--yes', '--json']);
    expect(archived.exitCode, archived.stdout).toBe(0);
    expect(await fs.readFile(path.join(project, 'openspec/decisions.md'), 'utf8')).toContain('Decisions');
  });
  it('rejects malformed verification commands and missing requirements review', async () => {
    expect((await review('ready-to-implement')).exitCode).toBe(1);
    expect((await review('code')).exitCode).toBe(1);
    expect((await review('verify', 'codex', ['--check', '{}'])).exitCode).toBe(1);
  });
  it('ignores the other-harness reviewer default for the mandatory reciprocal pair', async () => {
    await fs.writeFile(path.join(project, 'openspec/config.yaml'), 'schema: small-change\nreview:\n  reviewer: codex\n');
    const result = await review('requirements', 'codex');
    expect(result.exitCode, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout).reviewer).toBe('claude');
  });

});
