import { runProcess } from './process.js';
import type { ReviewerSettings } from '../types.js';

export async function reviewWithClaude(prompt: string, schema: object, cwd: string, timeoutMs: number, settings: ReviewerSettings = {}): Promise<unknown> {
  const output = await runProcess('claude', ['--print', '--bare', '--no-session-persistence',
    '--permission-mode', 'dontAsk', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
    '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    ...(settings.model ? ['--model', settings.model] : []), ...(settings.effort ? ['--effort', settings.effort] : [])], cwd, prompt, timeoutMs);
  const envelope = JSON.parse(output);
  if (envelope.is_error || (envelope.subtype && envelope.subtype !== 'success')) {
    // Keep the reviewer's diagnostic (for example an unavailable model) for the blocked report.
    const detail = [envelope.result, ...(Array.isArray(envelope.errors) ? envelope.errors : [])]
      .filter(item => item !== undefined && item !== null && item !== '')
      .map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('; ').slice(0, 2000);
    throw new Error(`Claude review did not complete successfully${detail ? `: ${detail}` : ''}`);
  }
  return envelope.structured_output ?? JSON.parse(envelope.result);
}
