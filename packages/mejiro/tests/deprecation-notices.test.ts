import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManuscript, parseManuscriptRuby } from '../src/manuscript.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

/**
 * Source trees whose `@deprecated` notices are checked for stale removal
 * versions. Every published package is scanned rather than an opt-in file list,
 * so a stale notice cannot hide in a module nobody remembered to enrol.
 */
const guardedSourceRoots = [
  'packages/mejiro/src',
  'packages/mejiro-react/src',
  'packages/mejiro-vue/src',
];

/** Returns every `.ts`/`.tsx` file under a directory, recursively. */
async function collectSources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSources(path)));
    else if (/\.tsx?$/u.test(entry.name)) files.push(path);
  }
  return files;
}

/** Matches a removal promise such as `will be removed in v0.6`. */
const REMOVAL_PROMISE = /remov(?:ed?|al)\s+in\s+(?:version\s+)?v?(\d+)\.(\d+)(?:\.(\d+))?/giu;

/** Parses `major.minor.patch` into a comparable tuple. */
function toVersionTuple(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return [major, minor, patch];
}

/** Returns every removal version promised by `@deprecated` notices in a source text. */
function promisedRemovalVersions(source: string): string[] {
  const versions: string[] = [];
  for (const block of source.matchAll(/\/\*\*[\s\S]*?\*\//gu)) {
    if (!block[0].includes('@deprecated')) continue;
    for (const match of block[0].matchAll(REMOVAL_PROMISE)) {
      versions.push(`${match[1]}.${match[2]}.${match[3] ?? 0}`);
    }
  }
  return versions;
}

describe('deprecation notices', () => {
  it('detects a removal version promised by a deprecation notice', () => {
    const source = [
      '/**',
      ' * Old helper.',
      ' *',
      ' * @deprecated Use the new helper; this will be removed in v0.6.',
      ' */',
      '/** @deprecated Superseded; removal in version 1.2.3. */',
      '/** Not deprecated, mentions removal in v0.7. */',
    ].join('\n');
    expect(promisedRemovalVersions(source)).toEqual(['0.6.0', '1.2.3']);
  });

  it('accepts an open-ended deprecation notice as promising nothing', () => {
    const source = [
      '/**',
      ' * @deprecated Removal of this alias is deferred to a future major',
      ' * release; no removal version is scheduled.',
      ' */',
    ].join('\n');
    expect(promisedRemovalVersions(source)).toEqual([]);
  });

  it('promises no removal version that the package has already shipped', async () => {
    const pkg = JSON.parse(
      await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as { version: string };
    const current = toVersionTuple(pkg.version);

    const sources: string[] = [];
    for (const root of guardedSourceRoots)
      sources.push(...(await collectSources(resolve(repoRoot, root))));
    expect(sources.length).toBeGreaterThan(50);

    for (const path of sources) {
      const source = await readFile(path, 'utf8');
      for (const version of promisedRemovalVersions(source)) {
        const promised = toVersionTuple(version);
        expect(
          promised[0] > current[0] ||
            (promised[0] === current[0] &&
              (promised[1] > current[1] ||
                (promised[1] === current[1] && promised[2] > current[2]))),
          `${relative(repoRoot, path)} promises removal in v${version}, but the package is already at v${pkg.version}`,
        ).toBe(true);
      }
    }
  });

  it('scans every published package source tree', async () => {
    const scanned = new Set<string>();
    for (const root of guardedSourceRoots) {
      for (const path of await collectSources(resolve(repoRoot, root))) {
        scanned.add(relative(repoRoot, path));
      }
    }
    // Modules that carried a stale `v0.6` promise and must stay in scope.
    for (const path of [
      'packages/mejiro/src/manuscript.ts',
      'packages/mejiro/src/browser/types.ts',
      'packages/mejiro/src/epub/types.ts',
    ]) {
      expect(scanned.has(path), `${path} is outside the deprecation scan`).toBe(true);
    }
  });

  it('keeps the ruby-only manuscript parser equivalent to the narou dialect', () => {
    const text = 'これは｜漢字《かんじ》です。*強調* も〔20〕もある。';
    expect(parseManuscriptRuby(text)).toEqual({
      text: parseManuscript(text, { dialect: 'narou' }).text,
      inlineAnnotations: parseManuscript(text, { dialect: 'narou' }).inlineAnnotations.filter(
        (ann) => ann.kind === 'ruby',
      ),
    });
  });
});
