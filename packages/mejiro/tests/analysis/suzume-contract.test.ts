import { MejiroError } from '@libraz/mejiro';
import {
  alignMorphemeOffsets,
  createSuzumeAnalyzer,
  type SuzumeInstance,
} from '@libraz/mejiro/analysis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../type-probe.js';

/** Runs `action` and returns what it threw, failing the test when it does not throw. */
function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

/** Same as {@link thrown} for a promise-returning action. */
async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

/** An instance that answers every text with the given normalized text and morphemes. */
function fakeInstance(
  normalizedText: string,
  morphemes: { surface: string; start: number; end: number }[],
  destroy = vi.fn(),
): SuzumeInstance {
  return {
    version: '9.9.9',
    analyzeWithNormalizedText: () => ({
      normalizedText,
      morphemes: morphemes.map((m) => ({ ...m, pos: 'NOUN', extendedPos: 'NOUN' })),
    }),
    destroy,
  };
}

describe('createSuzumeAnalyzer failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@libraz/suzume');
    vi.resetModules();
  });

  it('reports a missing peer dependency as an unavailable analyzer and keeps the cause', async () => {
    const cause = new Error("Cannot find module '@libraz/suzume'");
    vi.resetModules();
    vi.doMock('@libraz/suzume', () => {
      throw cause;
    });
    const analysis = await import('@libraz/mejiro/analysis');

    const error = await rejection(() => analysis.createSuzumeAnalyzer());

    expect(error).toMatchObject({ name: 'MejiroError', code: 'analyzer-unavailable' });
    expect((error as MejiroError).cause).toBeDefined();
  });

  it('reports a WebAssembly module that fails to load as an unavailable analyzer', async () => {
    // The WebAssembly runtime logs its own load failure before it rejects.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const error = await rejection(() =>
      createSuzumeAnalyzer({ wasmPath: '/nonexistent/suzume.wasm' }),
    );

    expect(error).toBeInstanceOf(MejiroError);
    expect(error).toMatchObject({ code: 'analyzer-unavailable' });
    expect((error as MejiroError).cause).toBeDefined();
  });

  it('throws a disposed-analyzer error from analyze after dispose', async () => {
    const analyzer = await createSuzumeAnalyzer({ instance: fakeInstance('猫', []) });

    analyzer.dispose();

    expect(thrown(() => analyzer.analyze('猫'))).toMatchObject({
      name: 'MejiroError',
      code: 'analyzer-disposed',
    });
  });

  it('stays terminal: dispose twice is a no-op and analyze keeps failing', async () => {
    const analyzer = await createSuzumeAnalyzer({ instance: fakeInstance('猫', []) });
    analyzer.dispose();

    expect(() => analyzer.dispose()).not.toThrow();
    expect(thrown(() => analyzer.analyze('猫'))).toMatchObject({ code: 'analyzer-disposed' });
  });

  it('leaves an adopted instance to its owner when disposed', async () => {
    const destroy = vi.fn();
    const adopting = await createSuzumeAnalyzer({ instance: fakeInstance('猫', [], destroy) });

    adopting.dispose();
    adopting.dispose();

    expect(destroy).not.toHaveBeenCalled();
  });
});

describe('createSuzumeAnalyzer instance validation', () => {
  it.each([
    ['null', null],
    ['a string', 'suzume'],
    ['an empty object', {}],
    ['an object without a version', { analyzeWithNormalizedText: () => ({}), destroy: () => {} }],
    [
      'an object with a non-string version',
      { version: 1, analyzeWithNormalizedText: () => ({}), destroy: () => {} },
    ],
    ['an object without analyzeWithNormalizedText', { version: '1', destroy: () => {} }],
    [
      'an object whose analyzeWithNormalizedText is not a function',
      { version: '1', analyzeWithNormalizedText: 'no', destroy: () => {} },
    ],
    ['an object without destroy', { version: '1', analyzeWithNormalizedText: () => ({}) }],
  ])(
    'rejects %s as the instance with a TypeError, before any analysis',
    async (_label, instance) => {
      const error = await rejection(() =>
        createSuzumeAnalyzer({ instance: instance as unknown as SuzumeInstance }),
      );

      expect(error).toBeInstanceOf(TypeError);
      expect(error).not.toBeInstanceOf(MejiroError);
    },
  );

  it('adopts a structurally complete instance', async () => {
    const analyzer = await createSuzumeAnalyzer({ instance: fakeInstance('猫', []) });

    expect(analyzer.identity).toEqual({ name: 'suzume', version: '9.9.9' });
    analyzer.dispose();
  });

  it('types the instance structurally and takes no signal', () => {
    const header = `import { createSuzumeAnalyzer } from '@libraz/mejiro/analysis';
import type { SuzumeInstance } from '@libraz/mejiro/analysis';
declare const instance: SuzumeInstance;
`;
    expectTypeErrors(
      `${header}export const adopted = createSuzumeAnalyzer({ instance, wasmPath: '/suzume.wasm' });
export const created = createSuzumeAnalyzer();
export const version: string = instance.version;
`,
      { fails: [] },
    );
    expectTypeErrors(
      `${header}export const anything = createSuzumeAnalyzer({ instance: 42 });
export const loose = createSuzumeAnalyzer({ instance: {} });
export const cancellable = createSuzumeAnalyzer({ signal: new AbortController().signal });
`,
      { fails: ['const anything', 'const loose', 'const cancellable'] },
    );
  });
});

describe('analysis warnings', () => {
  it('reports unalignable offsets as an alignment-failed warning with no morphemes', async () => {
    const analyzer = await createSuzumeAnalyzer({
      instance: fakeInstance('xyz', [{ surface: 'xyz', start: 0, end: 3 }]),
    });

    const analysis = analyzer.analyze('abcdef');

    expect(analysis.morphemes).toEqual([]);
    expect(analysis.warnings).toEqual([{ code: 'alignment-failed', message: expect.any(String) }]);
  });

  it('reports dropped morphemes as a morphemes-dropped warning and keeps the rest', async () => {
    const analyzer = await createSuzumeAnalyzer({
      instance: fakeInstance('abc', [
        { surface: 'ab', start: 0, end: 2 },
        { surface: 'c', start: 2, end: 99 },
      ]),
    });

    const analysis = analyzer.analyze('abc');

    expect(analysis.morphemes.map((m) => [m.startIndex, m.endIndex])).toEqual([[0, 2]]);
    expect(analysis.warnings).toEqual([{ code: 'morphemes-dropped', message: expect.any(String) }]);
  });

  it('returns morphemes with startIndex and endIndex and no warnings when all is well', async () => {
    const analyzer = await createSuzumeAnalyzer({
      instance: fakeInstance('abc', [{ surface: 'abc', start: 0, end: 3 }]),
    });

    const analysis = analyzer.analyze('abc');

    expect(analysis.morphemes).toEqual([
      { surface: 'abc', startIndex: 0, endIndex: 3, pos: 'NOUN', extendedPos: 'NOUN' },
    ]);
    expect(analysis.warnings).toEqual([]);
  });

  it('gives alignMorphemeOffsets coded warnings and read-only results', () => {
    const aligned = alignMorphemeOffsets('abc', 'abc', [
      { surface: 'c', startIndex: 2, endIndex: 99, pos: 'NOUN', extendedPos: 'NOUN' },
    ]);

    expect(aligned?.warnings).toEqual([{ code: 'morphemes-dropped', message: expect.any(String) }]);
    expect(aligned?.morphemes).toEqual([]);
    expect(alignMorphemeOffsets('abcdef', 'xyz', [])).toBeNull();

    const header = `import { alignMorphemeOffsets } from '@libraz/mejiro/analysis';
import type { MejiroWarning } from '@libraz/mejiro';
const aligned = alignMorphemeOffsets('abc', 'abc', []);
`;
    expectTypeErrors(
      `${header}export const warnings: readonly MejiroWarning[] | undefined = aligned?.warnings;
`,
      { fails: [] },
    );
    expectTypeErrors(
      `${header}export const push = aligned?.warnings.push({ code: 'morphemes-dropped', message: '' });
export const text: string | undefined = aligned?.warnings[0];
`,
      { fails: ['const push', 'const text'] },
    );
  });

  it('types the analysis warnings as MejiroWarning entries', () => {
    expectTypeErrors(
      `import type { TextAnalysis } from '@libraz/mejiro/analysis';
import type { MejiroWarning } from '@libraz/mejiro';
declare const analysis: TextAnalysis;
export const warnings: readonly MejiroWarning[] = analysis.warnings;
export const code: string = analysis.warnings[0].code;
export const text: string = analysis.warnings[0];
`,
      { fails: ['const text'] },
    );
  });
});
