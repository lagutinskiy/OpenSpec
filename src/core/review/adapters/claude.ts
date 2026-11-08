import { runProcess } from './process.js';
import type { ReviewerSettings } from '../types.js';

// --safe-mode, not --bare: --bare authenticates only with ANTHROPIC_API_KEY or an
// apiKeyHelper and never reads the user's login, so a subscription user's reviewer
// cannot run. Safe mode keeps the login and disables CLAUDE.md, hooks, plugins,
// skills and MCP servers; the flags after it pin settings, MCP and tools as well.
export async function reviewWithClaude(prompt: string, schema: object, cwd: string, timeoutMs: number, settings: ReviewerSettings = {}): Promise<unknown> {
  const output = await runProcess('claude', ['--print', '--safe-mode', '--no-session-persistence',
    '--permission-mode', 'dontAsk', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
    '--output-format', 'json', '--json-schema', JSON.stringify(withoutDialect(schema)),
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

// Claude Code's --json-schema validator cannot resolve the draft 2020-12 meta-schema
// that z.toJSONSchema declares, and refuses the schema outright. The keywords a
// review report uses mean the same under the validator's default dialect, so the
// declaration is dropped rather than translated. The caller's object is unchanged.
function withoutDialect(schema: object): object {
  const { $schema: _dialect, ...rest } = schema as Record<string, unknown>;
  return rest;
}
