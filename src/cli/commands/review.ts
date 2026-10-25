import { COMMON_FLAGS } from '../../core/completions/shared-flags.js';
import type { Command } from 'commander';

interface ReviewOptions {
  change: string; mainHarness?: string; reviewer?: string; base?: string;
  store?: string; implementationRoot?: string; json?: boolean; check?: string[];
}
export function registerReviewCommand(program: Command): void {
  program.command('review <stage>')
    .description('Review requirements or code; verify checks and archive readiness')
    .requiredOption('--change <name>', 'Change to review')
    .option('--main-harness <id>', 'Implementing harness (required)')
    .option('--reviewer <id>', 'Reviewer for harnesses other than Codex/Claude')
    .option('--base <revision>', 'Explicit Git base for code review and verification')
    .option('--store <id>', COMMON_FLAGS.store.description)
    .option('--implementation-root <path>', 'Repository containing implementation')
    .option('--json', 'Output as JSON')
    .option('--check <argv-json>', 'Verification command as a JSON argument array; repeatable', (value: string, previous: string[]) => [...previous, value], [])
    .action(async (stage: string, options: ReviewOptions) => {
      const { reviewCommand } = await import('../../commands/review.js');
      await reviewCommand(stage, options);
    });
}
