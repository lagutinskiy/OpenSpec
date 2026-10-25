import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const projectRoot = process.cwd();

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function readYaml(relativePath: string): Record<string, any> {
  return parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

describe('pnpm workspace configuration', () => {
  it('keeps root build approval aligned and security overrides single-sourced', () => {
    const packageJson = readJson('package.json');
    const lockfile = readYaml('pnpm-lock.yaml');
    const workspace = readYaml('pnpm-workspace.yaml');
    const esbuildVersions = Object.keys(lockfile.packages)
      .filter((key) => key.startsWith('esbuild@'))
      .map((key) => key.slice('esbuild@'.length));

    expect(workspace.packages).toEqual(['.']);
    expect(esbuildVersions).toHaveLength(1);
    expect(workspace.allowBuilds).toEqual({
      [`esbuild@${esbuildVersions[0]}`]: true,
    });
    // Overrides are declared once, in pnpm-workspace.yaml. A `pnpm.overrides` block
    // in package.json replaces that list rather than merging with it, so keeping the
    // whole `pnpm` block here ensures the lockfile and workspace stay aligned.
    expect(packageJson.pnpm).toBeUndefined();
    expect(workspace.overrides).toEqual(lockfile.overrides);
  });

});
