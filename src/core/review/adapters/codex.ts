import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from './process.js';

export async function reviewWithCodex(prompt: string, schema: object, cwd: string, timeoutMs: number): Promise<unknown> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-codex-review-'));
  try {
    const schemaFile = path.join(temp, 'schema.json');
    const outputFile = path.join(temp, 'result.json');
    await fs.writeFile(schemaFile, JSON.stringify(schema));
    await runProcess('codex', ['exec', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config',
      '--ignore-rules', '-c', 'project_doc_max_bytes=0', '--output-schema', schemaFile,
      '--output-last-message', outputFile, '-'], cwd, prompt, timeoutMs);
    return JSON.parse(await fs.readFile(outputFile, 'utf8'));
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
