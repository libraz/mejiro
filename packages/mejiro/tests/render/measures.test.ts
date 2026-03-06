import { describe, expect, it } from 'vitest';
import { buildParagraphMeasures } from '../../src/render/measures.js';
import type { RenderEntry } from '../../src/render/types.js';

function makeEntry(charCount: number, breakCount: number, isHeading = false): RenderEntry {
  return {
    chars: Array.from({ length: charCount }, () => 'あ'),
    breakPoints: new Uint32Array(breakCount),
    rubyAnnotations: [],
    isHeading,
  };
}

describe('buildParagraphMeasures', () => {
  it('computes body paragraph measures', () => {
    const entries = [makeEntry(20, 2)]; // 3 lines
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
    });
    expect(measures).toEqual([{ lineCount: 3, linePitch: 16 * 1.8, gapBefore: 16 * 0.4 }]);
  });

  it('computes heading paragraph measures with default scale', () => {
    const entries = [makeEntry(5, 0, true)]; // 1 line, heading
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
    });
    const headingFontSize = Math.round(16 * 1.4);
    expect(measures).toEqual([
      { lineCount: 1, linePitch: headingFontSize * 1.8, gapBefore: 16 * 0.4 },
    ]);
  });

  it('applies heading gap after a heading paragraph', () => {
    const entries = [
      makeEntry(5, 0, true), // heading
      makeEntry(20, 2), // body after heading
    ];
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
    });
    expect(measures[1].gapBefore).toBe(16 * 1.2);
  });

  it('applies paragraph gap after a body paragraph', () => {
    const entries = [
      makeEntry(20, 2), // body
      makeEntry(20, 2), // body
    ];
    const measures = buildParagraphMeasures(entries, {
      fontSize: 16,
      lineHeight: 1.8,
    });
    expect(measures[1].gapBefore).toBe(16 * 0.4);
  });

  it('uses custom scale and gap options', () => {
    const entries = [makeEntry(5, 0, true)];
    const measures = buildParagraphMeasures(entries, {
      fontSize: 20,
      lineHeight: 2.0,
      headingScale: 1.5,
      paragraphGapEm: 0.5,
      headingGapEm: 1.5,
    });
    const headingFontSize = Math.round(20 * 1.5);
    expect(measures).toEqual([
      { lineCount: 1, linePitch: headingFontSize * 2.0, gapBefore: 20 * 0.5 },
    ]);
  });

  it('returns empty array for empty input', () => {
    const measures = buildParagraphMeasures([], {
      fontSize: 16,
      lineHeight: 1.8,
    });
    expect(measures).toEqual([]);
  });
});
