import { runProcess } from './process.js';

export async function reviewWithClaude(prompt: string, schema: object, cwd: string, timeoutMs: number): Promise<unknown> {
  const output = await runProcess('claude', ['--print', '--bare', '--no-session-persistence',
    '--permission-mode', 'dontAsk', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
    '--output-format', 'json', '--json-schema', JSON.stringify(schema)], cwd, prompt, timeoutMs);
  const envelope = JSON.parse(output);
  if (envelope.is_error || (envelope.subtype && envelope.subtype !== 'success')) throw new Error('Claude review did not complete successfully');
  return envelope.structured_output ?? JSON.parse(envelope.result);
}
