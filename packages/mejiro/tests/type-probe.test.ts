import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

const HEADER = "import type { MejiroErrorCode } from '@libraz/mejiro';\n";

describe('expectTypeErrors', () => {
  it('passes when the source compiles cleanly and no failure is expected', () => {
    expect(() =>
      expectTypeErrors(`${HEADER}export const code: MejiroErrorCode = 'fetch-failed';`, {
        fails: [],
      }),
    ).not.toThrow();
  });

  it('reports a type error that no failure marker expects', () => {
    expect(() =>
      expectTypeErrors(`${HEADER}export const code: MejiroErrorCode = 'no-such-code';`, {
        fails: [],
      }),
    ).toThrow(/unexpected error at line 2/);
  });

  it('passes when the marked line fails to compile', () => {
    expect(() =>
      expectTypeErrors(
        `${HEADER}export const ok: MejiroErrorCode = 'fetch-failed';\nexport const bad: MejiroErrorCode = 'no-such-code';`,
        { fails: ['const bad'] },
      ),
    ).not.toThrow();
  });

  it('reports a marked line that compiles', () => {
    expect(() =>
      expectTypeErrors(`${HEADER}export const ok: MejiroErrorCode = 'fetch-failed';`, {
        fails: ['const ok'],
      }),
    ).toThrow(/expected an error at line 2/);
  });

  it('resolves subpaths and the framework packages to their sources', () => {
    expect(() =>
      expectTypeErrors(
        [
          "import { MejiroError as FromEpub } from '@libraz/mejiro/epub';",
          "import { MejiroError as FromReact } from '@libraz/mejiro-react';",
          "import { MejiroError as FromVue } from '@libraz/mejiro-vue';",
          "export const errors = [new FromEpub('fetch-failed', ''), new FromReact('fetch-failed', ''), new FromVue('fetch-failed', '')];",
        ].join('\n'),
        { fails: [] },
      ),
    ).not.toThrow();
  });

  it('rejects a marker that does not identify exactly one line', () => {
    expect(() =>
      expectTypeErrors(`${HEADER}export const a = 1;\nexport const b = 2;`, {
        fails: ['export const'],
      }),
    ).toThrow(/exactly one line/);
  });
});
