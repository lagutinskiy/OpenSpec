import { describe, it, expect } from 'vitest';
import { installManifest } from '../scripts/pack-local.mjs';

describe('private installable package', () => {
  it('retains runtime dependencies but omits all build and install lifecycle scripts', () => {
    const source = { name: '@private/openspec', dependencies: { yaml: '^2' }, devDependencies: { typescript: '^6' }, scripts: { prepare: 'node build.js', postinstall: 'something' } };
    expect(installManifest(source)).toEqual({ name: '@private/openspec', dependencies: { yaml: '^2' }, private: true });
    expect(source.scripts.prepare).toBe('node build.js');
  });
});
