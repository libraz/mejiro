import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = join(packageRoot, 'src');

/** Every file under `src`, as a path relative to the package root. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(packageRoot, full));
  }
  return out;
}

const files = walk(srcRoot);
const sources = files.filter((f) => f.endsWith('.ts'));
const assets = files.filter((f) => !f.endsWith('.ts'));
const sourceText = sources.map((f) => readFileSync(join(packageRoot, f), 'utf8')).join('\n');
const exportedSubpaths = JSON.stringify(
  (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { exports: unknown })
    .exports,
);

describe('src assets', () => {
  // Rule tables that no source file reads are free to drift from the tables the
  // engine actually uses, and nothing catches the divergence. An asset earns its
  // place in `src` either by being imported or by being a published subpath.
  it('keeps no data file that neither a source file nor a package export reaches', () => {
    const orphans = assets.filter((asset) => {
      const name = asset.slice(asset.lastIndexOf('/') + 1);
      return !(sourceText.includes(name) || exportedSubpaths.includes(name));
    });
    expect(orphans).toEqual([]);
  });

  it('finds the assets it is meant to be checking', () => {
    // Guards the walk itself: the shipped stylesheets must show up as assets.
    expect(assets).toContain('src/render/mejiro.css');
    expect(assets.length).toBeGreaterThanOrEqual(5);
  });
});
