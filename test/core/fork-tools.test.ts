import { describe, it, expect } from 'vitest';
import { AI_TOOLS, resolveToolIdAlias } from '../../src/core/config.js';
import { CommandAdapterRegistry } from '../../src/core/command-generation/registry.js';

describe('fork harness selection', () => {
  it('offers only the supported harnesses', () => {
    expect(AI_TOOLS.map(tool => tool.value).sort()).toEqual([
      'claude', 'codex', 'cursor', 'devin', 'dsh', 'grok', 'opencode', 'pi', 'warp',
    ]);
  });
  it('generates commands only for retained command-capable tools', () => {
    expect(CommandAdapterRegistry.getAll().map(adapter => adapter.toolId).sort())
      .toEqual(['claude', 'cursor', 'devin', 'opencode', 'pi']);
    expect(CommandAdapterRegistry.get('gemini')).toBeUndefined();
    expect(resolveToolIdAlias('windsurf')).toBe('devin');
  });
});
