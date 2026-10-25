import { describe, it, expect } from 'vitest';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/registry.js';
import { resolveCommandSurfaceCapability } from '../../../src/core/command-surface.js';

describe('command-generation/registry', () => {
  describe('get', () => {
    it('should return Claude adapter for "claude"', () => {
      const adapter = CommandAdapterRegistry.get('claude');
      expect(adapter).toBeDefined();
      expect(adapter?.toolId).toBe('claude');
    });

    it('should return Cursor adapter for "cursor"', () => {
      const adapter = CommandAdapterRegistry.get('cursor');
      expect(adapter).toBeDefined();
      expect(adapter?.toolId).toBe('cursor');
    });

    it('should return the Devin adapter for "devin", the id Windsurf became', () => {
      const adapter = CommandAdapterRegistry.get('devin');
      expect(adapter).toBeDefined();
      expect(adapter?.toolId).toBe('devin');
    });

    it('should return Devin adapter for "devin"', () => {
      const adapter = CommandAdapterRegistry.get('devin');
      expect(adapter).toBeDefined();
      expect(adapter?.toolId).toBe('devin');
    });

    it('should return undefined for unregistered tool', () => {
      const adapter = CommandAdapterRegistry.get('unknown-tool');
      expect(adapter).toBeUndefined();
    });

    it('should return undefined for Codex', () => {
      const adapter = CommandAdapterRegistry.get('codex');
      expect(adapter).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const adapter = CommandAdapterRegistry.get('');
      expect(adapter).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return array of all registered adapters', () => {
      const adapters = CommandAdapterRegistry.getAll();
      expect(Array.isArray(adapters)).toBe(true);
      expect(adapters.length).toBeGreaterThanOrEqual(3); // At least Claude, Cursor, Devin
    });

    it('should include Claude, Cursor, and Devin adapters', () => {
      const adapters = CommandAdapterRegistry.getAll();
      const toolIds = adapters.map((a) => a.toolId);

      expect(toolIds).toContain('claude');
      expect(toolIds).toContain('cursor');
      expect(toolIds).toContain('devin');
      expect(toolIds).not.toContain('codex');
    });
  });

  describe('has', () => {

    it('should return false for unregistered tools', () => {
      expect(CommandAdapterRegistry.has('unknown')).toBe(false);
      expect(CommandAdapterRegistry.has('')).toBe(false);
    });
  });

  describe('adapter functionality', () => {
    it('registered adapters should have working getFilePath', () => {
      const claudeAdapter = CommandAdapterRegistry.get('claude');
      const cursorAdapter = CommandAdapterRegistry.get('cursor');
      const devinAdapter = CommandAdapterRegistry.get('devin');

      expect(claudeAdapter?.getFilePath('test')).toContain('.claude');
      expect(cursorAdapter?.getFilePath('test')).toContain('.cursor');
      expect(devinAdapter?.getFilePath('test')).toContain('.devin');
    });
  });

  describe('command surface capabilities', () => {
    it('resolves Codex as skills-invocable without an adapter', () => {
      expect(resolveCommandSurfaceCapability('codex')).toBe('skills-invocable');
      expect(CommandAdapterRegistry.get('codex')).toBeUndefined();
    });
  });
});
