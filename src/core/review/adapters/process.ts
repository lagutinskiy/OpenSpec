import type { spawn as NodeSpawn } from 'node:child_process';
import { createRequire } from 'node:module';
const spawn = createRequire(import.meta.url)('cross-spawn') as typeof NodeSpawn;

/** Bounded, cancellable execution shared by reviewers and verification. */
export function runProcess(command: string, args: string[], cwd: string, input: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error(`${command} cancelled`)); return; }
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    const terminate = () => {
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      } else child.kill('SIGKILL');
    };
    const cancel = () => { failure = new Error(`${command} cancelled`); terminate(); };
    const interrupt = () => { process.exitCode = 130; cancel(); };
    const stop = () => { process.exitCode = 143; cancel(); };
    signal?.addEventListener('abort', cancel, { once: true });
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', stop);
    const timer = setTimeout(() => { failure = new Error(`${command} timed out`); terminate(); }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', stop);
    };
    const collect = (chunk: Buffer, isError: boolean) => {
      if (isError) stderr += chunk.toString(); else stdout += chunk.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 4 * 1024 * 1024) {
        failure = new Error(`${command} output exceeds 4 MB`);
        terminate();
      }
    };
    child.stdout!.on('data', chunk => collect(chunk, false));
    child.stderr!.on('data', chunk => collect(chunk, true));
    child.stdin!.on('error', () => { /* Close/error reports the process failure. */ });
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', (code, processSignal) => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${command} failed (${processSignal ?? code}): ${(stderr || stdout).slice(-2000)}`));
      else resolve(stdout);
    });
    child.stdin!.end(input);
  });
}
