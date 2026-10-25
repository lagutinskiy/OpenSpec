import { describe, it, expect } from 'vitest';
import path from 'path';
import { claudeAdapter } from '../../../src/core/command-generation/adapters/claude.js';
import { continueAdapter } from '../../../src/core/command-generation/adapters/continue.js';
import { cursorAdapter } from '../../../src/core/command-generation/adapters/cursor.js';
import { devinAdapter } from '../../../src/core/command-generation/adapters/devin.js';
import { opencodeAdapter } from '../../../src/core/command-generation/adapters/opencode.js';
import { piAdapter } from '../../../src/core/command-generation/adapters/pi.js';
import { codeassistantAdapter } from '../../../src/core/command-generation/adapters/codeassistant.js';
import type {
  CommandContent,
  ToolCommandAdapter,
} from '../../../src/core/command-generation/types.js';
import { CommandAdapterRegistry } from '../../../src/core/command-generation/registry.js';
import { generateCommand } from '../../../src/core/command-generation/generator.js';
import { getCommandContents } from '../../../src/core/shared/skill-generation.js';
import { parse as parseYaml } from 'yaml';

describe('command-generation/adapters', () => {
  const sampleContent: CommandContent = {
    id: 'explore',
    name: 'OpenSpec Explore',
    description: 'Enter explore mode for thinking',
    category: 'Workflow',
    tags: ['workflow', 'explore', 'experimental'],
    body: 'This is the command body.\n\nWith multiple lines.',
  };

  describe('claudeAdapter', () => {
    it('should have correct toolId', () => {
      expect(claudeAdapter.toolId).toBe('claude');
    });

    it('should generate correct file path', () => {
      const filePath = claudeAdapter.getFilePath('explore');
      expect(filePath).toBe(path.join('.claude', 'commands', 'opsx', 'explore.md'));
    });

    it('should generate correct file path for different command IDs', () => {
      expect(claudeAdapter.getFilePath('new')).toBe(path.join('.claude', 'commands', 'opsx', 'new.md'));
      expect(claudeAdapter.getFilePath('bulk-archive')).toBe(path.join('.claude', 'commands', 'opsx', 'bulk-archive.md'));
    });

    it('should format file with correct YAML frontmatter', () => {
      const output = claudeAdapter.formatFile(sampleContent);

      expect(output).toContain('---\n');
      expect(output).toContain('name: "OpenSpec Explore"');
      expect(output).toContain('description: "Enter explore mode for thinking"');
      expect(output).toContain('allowed-tools: Bash(openspec:*)');
      expect(output).toContain('category: "Workflow"');
      expect(output).toContain('tags: ["workflow", "explore", "experimental"]');
      expect(output).toContain('---\n\n');
      expect(output).toContain('This is the command body.\n\nWith multiple lines.');
    });

    it('should handle empty tags', () => {
      const contentNoTags: CommandContent = { ...sampleContent, tags: [] };
      const output = claudeAdapter.formatFile(contentNoTags);
      expect(output).toContain('tags: []');
    });
  });

  describe('cursorAdapter', () => {
    it('should have correct toolId', () => {
      expect(cursorAdapter.toolId).toBe('cursor');
    });

    it('should generate correct file path with opsx- prefix', () => {
      const filePath = cursorAdapter.getFilePath('explore');
      expect(filePath).toBe(path.join('.cursor', 'commands', 'opsx-explore.md'));
    });

    it('should generate correct file paths for different commands', () => {
      expect(cursorAdapter.getFilePath('new')).toBe(path.join('.cursor', 'commands', 'opsx-new.md'));
      expect(cursorAdapter.getFilePath('bulk-archive')).toBe(path.join('.cursor', 'commands', 'opsx-bulk-archive.md'));
    });

    it('should format file with Cursor-specific frontmatter', () => {
      const output = cursorAdapter.formatFile(sampleContent);

      expect(output).toContain('---\n');
      expect(output).toContain('name: "/opsx-explore"');
      expect(output).toContain('id: "opsx-explore"');
      expect(output).toContain('category: "Workflow"');
      expect(output).toContain('description: "Enter explore mode for thinking"');
      expect(output).toContain('---\n\n');
      expect(output).toContain('This is the command body.');
    });

    it('should not include tags in Cursor format', () => {
      const output = cursorAdapter.formatFile(sampleContent);
      expect(output).not.toContain('tags:');
    });
  });

  describe('devinAdapter', () => {
    it('should have correct toolId', () => {
      expect(devinAdapter.toolId).toBe('devin');
    });

    it('should generate correct file path', () => {
      const filePath = devinAdapter.getFilePath('explore');
      expect(filePath).toBe(path.join('.devin', 'workflows', 'opsx-explore.md'));
    });

    it('should format file with YAML frontmatter', () => {
      const output = devinAdapter.formatFile(sampleContent);

      expect(output).toContain('---\n');
      expect(output).toContain('name: "OpenSpec Explore"');
      expect(output).toContain('description: "Enter explore mode for thinking"');
      expect(output).toContain('category: "Workflow"');
      expect(output).toContain('tags: ["workflow", "explore", "experimental"]');
      expect(output).toContain('---\n\n');
      expect(output).toContain('This is the command body.');
    });

    // The body's `/opsx:*` references are rewritten to the `/opsx-*` form
    // Devin registers by the generator, not here — adapters are pure
    // formatters. Covered for devin in invocation.test.ts.

    // Frontmatter escaping comes from the shared yaml.ts helpers and is
    // covered for every registered adapter by the round-trip matrix in
    // "YAML frontmatter escaping across adapters" below.

    it('should handle empty tags', () => {
      const contentNoTags: CommandContent = { ...sampleContent, tags: [] };
      const output = devinAdapter.formatFile(contentNoTags);
      expect(output).toContain('tags: []');
    });
  });

  describe('opencodeAdapter', () => {
    it('should have correct toolId', () => {
      expect(opencodeAdapter.toolId).toBe('opencode');
    });

    it('should generate correct file path', () => {
      const filePath = opencodeAdapter.getFilePath('explore');
      expect(filePath).toBe(path.join('.opencode', 'commands', 'opsx-explore.md'));
    });

    it('should format file with description frontmatter', () => {
      const output = opencodeAdapter.formatFile(sampleContent);
      expect(output).toContain('---\n');
      expect(output).toContain('description: "Enter explore mode for thinking"');
      expect(output).toContain('---\n\n');
      expect(output).toContain('This is the command body.');
    });

    it('should pass invocation arguments into the OpenSpec input contract', () => {
      const output = opencodeAdapter.formatFile({
        ...sampleContent,
        body: '# OpenSpec command\n\n**Input**: A change name or description.\n\nRun the workflow.',
      });
      expect(output).toContain(
        '**Input**: A change name or description.\n**Provided arguments**: $ARGUMENTS'
      );
    });

    it('should not duplicate an existing $ARGUMENTS placeholder', () => {
      const output = opencodeAdapter.formatFile({
        ...sampleContent,
        body: '**Input**: A change name.\nExisting input: $ARGUMENTS',
      });
      expect(output.match(/\$ARGUMENTS/g)).toHaveLength(1);
    });

    it('should not duplicate documented positional argument placeholders', () => {
      const output = opencodeAdapter.formatFile({
        ...sampleContent,
        body: '**Input**: Two values.\nFirst: $1\nSecond: $2',
      });
      expect(output).not.toContain('**Provided arguments**: $ARGUMENTS');
      expect(output).toContain('First: $1\nSecond: $2');
    });

    it('should keep multi-line input guidance together before provided arguments', () => {
      const output = opencodeAdapter.formatFile({
        ...sampleContent,
        body: '**Input**: A topic, such as:\n- an idea\n- a problem\n\n**Steps**\n1. Explore.',
      });
      expect(output).toContain(
        '**Input**: A topic, such as:\n- an idea\n- a problem\n**Provided arguments**: $ARGUMENTS'
      );
    });

    it('should preserve CRLF while keeping multi-line input guidance together', () => {
      const output = opencodeAdapter.formatFile({
        ...sampleContent,
        body: '**Input**: A topic, such as:\r\n- an idea\r\n- a problem\r\n\r\nRun it.',
      });
      expect(output).toContain(
        '**Input**: A topic, such as:\r\n- an idea\r\n- a problem\r\n**Provided arguments**: $ARGUMENTS\r\n\r\nRun it.'
      );
    });

    it('should not add invocation arguments to an explicitly input-free workflow', () => {
      const output = opencodeAdapter.formatFile({
        ...sampleContent,
        body: '**Input**: None required (prompts for selection)\n\nPrompt the user.',
      });
      expect(output).not.toContain('$ARGUMENTS');
    });

    it('should preserve exactly one argument placeholder for each workflow that accepts input', () => {
      for (const content of getCommandContents()) {
        const output = generateCommand(content, opencodeAdapter).fileContent;
        const acceptsInput = /^\*\*Input\*\*:(?!\s*None required\b)/im.test(content.body);
        expect(output.match(/\$ARGUMENTS/g) ?? [], content.id).toHaveLength(acceptsInput ? 1 : 0);
      }
    });

    it('is generated by generateCommand with hyphen command references', () => {
      const contentWithCommands: CommandContent = {
        ...sampleContent,
        body: 'Use /opsx:new to start, then /opsx:apply to implement.',
      };
      const output = generateCommand(contentWithCommands, opencodeAdapter).fileContent;
      expect(output).toContain('/opsx-new');
      expect(output).toContain('/opsx-apply');
      expect(output).not.toContain('/opsx:new');
      expect(output).not.toContain('/opsx:apply');
    });

    it('is generated by generateCommand with every reference hyphenated', () => {
      const contentWithMultipleCommands: CommandContent = {
        ...sampleContent,
        body: `/opsx:explore for ideas
/opsx:new to create
/opsx:continue to proceed
/opsx:apply to implement`,
      };
      const output = generateCommand(contentWithMultipleCommands, opencodeAdapter).fileContent;
      expect(output).toContain('/opsx-explore');
      expect(output).toContain('/opsx-new');
      expect(output).toContain('/opsx-continue');
      expect(output).toContain('/opsx-apply');
    });
  });

  describe('piAdapter', () => {
    it('should have correct toolId', () => {
      expect(piAdapter.toolId).toBe('pi');
    });

    it('should generate correct file path', () => {
      const filePath = piAdapter.getFilePath('explore');
      expect(filePath).toBe(path.join('.pi', 'prompts', 'opsx-explore.md'));
    });

    it('should generate correct file paths for different commands', () => {
      expect(piAdapter.getFilePath('new')).toBe(path.join('.pi', 'prompts', 'opsx-new.md'));
      expect(piAdapter.getFilePath('bulk-archive')).toBe(path.join('.pi', 'prompts', 'opsx-bulk-archive.md'));
    });

    it('should format file with description frontmatter', () => {
      const output = piAdapter.formatFile(sampleContent);
      expect(output).toContain('---\n');
      expect(output).toContain('description: "Enter explore mode for thinking"');
      expect(output).toContain('---\n\n');
      expect(output).toContain('This is the command body.');
    });

    it('is generated by generateCommand with hyphen command references', () => {
      const contentWithRefs: CommandContent = {
        ...sampleContent,
        body: 'Run /opsx:apply to implement. Then /opsx:archive when done.',
      };

      const output = generateCommand(contentWithRefs, piAdapter).fileContent;
      expect(output).toContain('/opsx-apply');
      expect(output).toContain('/opsx-archive');
      expect(output).not.toContain('/opsx:apply');
    });

    it('should inject template arguments into the input section', () => {
      const contentWithInput: CommandContent = {
        ...sampleContent,
        body: '**Input**: The argument after `/opsx:explore` is the topic.\n\n**Steps**\n1. Think.',
      };

      const output = piAdapter.formatFile(contentWithInput);
      expect(output).toContain('**Provided arguments**: $@');
    });

    it('should escape YAML special characters in description', () => {
      const contentWithSpecialChars: CommandContent = {
        ...sampleContent,
        description: 'Fix: regression in "auth" feature',
      };
      const output = piAdapter.formatFile(contentWithSpecialChars);
      expect(output).toContain('description: "Fix: regression in \\"auth\\" feature"');
    });

    it('should escape newlines in description', () => {
      const contentWithNewline: CommandContent = {
        ...sampleContent,
        description: 'Line 1\nLine 2',
      };
      const output = piAdapter.formatFile(contentWithNewline);
      expect(output).toContain('description: "Line 1\\nLine 2"');
    });
  });

  describe('cross-platform path handling', () => {
    it('Claude adapter uses path.join for paths', () => {
      // path.join handles platform-specific separators
      const filePath = claudeAdapter.getFilePath('test');
      // On any platform, path.join returns the correct separator
      expect(filePath.split(path.sep)).toEqual(['.claude', 'commands', 'opsx', 'test.md']);
    });

    it('Cursor adapter uses path.join for paths', () => {
      const filePath = cursorAdapter.getFilePath('test');
      expect(filePath.split(path.sep)).toEqual(['.cursor', 'commands', 'opsx-test.md']);
    });

    it('Devin adapter uses path.join for paths', () => {
      const filePath = devinAdapter.getFilePath('test');
      expect(filePath.split(path.sep)).toEqual(['.devin', 'workflows', 'opsx-test.md']);
    });
  });

  describe('YAML frontmatter escaping across adapters', () => {
    // Derived from the registry, not hand-listed: a newly registered adapter
    // must be covered by default. Adding one that emits no YAML frontmatter is
    // then a deliberate act of adding it here.
    const NON_YAML_ADAPTERS: string[] = [];
    const yamlAdapters = CommandAdapterRegistry.getAll().filter(
      (adapter) => !NON_YAML_ADAPTERS.includes(adapter.toolId)
    );

    /**
     * Builds a CommandContent whose every string field carries `marker`.
     */
    function contentWith(marker: string): CommandContent {
      return {
        id: 'explore',
        name: marker,
        description: marker,
        category: marker,
        tags: [marker, 'explore'],
        body: 'Body text',
      };
    }

    /**
     * Returns the frontmatter fields this adapter fills from CommandContent,
     * found by rendering two different markers and keeping the fields that
     * change. Fields derived from the command id (Cursor's `name`/`id`) or
     * emitted as constants stay put and are excluded.
     */
    function contentDerivedFields(adapter: ToolCommandAdapter): string[] {
      const render = (marker: string): Record<string, unknown> => {
        const match = adapter.formatFile(contentWith(marker)).match(/^---\n([\s\S]*?)\n---/);
        return (parseYaml(match![1]) ?? {}) as Record<string, unknown>;
      };
      // Deliberately different in length and shape. Two same-shaped markers
      // would render identically for a field derived via length or a slice,
      // and such a field would then be silently dropped from every assertion.
      const left = render('AAA');
      const right = render('zz-BBB-9-longer');
      return Object.keys(left).filter(
        (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])
      );
    }

    it('covers every registered YAML adapter', () => {
      const baseline = contentWith('Baseline');
      expect(yamlAdapters.length).toBeGreaterThan(0);
      for (const adapter of yamlAdapters) {
        expect(adapter.formatFile(baseline), adapter.toolId).toMatch(/^---\n/);
      }
      for (const toolId of NON_YAML_ADAPTERS) {
        const adapter = CommandAdapterRegistry.get(toolId);
        expect(adapter, `${toolId} is excluded but not registered`).toBeDefined();
        expect(adapter!.formatFile(baseline), toolId).not.toMatch(/^---\n/);
      }
    });

    const roundTripCases: Array<[string, string]> = [
      ['plain text', 'Enter explore mode for thinking'],
      ['empty string', ''],
      ['colon and quotes', 'Explore mode: "thinking" & planning (e.g. feature: dark-mode)'],
      ['block literal |', '|'],
      ['block literal |-', '|-'],
      ['block literal |+', '|+'],
      ['block folded >', '>'],
      ['block folded >-', '>-'],
      ['block folded >+', '>+'],
      ['block with text', '| block text'],
      ['folded with text', '> folded text'],
      ['boolean true', 'true'],
      ['boolean false', 'false'],
      ['boolean yes', 'yes'],
      ['boolean no', 'no'],
      ['boolean on', 'on'],
      ['boolean off', 'off'],
      ['null string', 'null'],
      ['tilde null', '~'],
      ['integer', '123'],
      ['zero', '0'],
      ['negative int', '-10'],
      ['float', '1.23'],
      ['scientific notation', '1e5'],
      ['hex integer', '0x12'],
      ['octal integer', '077'],
      ['binary integer', '0b101'],
      ['infinity', '.inf'],
      ['nan', '.nan'],
      ['special characters', '# comment: [a, b] {c: d} - item ? key *ref &anc !tag @at `cmd`'],
      ['leading space', ' leading'],
      ['trailing space', 'trailing '],
      ['multiple spaces', '   '],
      // Without these the matrix drives no control character at all, so the
      // escaping this suite exists to prove gets no adapter-level coverage —
      // and the raw-CR assertion below can never fail.
      ['carriage return', 'line 1\rline 2'],
      ['line feed', 'line 1\nline 2'],
      ['nul', 'a\x00b'],
      ['escape', 'ansi\x1b[0m'],
      ['delete', 'a\x7fb'],
      ['next line', 'a\x85b'],
    ];

    for (const adapter of yamlAdapters) {
      describe(`${adapter.toolId} adapter table-driven round-trip`, () => {
        for (const [label, testVal] of roundTripCases) {
          it(`preserves every string field and its type for ${label}`, () => {
            // Every string field carries the hostile value, not just
            // description: a field an adapter forgot to escape is only caught
            // if the matrix actually drives that field.
            const content: CommandContent = {
              id: 'explore',
              name: testVal,
              description: testVal,
              category: testVal,
              tags: [testVal, 'explore'],
              body: 'Body text',
            };

            const fileContent = adapter.formatFile(content);
            const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---/);
            expect(frontmatterMatch).not.toBeNull();
            const frontmatter = frontmatterMatch![1];

            // A raw CR survives the parser but corrupts the file for anything
            // that splits on lines, so round-tripping alone would not catch it.
            expect(frontmatter, 'raw carriage return in frontmatter').not.toContain('\r');

            let parsed: Record<string, unknown> | undefined;
            expect(() => {
              parsed = parseYaml(frontmatter);
            }).not.toThrow();

            // Adapters emit different field subsets, and some derive name/id
            // from the command id rather than from the content. Identify the
            // content-derived fields by rendering a second time with a
            // different value and seeing which outputs move — a field that is
            // constant across both renders never carried our input, so it has
            // nothing to round-trip. This must not be softened into "skip the
            // field if it doesn't look like our value": a broken escape mangles
            // the value, and skipping on mismatch would skip the very bug.
            const contentFields = contentDerivedFields(adapter);
            expect(contentFields.length, `${adapter.toolId} emits no content fields`)
              .toBeGreaterThan(0);

            for (const field of contentFields) {
              if (field === 'tags') {
                expect(parsed!.tags, `${adapter.toolId}.tags`).toEqual([testVal, 'explore']);
                continue;
              }
              expect(parsed![field], `${adapter.toolId}.${field}`).toBe(testVal);
              expect(typeof parsed![field], `${adapter.toolId}.${field} type`).toBe('string');
            }
          });
        }
      });
    }
  });
});
