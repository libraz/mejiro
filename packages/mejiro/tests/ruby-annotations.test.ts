import {
  paginate,
  preprocessRuby,
  type RubyAnnotation,
  type RubyType,
  toCodepoints,
  tokenLengthsToBoundaries,
} from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

function groupRuby(): RubyAnnotation {
  const rubyText = toCodepoints('かんじ');
  return {
    startIndex: 0,
    endIndex: 2,
    rubyText,
    rubyAdvances: new Float32Array(rubyText.length).fill(4),
    rubyType: 'group',
  };
}

describe('RubyAnnotation', () => {
  it('states its kind as rubyType, like every other ruby shape', () => {
    const text = toCodepoints('漢字です');
    const advances = new Float32Array(text.length).fill(16);
    const result = preprocessRuby(text, advances, [groupRuby()]);

    expect(result.clusterIds[0]).toBe(result.clusterIds[1]);
    expect(result.clusterIds[1]).not.toBe(result.clusterIds[2]);
  });

  it('treats a missing rubyType as mono', () => {
    const text = toCodepoints('漢字です');
    const advances = new Float32Array(text.length).fill(16);
    const { rubyType: _omitted, ...bare } = groupRuby();

    expect(() => preprocessRuby(text, advances, [bare])).toThrow(RangeError);
  });

  it('types the field as rubyType and rejects the former key', () => {
    expectTypeErrors(
      `import type { RubyAnnotation, RubyType } from '@libraz/mejiro';
const base = { startIndex: 0, endIndex: 1, rubyText: new Uint32Array(1), rubyAdvances: new Float32Array(1) };
export const kind: RubyType = 'jukugo';
export const ok: RubyAnnotation = { ...base, rubyType: 'mono' };
export const old: RubyAnnotation = { ...base, type: 'mono' };
export const splits: RubyAnnotation = { ...base, rubyType: 'jukugo', jukugoSplitPoints: [1] as readonly number[] };
`,
      { fails: ['const old'] },
    );
    const kinds: RubyType[] = ['mono', 'group', 'jukugo'];
    expect(kinds).toHaveLength(3);
  });
});

describe('inputs the library does not modify', () => {
  it('are accepted as read-only arrays', () => {
    const text = toCodepoints('漢字です');
    const advances = new Float32Array(text.length).fill(16);
    const annotations: readonly RubyAnnotation[] = Object.freeze([groupRuby()]);

    expect(() => preprocessRuby(text, advances, annotations)).not.toThrow();
    expect([...tokenLengthsToBoundaries(Object.freeze([3, 7, 2]))]).toEqual([2, 9]);
    expect(
      paginate(100, Object.freeze([{ lineCount: 2, linePitch: 10, gapBefore: 0 }])),
    ).toHaveLength(1);
  });

  it('type-check as read-only arrays', () => {
    expectTypeErrors(
      `import { paginate, preprocessRuby, tokenLengthsToBoundaries } from '@libraz/mejiro';
import type { ParagraphMeasure, RubyAnnotation } from '@libraz/mejiro';
declare const text: Uint32Array;
declare const advances: Float32Array;
declare const rubies: readonly RubyAnnotation[];
declare const measures: readonly ParagraphMeasure[];
declare const lengths: readonly number[];
export const a = preprocessRuby(text, advances, rubies);
export const b = paginate(100, measures);
export const c = tokenLengthsToBoundaries(lengths);
`,
      { fails: [] },
    );
  });
});
