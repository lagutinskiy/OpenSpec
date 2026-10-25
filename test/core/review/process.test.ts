import { describe, it, expect } from 'vitest';
import { runProcess } from '../../../src/core/review/adapters/process.js';

describe('bounded reviewer process', () => {
  it('passes literal arguments without evaluating shell syntax', async () => {
    expect(await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', '$(echo unsafe);`pwd`'], process.cwd(), '', 5000)).toBe('$(echo unsafe);`pwd`');
  });
  it('fails closed on missing executable, nonzero exit, and timeout', async () => {
    await expect(runProcess('openspec-missing-reviewer-command', [], process.cwd(), '', 5000)).rejects.toThrow();
    await expect(runProcess(process.execPath, ['-e', 'process.stderr.write("authentication required");process.exit(2)'], process.cwd(), '', 5000)).rejects.toThrow(/authentication/);
    await expect(runProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], process.cwd(), '', 20)).rejects.toThrow(/timed out/);
  });
});

describe('review cancellation', () => {
  it('terminates a cancelled process instead of waiting for timeout', async () => {
    const controller = new AbortController();
    const result = runProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], process.cwd(), '', 5000, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow(/cancelled/);
  });
});
