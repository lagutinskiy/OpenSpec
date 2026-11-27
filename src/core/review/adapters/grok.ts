import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from './process.js';
import type { ReviewerSettings } from '../types.js';

// Headless inspect-only review: read-only sandbox, no plan/subagents/web/memory,
// dontAsk so permission prompts cannot hang the CLI. Prompt goes through a file
// because OpenSpec review contexts routinely exceed argv limits.
export async function reviewWithGrok(prompt: string, schema: object, cwd: string, timeoutMs: number, settings: ReviewerSettings = {}): Promise<unknown> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-grok-review-'));
  try {
    const promptFile = path.join(temp, 'prompt.txt');
    await fs.writeFile(promptFile, prompt);
    const output = await runProcess('grok', [
      '--prompt-file', promptFile,
      '--json-schema', JSON.stringify(withoutDialect(schema)),
      '--output-format', 'json',
      '--permission-mode', 'dontAsk',
      '--tools', 'Read,Glob,Grep',
      '--sandbox', 'read-only',
      '--no-plan', '--no-subagents', '--no-memory', '--disable-web-search', '--no-auto-update',
      ...(settings.model ? ['-m', settings.model] : []),
      ...(settings.effort ? ['--effort', settings.effort] : []),
    ], cwd, '', timeoutMs);
    return extractReport(output);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

function extractReport(output: string): unknown {
  const envelope = JSON.parse(output.trim());
  if (envelope?.type === 'error' || envelope?.is_error) {
    const detail = [envelope.message, envelope.result, ...(Array.isArray(envelope.errors) ? envelope.errors : [])]
      .filter(item => item !== undefined && item !== null && item !== '')
      .map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('; ').slice(0, 2000);
    throw new Error(`Grok review did not complete successfully${detail ? `: ${detail}` : ''}`);
  }
  if (isReportShape(envelope)) return envelope;
  // Headless --json-schema stamps the constrained object as structuredOutput.
  if (envelope?.structuredOutput !== undefined) return envelope.structuredOutput;
  if (envelope?.structured_output !== undefined) return envelope.structured_output;
  if (typeof envelope?.text === 'string') {
    const text = stripFence(envelope.text.trim());
    try { return JSON.parse(text); }
    catch {
      const extracted = extractFirstJsonObject(text);
      if (extracted !== undefined) return extracted;
      throw new Error('Grok review returned non-JSON text');
    }
  }
  throw new Error('Grok review returned no structured report');
}

function extractFirstJsonObject(text: string): unknown | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  for (let end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
    try { return JSON.parse(text.slice(start, end + 1)); }
    catch { /* keep shrinking trailing prose */ }
  }
  return undefined;
}

function isReportShape(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'outcome' in value && 'summary' in value && 'findings' in value;
}

function stripFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text;
}

// Match Claude: drop Zod's draft 2020-12 $schema declaration when the reviewer
// schema validator is dialect-sensitive. Leaving the caller's object intact.
function withoutDialect(schema: object): object {
  const { $schema: _dialect, ...rest } = schema as Record<string, unknown>;
  return rest;
}
