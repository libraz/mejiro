import {
  buildTcyAnnotations,
  computeBreaks,
  deriveTypographyHints,
  type MejiroWarning,
  type MorphemeLike,
  type TextAnalysis,
  toCodepoints,
} from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

/** An analysis of 第12です whose digits are one numeral morpheme. */
function analysisOf(text: string, warnings: readonly MejiroWarning[] = []): TextAnalysis {
  const morphemes: MorphemeLike[] = [
    { surface: '第', startIndex: 0, endIndex: 1, pos: 'PREFIX', extendedPos: 'PREFIX' },
    { surface: '12', startIndex: 1, endIndex: 3, pos: 'NOUN', extendedPos: 'NOUN_数' },
    { surface: 'です', startIndex: 3, endIndex: 5, pos: 'AUX', extendedPos: 'AUX_断定' },
  ];
  return { text, morphemes, analyzer: { name: 'fixture', version: '0' }, warnings };
}

describe('deriveTypographyHints', () => {
  it('reads the text from the analysis', () => {
    const hints = deriveTypographyHints(analysisOf('第12です'), { tcy: true, penalties: true });

    expect(hints.breakPenalties).toHaveLength(5);
    expect(hints.tcyCandidates).toEqual([{ startIndex: 1, endIndex: 3 }]);
  });

  it('takes the options as the second argument and defaults them', () => {
    const analysis = analysisOf('第12です');

    expect(deriveTypographyHints(analysis).breakPenalties).toBeUndefined();
    expect(deriveTypographyHints(analysis, { penalties: true }).breakPenalties).toHaveLength(5);
  });

  it('is called with the analysis alone, not the text beside it', () => {
    expectTypeErrors(
      `import { deriveTypographyHints } from '@libraz/mejiro';
import type { TextAnalysis } from '@libraz/mejiro';
declare const analysis: TextAnalysis;
export const hints = deriveTypographyHints(analysis, { penalties: true });
export const old = deriveTypographyHints('第12です', analysis);
`,
      { fails: ['const old'] },
    );
  });
});

describe('morpheme and analysis types', () => {
  it('address a morpheme by startIndex and endIndex and carry typed warnings', () => {
    expectTypeErrors(
      `import type { MejiroWarning, MorphemeLike, TextAnalysis } from '@libraz/mejiro';
const warning: MejiroWarning = { code: 'alignment-failed', message: 'offsets did not align' };
export const morpheme: MorphemeLike = { surface: 'a', startIndex: 0, endIndex: 1, pos: 'NOUN', extendedPos: 'NOUN' };
export const analysis: TextAnalysis = { text: 'a', morphemes: [morpheme], analyzer: { name: 'x', version: '1' }, warnings: [warning] };
export const oldMorpheme: MorphemeLike = { surface: 'a', start: 0, end: 1, pos: 'NOUN', extendedPos: 'NOUN' };
export const oldWarnings: TextAnalysis = { text: 'a', morphemes: [], analyzer: { name: 'x', version: '1' }, warnings: ['plain string'] };
export const unknownCode: MejiroWarning = { code: 'made-up', message: '' };
`,
      { fails: ['const oldMorpheme', 'const oldWarnings', 'const unknownCode'] },
    );
  });
});

describe('buildTcyAnnotations', () => {
  it('turns hint candidates into spans one em wide that computeBreaks accepts', () => {
    const analysis = analysisOf('第12です');
    const hints = deriveTypographyHints(analysis, { tcy: true });
    const tcyAnnotations = buildTcyAnnotations(hints.tcyCandidates ?? [], 16);

    expect(tcyAnnotations).toEqual([{ startIndex: 1, endIndex: 3, advance: 16 }]);

    const text = toCodepoints(analysis.text);
    const result = computeBreaks({
      text,
      advances: new Float32Array(text.length).fill(16),
      lineWidth: 64,
      tcyAnnotations,
    });
    expect(result.effectiveAdvances?.[1]).toBeCloseTo(8);
    expect(result.effectiveAdvances?.[2]).toBeCloseTo(8);
  });

  it('collects only the tate-chu-yoko variants of an inline annotation list', () => {
    const spans = buildTcyAnnotations(
      [
        { type: 'em', startIndex: 0, endIndex: 1 },
        { type: 'tcy', startIndex: 2, endIndex: 4 },
        { type: 'ruby', startIndex: 5, endIndex: 6, rubyText: 'r' },
      ],
      12,
    );

    expect(spans).toEqual([{ startIndex: 2, endIndex: 4, advance: 12 }]);
  });

  it('returns undefined when there is nothing to combine', () => {
    expect(buildTcyAnnotations([], 16)).toBeUndefined();
    expect(
      buildTcyAnnotations([{ type: 'strong', startIndex: 0, endIndex: 1 }], 16),
    ).toBeUndefined();
    expect(buildTcyAnnotations(undefined, 16)).toBeUndefined();
  });

  it('accepts inline annotations or candidates, read-only', () => {
    expectTypeErrors(
      `import { buildTcyAnnotations } from '@libraz/mejiro';
import type { InlineAnnotation, TcyCandidate } from '@libraz/mejiro';
declare const annotations: readonly InlineAnnotation[];
declare const candidates: readonly TcyCandidate[];
export const fromAnnotations = buildTcyAnnotations(annotations, 16);
export const fromCandidates = buildTcyAnnotations(candidates, 16);
export const fromNumbers = buildTcyAnnotations([1, 2, 3], 16);
`,
      { fails: ['const fromNumbers'] },
    );
  });
});
