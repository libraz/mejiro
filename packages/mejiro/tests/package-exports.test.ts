import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as renderBarrel from '../src/render/index.js';
import { paragraphClassName } from '../src/render/static.js';

const packages = ['mejiro', 'mejiro-react', 'mejiro-vue'];

const repoRoot = resolve(import.meta.dirname, '../../..');

/**
 * Resolves specifiers through Node's own `exports` algorithm, out of process so
 * the bundler aliases this suite runs under cannot answer instead. Resolution
 * does not touch the filesystem, so the answer does not depend on a prior build.
 */
function resolveThroughNode(specifiers: readonly string[]): (string | null)[] {
  const script = `
    const out = [];
    for (const specifier of ${JSON.stringify(specifiers)}) {
      try {
        out.push(import.meta.resolve(specifier));
      } catch {
        out.push(null);
      }
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return JSON.parse(stdout) as (string | null)[];
}

describe('package exports', () => {
  it('exports package.json from all published packages', async () => {
    for (const pkg of packages) {
      const raw = await readFile(resolve(import.meta.dirname, `../../${pkg}/package.json`), 'utf8');
      const json = JSON.parse(raw) as { exports?: Record<string, unknown> };
      expect(json.exports?.['./package.json']).toBe('./package.json');
    }
  });

  it('resolves every published subpath through the real exports map', async () => {
    for (const pkg of packages) {
      const raw = await readFile(resolve(import.meta.dirname, `../../${pkg}/package.json`), 'utf8');
      const json = JSON.parse(raw) as { name: string; exports: Record<string, unknown> };
      const subpaths = Object.keys(json.exports).map((key) =>
        key === '.' ? json.name : `${json.name}/${key.slice(2)}`,
      );

      expect(subpaths.length, pkg).toBeGreaterThan(1);
      const resolved = resolveThroughNode(subpaths);
      for (const [i, url] of resolved.entries()) {
        expect(url, `${subpaths[i]} is not resolvable through the exports map`).not.toBeNull();
        expect(url, subpaths[i]).toContain(`/packages/${pkg}/`);
      }
    }
  });

  it('keeps unlisted subpaths out of the public surface', () => {
    const [internal, deepDist] = resolveThroughNode([
      '@libraz/mejiro/src/index.js',
      '@libraz/mejiro/dist/epub/parser.js',
    ]);

    expect(internal).toBeNull();
    expect(deepDist).toBeNull();
  });

  it('reaches paragraphClassName through the render entry point', () => {
    expect(renderBarrel.paragraphClassName).toBe(paragraphClassName);
    expect(renderBarrel.paragraphClassName('blockquote')).toBe(
      'mejiro-paragraph mejiro-paragraph--blockquote',
    );
  });
});
