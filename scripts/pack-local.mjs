#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const spawn = createRequire(import.meta.url)('cross-spawn');

export function installManifest(source) {
  const { scripts, devDependencies, ...manifest } = source;
  return { ...manifest, private: true };
}
async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = path.resolve(process.argv[2] ?? path.join(root, 'artifacts'));
  const run = (executable, args, cwd) => {
    const result = spawn.sync(executable, args, { cwd, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${executable} exited with ${result.status}`);
  };
  run(process.execPath, ['build.js'], root);
  await fs.mkdir(output, { recursive: true });
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-pack-'));
  try {
    for (const name of ['dist', 'bin', 'schemas', 'LICENSE', 'README.md']) {
      await fs.cp(path.join(root, name), path.join(stage, name), { recursive: true });
    }
    const source = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(installManifest(source), null, 2) + '\n');
    run('npm', ['pack', '--ignore-scripts', '--pack-destination', output], stage);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
