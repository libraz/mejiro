import { resolve } from 'node:path';
import { moveImageOverlayRect } from '@libraz/mejiro';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { ImageRect } from '../src/index.js';

/** Path of the in-memory probe module, placed beside this file so its imports resolve. */
const PROBE_FILE = resolve(import.meta.dirname, '__overlay-types-probe.ts');

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
const PROBE_HEADER = `import type {
  ImageRect as CoreExclusionRect,
  ImageOverlayRect as CoreOverlayRect,
} from '@libraz/mejiro';
import type { ImageOverlayRect, ImageRect, UseImageOverlayReturn } from '../src/index.js';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;
`;

/** Each contract a probe line asserts; a broken line fails to compile. */
const CONTRACTS = [
  // `ImageOverlayRect` is the name the package family agrees on; `ImageRect`
  // stays as a deprecated alias so the rename is not a breaking change.
  'Expect<Equal<ImageOverlayRect, CoreOverlayRect>>',
  'Expect<Equal<ImageRect, CoreOverlayRect>>',
  "Expect<Equal<UseImageOverlayReturn['imageRect']['value'], CoreOverlayRect | null>>",
  // The overlay rect stays distinct from the exclusion rect.
  'Expect<Not<Equal<CoreExclusionRect, CoreOverlayRect>>>',
  "Expect<Equal<'inlineMargin' extends keyof CoreExclusionRect ? true : false, true>>",
  "Expect<Equal<'inlineMargin' extends keyof CoreOverlayRect ? true : false, false>>",
];

function probe(contracts: readonly string[]): string {
  return PROBE_HEADER + contracts.map((line, i) => `export type C${i} = ${line};`).join('\n');
}

describe('image overlay rect type', () => {
  it('names the overlay rect from the package barrel and keeps it apart from the exclusion rect', () => {
    expect(typeErrors(probe(CONTRACTS))).toEqual([]);
  });

  it('fails the probe when a contract is broken', () => {
    const broken = CONTRACTS.map((line, i) =>
      i === 0 ? line.replace('CoreOverlayRect', 'CoreExclusionRect') : line,
    );
    expect(typeErrors(probe(broken))).toHaveLength(1);
  });

  it('feeds the barrel rect straight into the core overlay helpers', () => {
    const rect: ImageRect = { x: 10, y: 20, w: 100, h: 120 };
    expect(moveImageOverlayRect(rect, 5, -10)).toEqual({ x: 15, y: 10, w: 100, h: 120 });
  });
});
