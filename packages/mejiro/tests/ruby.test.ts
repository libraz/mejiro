import { describe, expect, it } from 'vitest';
import { isKana, preprocessRuby } from '../src/ruby.js';
import type { RubyAnnotation } from '../src/ruby.js';
import { toCodepoints, uniformAdvances } from './helpers.js';

describe('isKana', () => {
  it('returns true for hiragana', () => {
    expect(isKana(0x3042)).toBe(true); // あ
    expect(isKana(0x304b)).toBe(true); // か
    expect(isKana(0x309f)).toBe(true); // end of hiragana block
  });

  it('returns true for katakana', () => {
    expect(isKana(0x30a2)).toBe(true); // ア
    expect(isKana(0x30ab)).toBe(true); // カ
    expect(isKana(0x30ff)).toBe(true); // end of katakana block
  });

  it('returns false for kanji', () => {
    expect(isKana(0x6f22)).toBe(false); // 漢
    expect(isKana(0x5b57)).toBe(false); // 字
  });

  it('returns false for ASCII', () => {
    expect(isKana(0x41)).toBe(false); // A
  });
});

function makeAnnotation(
  startIndex: number,
  endIndex: number,
  rubyText: string,
  rubyAdvanceWidth: number,
  type?: RubyAnnotation['type'],
  jukugoSplitPoints?: number[],
): RubyAnnotation {
  const cps = toCodepoints(rubyText);
  return {
    startIndex,
    endIndex,
    rubyText: cps,
    rubyAdvances: uniformAdvances(cps.length, rubyAdvanceWidth),
    type,
    jukugoSplitPoints,
  };
}

describe('preprocessRuby', () => {
  it('expands effective advance when mono ruby is wider than base', () => {
    // 漢字です — ruby "かん" (2 chars × 10px = 20px) on 漢 (16px base)
    const text = toCodepoints('漢字です');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(0, 1, 'かん', 10, 'mono');

    const result = preprocessRuby(text, advances, [ann]);

    // Ruby 20px > base 16px, no adjacent kana for overhang → excess 4px added
    expect(result.effectiveAdvances[0]).toBeCloseTo(20);
    // Other characters unchanged
    expect(result.effectiveAdvances[1]).toBeCloseTo(16);
    expect(result.effectiveAdvances[2]).toBeCloseTo(16);
    expect(result.effectiveAdvances[3]).toBeCloseTo(16);
  });

  it('does not change advances when ruby is narrower than base', () => {
    // 漢字 — ruby "かんじ" (3 chars × 8px = 24px) on 漢字 (2 × 16px = 32px base)
    const text = toCodepoints('漢字です');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(0, 2, 'かんじ', 8, 'group');

    const result = preprocessRuby(text, advances, [ann]);

    for (let i = 0; i < text.length; i++) {
      expect(result.effectiveAdvances[i]).toBeCloseTo(16);
    }
  });

  it('absorbs ruby overhang into adjacent kana', () => {
    // あ漢い — ruby "かんかん" (4 chars × 10px = 40px) on 漢 (16px base)
    // excess = 24px, left kana overhang = min(8, 12) = 8, right kana overhang = min(8, 12) = 8
    // net excess = 24 - 8 - 8 = 8px
    const text = toCodepoints('あ漢い');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(1, 2, 'かんかん', 10, 'mono');

    const result = preprocessRuby(text, advances, [ann]);

    // Base char gets net excess: 16 + 8 = 24
    expect(result.effectiveAdvances[1]).toBeCloseTo(24);
    // Adjacent kana unchanged (overhang doesn't modify their advances)
    expect(result.effectiveAdvances[0]).toBeCloseTo(16);
    expect(result.effectiveAdvances[2]).toBeCloseTo(16);
  });

  it('creates shared cluster ID for group ruby', () => {
    const text = toCodepoints('あ明日か');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(1, 3, 'あした', 8, 'group');

    const result = preprocessRuby(text, advances, [ann]);

    // Indices 1 and 2 should share a cluster ID
    expect(result.clusterIds[1]).toBe(result.clusterIds[2]);
    // Index 0 and 3 should have different IDs
    expect(result.clusterIds[0]).not.toBe(result.clusterIds[1]);
    expect(result.clusterIds[3]).not.toBe(result.clusterIds[1]);
  });

  it('creates sub-group clusters for jukugo ruby', () => {
    // 東京都 with splitPoints [1, 2] → groups: [東], [京], [都] (all size 1, no clustering needed)
    const text = toCodepoints('東京都');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(0, 3, 'とうきょうと', 8, 'jukugo', [1, 2]);

    const result = preprocessRuby(text, advances, [ann]);

    // All individual chars, splitPoints at every boundary = no forced clustering
    // Each char should be independently breakable
    expect(result.clusterIds[0]).not.toBe(result.clusterIds[1]);
    expect(result.clusterIds[1]).not.toBe(result.clusterIds[2]);
  });

  it('creates sub-group clusters for jukugo ruby with multi-char groups', () => {
    // 東京都 with splitPoints [2] → groups: [東京], [都]
    const text = toCodepoints('東京都');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(0, 3, 'とうきょうと', 8, 'jukugo', [2]);

    const result = preprocessRuby(text, advances, [ann]);

    // 東 and 京 should share a cluster ID
    expect(result.clusterIds[0]).toBe(result.clusterIds[1]);
    // 都 should have a different cluster ID
    expect(result.clusterIds[2]).not.toBe(result.clusterIds[0]);
  });

  it('preserves existing cluster IDs', () => {
    const text = toCodepoints('あいうえお');
    const advances = uniformAdvances(text.length, 16);
    const existingClusters = new Uint32Array([0, 0, 1, 1, 2]);
    const ann = makeAnnotation(0, 1, 'ア', 20, 'mono');

    const result = preprocessRuby(text, advances, [ann], existingClusters);

    // Existing clusters should be preserved for non-ruby chars
    expect(result.clusterIds[1]).toBe(0); // unchanged
    expect(result.clusterIds[2]).toBe(1); // unchanged
    expect(result.clusterIds[3]).toBe(1); // unchanged
    expect(result.clusterIds[4]).toBe(2); // unchanged
  });

  it('distributes excess proportionally for non-uniform base advances', () => {
    const text = toCodepoints('漢字');
    // Non-uniform: 漢=20px, 字=10px
    const advances = new Float32Array([20, 10]);
    // Ruby: 4 chars × 10px = 40px, base = 30px, excess = 10px
    const ann = makeAnnotation(0, 2, 'かんかん', 10, 'group');

    const result = preprocessRuby(text, advances, [ann]);

    // Proportional: 漢 gets 10 * (20/30) ≈ 6.67, 字 gets 10 * (10/30) ≈ 3.33
    expect(result.effectiveAdvances[0]).toBeCloseTo(26.667, 2);
    expect(result.effectiveAdvances[1]).toBeCloseTo(13.333, 2);
  });
});
