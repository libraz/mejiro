import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Path of the in-memory probe module, placed beside this file so its imports resolve. */
const PROBE_FILE = resolve(import.meta.dirname, '__layout-hook-types-probe.ts');

/**
 * Type-checks `source` as a module beside this file and returns the messages
 * of the diagnostics reported in it. `tsc -b` covers `src` only, so this is
 * what makes the type-level assertions below able to fail.
 */
function typeErrors(source: string): string[] {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    jsx: ts.JsxEmit.ReactJSX,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, language, ...rest) =>
    name === PROBE_FILE
      ? ts.createSourceFile(name, source, language)
      : getSourceFile(name, language, ...rest);
  host.fileExists = (name) => name === PROBE_FILE || fileExists(name);
  const program = ts.createProgram([PROBE_FILE], options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(PROBE_FILE))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

/** Probe header: the compared types and the identity helpers. */
const PROBE_HEADER = `import type { InChapterAnchor } from '@libraz/mejiro/book';
import type { MutableRefObject } from 'react';
import type { UseChapterLayoutReturn, UseManuscriptLayoutReturn } from '../src/index.js';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
`;

/**
 * Each contract a probe line asserts; a broken line fails to compile. The
 * read-only `RefObject` of `@types/react@18` is checked separately by
 * `packages/mejiro/tests/docs-react-ref-recipe.test.ts`.
 */
const CONTRACTS = [
  "Expect<Equal<UseChapterLayoutReturn['pendingRestore'], MutableRefObject<InChapterAnchor | null>>>",
  "Expect<Equal<UseManuscriptLayoutReturn['pendingRestore'], MutableRefObject<InChapterAnchor | null>>>",
];

function probe(contracts: readonly string[]): string {
  return PROBE_HEADER + contracts.map((line, i) => `export type C${i} = ${line};`).join('\n');
}

describe('layout hook pendingRestore type', () => {
  it('exposes pendingRestore as a mutable ref on both layout hooks', () => {
    expect(typeErrors(probe(CONTRACTS))).toEqual([]);
  });

  it('fails the probe when a contract is broken', () => {
    const broken = CONTRACTS.map((line, i) =>
      i === 0 ? line.replace('InChapterAnchor | null', 'InChapterAnchor') : line,
    );
    expect(typeErrors(probe(broken))).toHaveLength(1);
  });
});
