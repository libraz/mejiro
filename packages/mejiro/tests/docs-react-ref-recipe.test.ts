/**
 * Type-checks the `pendingRestore` recipe printed in
 * `docs/{en,ja}/08-react-and-vue.md` against the lower end of the declared
 * `@types/react` peer range.
 *
 * `@types/react@18` models `RefObject.current` as read-only while `@types/react@19`
 * makes it writable, so a `RefObject` declaration compiles for a v19 host and
 * fails for a v18 one. The repository installs v19 only, and `tsc -b` covers
 * `src` alone, so neither `yarn typecheck` nor a `expectTypeOf` assertion inside
 * a test file would notice the regression. This test reproduces the v18 shape
 * with a hand-written module declaration in a throwaway directory and asserts
 * that assigning to `pendingRestore.current` is not rejected.
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../../..');

/**
 * The `@types/react@18` shape of the two ref types plus the hooks the layout
 * hooks call. Placed in a `node_modules/react` of its own so it wins module
 * resolution over the v19 types the repository installs.
 */
const REACT_18_TYPES = `
export interface RefObject<T> { readonly current: T | null }
export interface MutableRefObject<T> { current: T }
export function useRef<T>(initialValue: T): MutableRefObject<T>;
export function useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
export function useCallback<T extends Function>(fn: T, deps: readonly unknown[]): T;
export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
`;

/** Stands in for the core subpaths; only the react typings are under test. */
const CORE_STUB = `
export type InChapterAnchor = any;
export type ChapterLayout = any;
export type ComputePageSizeOptions = any;
export type ManuscriptChapter = any;
export type MejiroBook = any;
export type EpubBook = any;
export type ManuscriptDialect = any;
`;

/** Hooks that expose a writable `pendingRestore` ref, and their return types. */
const hooks = [
  { file: 'useChapterLayout.ts', type: 'UseChapterLayoutReturn' },
  { file: 'useManuscriptLayout.ts', type: 'UseManuscriptLayoutReturn' },
];

describe('pendingRestore recipe under @types/react@18', () => {
  it('accepts assignment to pendingRestore.current', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mejiro-react18-'));
    await mkdir(resolve(root, 'node_modules/react'), { recursive: true });
    await writeFile(resolve(root, 'node_modules/react/index.d.ts'), REACT_18_TYPES);
    await writeFile(
      resolve(root, 'node_modules/react/package.json'),
      `${JSON.stringify({ name: 'react', version: '18.0.0', types: 'index.d.ts' }, null, 2)}\n`,
    );
    await writeFile(resolve(root, 'core-stub.d.ts'), CORE_STUB);

    await mkdir(resolve(root, 'src'), { recursive: true });
    for (const hook of hooks) {
      await copyFile(
        resolve(repoRoot, 'packages/mejiro-react/src', hook.file),
        resolve(root, 'src', hook.file),
      );
    }

    await writeFile(
      resolve(root, 'probe.ts'),
      [
        ...hooks.map(
          (hook) =>
            `import type { ${hook.type} } from './src/${hook.file.replace(/\.ts$/u, '.js')}';`,
        ),
        ...hooks.map((hook, index) => `declare const value${index}: ${hook.type};`),
        // The recipe documented in docs/{en,ja}/08-react-and-vue.md.
        ...hooks.map((_, index) => `value${index}.pendingRestore.current = null;`),
        '',
      ].join('\n'),
    );

    await writeFile(
      resolve(root, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ES2022',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            lib: ['ES2022', 'DOM'],
            types: [],
            paths: {
              '@libraz/mejiro': ['./core-stub.d.ts'],
              '@libraz/mejiro/*': ['./core-stub.d.ts'],
            },
          },
          files: ['probe.ts'],
        },
        null,
        2,
      )}\n`,
    );

    const tsc = resolve(repoRoot, 'node_modules/.bin/tsc');
    let output = '';
    try {
      const result = await run(tsc, ['--noEmit', '-p', resolve(root, 'tsconfig.json')]);
      output = result.stdout;
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? error);
    }

    // Only the read-only-ref diagnostic is fatal: unrelated diagnostics can come
    // from the deliberately loose stubs above and say nothing about the recipe.
    const readOnly = output
      .split('\n')
      .filter((line) => line.includes('TS2540') || line.includes('read-only property'));
    expect(readOnly, `pendingRestore is read-only under @types/react@18:\n${output}`).toEqual([]);
  }, 60_000);

  it('rejects the recipe when the ref is declared read-only', async () => {
    // Mutation control: proves the probe above would catch a RefObject regression.
    const root = await mkdtemp(resolve(tmpdir(), 'mejiro-react18-control-'));
    await mkdir(resolve(root, 'node_modules/react'), { recursive: true });
    await writeFile(resolve(root, 'node_modules/react/index.d.ts'), REACT_18_TYPES);
    await writeFile(
      resolve(root, 'node_modules/react/package.json'),
      `${JSON.stringify({ name: 'react', version: '18.0.0', types: 'index.d.ts' }, null, 2)}\n`,
    );
    await writeFile(
      resolve(root, 'probe.ts'),
      [
        "import type { RefObject } from 'react';",
        'declare const pendingRestore: RefObject<string>;',
        'pendingRestore.current = null;',
        '',
      ].join('\n'),
    );
    await writeFile(
      resolve(root, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ES2022',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            lib: ['ES2022', 'DOM'],
            types: [],
          },
          files: ['probe.ts'],
        },
        null,
        2,
      )}\n`,
    );

    const tsc = resolve(repoRoot, 'node_modules/.bin/tsc');
    let output = '';
    try {
      await run(tsc, ['--noEmit', '-p', resolve(root, 'tsconfig.json')]);
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? error);
    }
    expect(output).toContain('TS2540');
  }, 60_000);
});
