import { resolve } from 'node:path';
import ts from 'typescript';

/**
 * Type-level probes for the public surface.
 *
 * vitest runs tests without type-checking them, so a contract that only the
 * type system enforces — a named type being exported, a union rejecting an
 * invalid combination, a `readonly` input — needs a compile step of its own.
 * {@link expectTypeErrors} type-checks a source string as a module beside this
 * file, with every `@libraz/mejiro*` specifier mapped to the package sources,
 * so the probe sees the current tree rather than a stale `dist` build.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** Path of the in-memory probe module; it sits beside this file so relative imports resolve. */
const PROBE_FILE = resolve(import.meta.dirname, '__type-probe__.ts');

const CORE_SUBPATHS = ['analysis', 'book', 'browser', 'epub', 'image', 'render'];

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  noEmit: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  jsx: ts.JsxEmit.ReactJSX,
  paths: {
    '@libraz/mejiro': [resolve(REPO_ROOT, 'packages/mejiro/src/index.ts')],
    ...Object.fromEntries(
      CORE_SUBPATHS.map((subpath) => [
        `@libraz/mejiro/${subpath}`,
        [resolve(REPO_ROOT, `packages/mejiro/src/${subpath}/index.ts`)],
      ]),
    ),
    '@libraz/mejiro-react': [resolve(REPO_ROOT, 'packages/mejiro-react/src/index.ts')],
    '@libraz/mejiro-vue': [resolve(REPO_ROOT, 'packages/mejiro-vue/src/index.ts')],
  },
};

/** Options of {@link expectTypeErrors}. */
export interface ExpectTypeErrorsOptions {
  /**
   * Substrings that each identify exactly one line of the source; every one of
   * those lines must produce at least one type error. An empty list asserts
   * that the whole source compiles cleanly.
   */
  fails: readonly string[];
}

/** Parsed library and source files, reused across probes so only the probe itself is re-parsed. */
const sourceFileCache = new Map<string, ts.SourceFile>();
let previousProgram: ts.Program | undefined;

function diagnose(source: string): readonly ts.Diagnostic[] {
  const host = ts.createCompilerHost(COMPILER_OPTIONS);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, language, ...rest) => {
    if (name === PROBE_FILE) return ts.createSourceFile(name, source, language, true);
    const cached = sourceFileCache.get(name);
    if (cached) return cached;
    const parsed = getSourceFile(name, language, ...rest);
    if (parsed) sourceFileCache.set(name, parsed);
    return parsed;
  };
  host.fileExists = (name) => name === PROBE_FILE || fileExists(name);
  const program = ts.createProgram([PROBE_FILE], COMPILER_OPTIONS, host, previousProgram);
  previousProgram = program;
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(PROBE_FILE));
}

function lineOf(lines: readonly string[], marker: string): number {
  const matches = lines.flatMap((line, index) => (line.includes(marker) ? [index] : []));
  if (matches.length !== 1) {
    throw new Error(
      `fails marker ${JSON.stringify(marker)} must match exactly one line of the probe, matched ${matches.length}`,
    );
  }
  return matches[0];
}

/**
 * Type-checks `source` and asserts that type errors occur on exactly the lines
 * named by `fails` and nowhere else.
 *
 * Pair every probe that expects an error with one that expects none, so the
 * test goes red when the contract breaks in either direction.
 *
 * @param source - Module source; `@libraz/mejiro`, its subpaths,
 *   `@libraz/mejiro-react` and `@libraz/mejiro-vue` resolve to the sources.
 * @param options - The lines that must fail.
 * @throws Error listing the unexpected and the missing errors when the
 *   diagnostics do not match.
 *
 * @example
 * ```ts
 * expectTypeErrors(
 *   `import type { MejiroErrorCode } from '@libraz/mejiro';
 * const ok: MejiroErrorCode = 'fetch-failed';
 * const bad: MejiroErrorCode = 'no-such-code';`,
 *   { fails: ["'no-such-code'"] },
 * );
 * ```
 */
export function expectTypeErrors(source: string, options: ExpectTypeErrorsOptions): void {
  const lines = source.split('\n');
  const expected = new Set(options.fails.map((marker) => lineOf(lines, marker)));
  const byLine = new Map<number, string[]>();
  for (const diagnostic of diagnose(source)) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const line =
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line
        : -1;
    byLine.set(line, [...(byLine.get(line) ?? []), message]);
  }

  const problems: string[] = [];
  for (const [line, messages] of byLine) {
    if (expected.has(line)) continue;
    const where = line < 0 ? 'probe' : `line ${line + 1}: ${lines[line].trim()}`;
    problems.push(`unexpected error at ${where}\n    ${messages.join('\n    ')}`);
  }
  for (const line of expected) {
    if (!byLine.has(line))
      problems.push(`expected an error at line ${line + 1}: ${lines[line].trim()}`);
  }
  if (problems.length > 0) throw new Error(`type probe mismatch:\n  ${problems.join('\n  ')}`);
}
