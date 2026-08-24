import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSuzumeAnalyzer } from '../../src/analysis/suzume.js';
import type { MorphemeLike, TextAnalyzer } from '../../src/types.js';

/** ZERO WIDTH SPACE, which suzume's normalizer removes before tokenizing. */
const ZWSP = String.fromCodePoint(0x200b);

/** Extracts the code points `[start, end)` addresses, the way a caller would. */
function span(text: string, morpheme: MorphemeLike): string {
  return [...text].slice(morpheme.start, morpheme.end).join('');
}

// Loading the WebAssembly module and its dictionaries costs a few hundred
// milliseconds, so the whole suite shares one analyzer.
describe('createSuzumeAnalyzer', () => {
  let analyzer: TextAnalyzer;

  beforeAll(async () => {
    analyzer = await createSuzumeAnalyzer();
  });

  afterAll(() => {
    analyzer?.dispose();
  });

  it('returns morphemes whose offsets address their own surface', () => {
    const text = '今日は良い天気です。';

    const analysis = analyzer.analyze(text);

    expect(analysis.morphemes.length).toBeGreaterThan(0);
    for (const morpheme of analysis.morphemes) {
      expect(span(text, morpheme)).toBe(morpheme.surface);
    }
    expect(analysis.warnings).toEqual([]);
    expect(analysis.analyzer.name).toBe('suzume');
    expect(analysis.analyzer.version).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it('reports the same identity before and through an analysis', () => {
    // The contract a caller relies on when it compares identities without
    // analysing anything, which is how a restored snapshot decides whether the
    // hints it carries still apply.
    const analysis = analyzer.analyze('今日は良い天気です。');

    expect(analyzer.identity).toEqual({ name: 'suzume', version: expect.any(String) });
    expect(analysis.analyzer).toEqual(analyzer.identity);
  });

  it("reports the input text, not the analyzer's normalized text", () => {
    const text = `本日はＡ社の件${ZWSP}です。`;

    const analysis = analyzer.analyze(text);

    expect(analysis.text).toBe(text);
    // Suzume folds Ａ to A and drops the zero-width space, so the surfaces are
    // not the characters the input holds; the offsets still are. Comparing
    // through NFKC undoes the fold without loosening the position check.
    for (const morpheme of analysis.morphemes) {
      expect(span(text, morpheme).replaceAll(ZWSP, '').normalize('NFKC')).toBe(
        morpheme.surface.normalize('NFKC'),
      );
    }
    expect(analysis.warnings).toEqual([]);
  });

  it('positions morphemes correctly around a removed zero-width space', () => {
    const text = `吾輩${ZWSP}は猫である`;

    const analysis = analyzer.analyze(text);

    expect(analysis.morphemes.length).toBeGreaterThan(0);
    for (const morpheme of analysis.morphemes) {
      // A span may still cover the removed character when it falls inside a
      // morpheme, so the comparison ignores it; what matters is that no span
      // has slid past the characters its surface names.
      expect(span(text, morpheme).replaceAll(ZWSP, '')).toBe(morpheme.surface);
    }
    expect(analysis.morphemes.map((m) => m.surface).join('')).toBe('吾輩は猫である');
  });

  it('disposes idempotently and refuses to analyse afterwards', async () => {
    const disposable = await createSuzumeAnalyzer();

    disposable.dispose();

    expect(() => disposable.dispose()).not.toThrow();
    expect(() => disposable.analyze('猫')).toThrow(/disposed/u);
  });

  it('leaves an adopted instance to its owner', async () => {
    const { Suzume } = await import('@libraz/suzume');
    const instance = await Suzume.create({ preserveSymbols: true });
    const adopting = await createSuzumeAnalyzer({ instance });

    adopting.dispose();

    // The instance still answers, which it would not if `dispose()` had
    // destroyed the handle out from under its owner.
    expect(instance.analyze('猫').length).toBeGreaterThan(0);
    instance.destroy();
  });
});
