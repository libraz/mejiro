import { describe, expect, it } from 'vitest';
import { computeBreaks } from '../src/layout.js';
import { getLineRanges } from '../src/paginate.js';
import type { RubyAnnotation } from '../src/ruby.js';
import { toCodepoints, uniformAdvances } from './helpers.js';

function sum(values: Float32Array): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Inline extent the render layer produces for one line: an annotated span is
 * drawn as wide as the wider of its base text and its ruby text.
 */
function renderedExtent(
  advances: Float32Array,
  annotations: readonly RubyAnnotation[],
  start: number,
  end: number,
): number {
  let extent = 0;
  for (let i = start; i < end; ) {
    const ann = annotations.find((a) => a.startIndex === i && a.endIndex <= end);
    if (!ann) {
      extent += advances[i];
      i++;
      continue;
    }
    extent += Math.max(sum(advances.slice(ann.startIndex, ann.endIndex)), sum(ann.rubyAdvances));
    i = ann.endIndex;
  }
  return extent;
}

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

describe('computeBreaks with ruby', () => {
  it('returns effectiveAdvances when ruby annotations are provided', () => {
    const text = toCodepoints('漢字です');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(0, 1, 'かん', 10, 'mono');

    const result = computeBreaks({
      text,
      advances,
      lineWidth: 100,
      rubyAnnotations: [ann],
    });

    expect(result.effectiveAdvances).toBeDefined();
    expect(result.effectiveAdvances?.[0]).toBeCloseTo(20);
  });

  it('does not return effectiveAdvances when no ruby annotations', () => {
    const text = toCodepoints('あいう');
    const result = computeBreaks({
      text,
      advances: uniformAdvances(text.length, 16),
      lineWidth: 100,
    });

    expect(result.effectiveAdvances).toBeUndefined();
  });

  it('group ruby moves the break off the position that would split its base', () => {
    // 12 chars x 16px, lineWidth 96px holds 6 characters. The greedy break
    // after index 5 would fall between 明 and 日, so it has to back up.
    const text = toCodepoints('あいうえお明日かきくけこ');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(5, 7, 'あした', 8, 'group');

    const withRuby = computeBreaks({ text, advances, lineWidth: 96, rubyAnnotations: [ann] });
    const withoutRuby = computeBreaks({ text, advances, lineWidth: 96 });

    expect([...withoutRuby.breakPoints]).toEqual([5]);
    expect([...withRuby.breakPoints]).toEqual([4, 10]);
  });

  it('jukugo ruby allows a break at a split point but not inside a sub-group', () => {
    // 東京都 with splitPoints [2]: 東京 is one sub-group, 都 another. A break
    // after index 6 sits on the split point; a break after index 5 does not.
    const text = toCodepoints('あいうえお東京都かきく');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(5, 8, 'とうきょうと', 8, 'jukugo', [2]);

    // lineWidth 112 holds 7 characters, so the greedy break lands on the split
    // point and is taken as-is.
    const atSplitPoint = computeBreaks({ text, advances, lineWidth: 112, rubyAnnotations: [ann] });
    expect([...atSplitPoint.breakPoints]).toEqual([6]);

    // lineWidth 96 holds 6 characters, so the greedy break would fall between
    // 東 and 京 and must back up past the whole sub-group.
    const insideSubGroup = computeBreaks({ text, advances, lineWidth: 96, rubyAnnotations: [ann] });
    expect([...insideSubGroup.breakPoints]).toEqual([4]);

    // Declaring a split point after 東 instead lets the break stay at index 5.
    const splitAfterFirst = computeBreaks({
      text,
      advances,
      lineWidth: 96,
      rubyAnnotations: [makeAnnotation(5, 8, 'とうきょうと', 8, 'jukugo', [1, 2])],
    });
    expect([...splitAfterFirst.breakPoints]).toEqual([5]);
  });

  it('breaks inside a jukugo aggregate only at its split points', () => {
    // 東京<rt>とうきょう</rt>都<rt>と</rt> — per-segment annotations plus the
    // aggregate that only supplies the split point after 東京 (index 6).
    const text = toCodepoints('あいうえお東京都かきく');
    const advances = uniformAdvances(text.length, 16);
    const spanStart = 5;
    const spanEnd = 8;
    const splitPoints = [2];
    const annotations = [
      makeAnnotation(spanStart, 7, 'とうきょう', 8, 'group'),
      makeAnnotation(7, spanEnd, 'と', 8, 'mono'),
      makeAnnotation(spanStart, spanEnd, 'とうきょうと', 8, 'jukugo', splitPoints),
    ];

    let sawSplitPointBreak = false;
    for (let lineWidth = 48; lineWidth <= 176; lineWidth += 16) {
      const result = computeBreaks({ text, advances, lineWidth, rubyAnnotations: annotations });
      for (const bp of result.breakPoints) {
        // A break at bp ends the line after bp, so the next line starts at bp + 1.
        if (bp >= spanStart && bp <= spanEnd - 2) {
          expect(splitPoints).toContain(bp - spanStart + 1);
          sawSplitPointBreak = true;
        }
      }
    }
    expect(sawSplitPointBreak).toBe(true);
  });

  it('wider ruby causes earlier line break', () => {
    // Without ruby: 5 chars × 16px = 80px fits in lineWidth=80
    // With wide ruby on char 0: effective advance grows, pushes total past lineWidth
    const text = toCodepoints('漢あいうえ');
    const advances = uniformAdvances(text.length, 16);
    // Ruby 4 chars × 10px = 40px on single 16px base char → effective 40px
    // Total: 40+16+16+16+16 = 104px > 80px → needs break
    const ann = makeAnnotation(0, 1, 'かんかん', 10, 'mono');

    const withRuby = computeBreaks({
      text,
      advances,
      lineWidth: 80,
      rubyAnnotations: [ann],
    });

    const withoutRuby = computeBreaks({
      text,
      advances,
      lineWidth: 80,
    });

    expect(withoutRuby.breakPoints.length).toBe(0); // fits without ruby
    expect(withRuby.breakPoints.length).toBeGreaterThan(0); // needs break with ruby
  });

  it('reserves at least the width a line of wide ruby renders', () => {
    // Each 漢 carries ruby that is 40px wide against a 16px base, and every
    // annotation sits between kana. Rendering draws a ruby span as wide as the
    // wider of its base and its ruby text, so every line must reserve at least
    // that much to render un-clipped inside a slot of the line's width.
    const text = toCodepoints('あ漢い漢う漢え漢お');
    const advances = uniformAdvances(text.length, 16);
    const annotations = [
      makeAnnotation(1, 2, 'かんかん', 10, 'mono'),
      makeAnnotation(3, 4, 'かんかん', 10, 'mono'),
      makeAnnotation(5, 6, 'かんかん', 10, 'mono'),
      makeAnnotation(7, 8, 'かんかん', 10, 'mono'),
    ];
    const lineWidth = 100;

    const result = computeBreaks({ text, advances, lineWidth, rubyAnnotations: annotations });
    const effective = result.effectiveAdvances;
    if (!effective) throw new Error('expected effectiveAdvances');

    expect(result.breakPoints.length).toBeGreaterThan(0);
    for (const [start, end] of getLineRanges(result.breakPoints, text.length)) {
      const reserved = sum(effective.slice(start, end));
      expect(reserved).toBeGreaterThanOrEqual(renderedExtent(advances, annotations, start, end));
      expect(reserved).toBeLessThanOrEqual(lineWidth);
    }
  });

  it('reserves at least the width a group ruby renders', () => {
    const text = toCodepoints('あ明日い明日う');
    const advances = uniformAdvances(text.length, 16);
    const annotations = [
      makeAnnotation(1, 3, 'あしたの', 12, 'group'),
      makeAnnotation(4, 6, 'あしたの', 12, 'group'),
    ];
    const lineWidth = 96;

    const result = computeBreaks({ text, advances, lineWidth, rubyAnnotations: annotations });
    const effective = result.effectiveAdvances;
    if (!effective) throw new Error('expected effectiveAdvances');

    for (const [start, end] of getLineRanges(result.breakPoints, text.length)) {
      const reserved = sum(effective.slice(start, end));
      expect(reserved).toBeGreaterThanOrEqual(renderedExtent(advances, annotations, start, end));
      expect(reserved).toBeLessThanOrEqual(lineWidth);
    }
  });

  it('backward compatibility: empty rubyAnnotations array', () => {
    const text = toCodepoints('あいうえお');
    const advances = uniformAdvances(text.length, 16);

    const result = computeBreaks({
      text,
      advances,
      lineWidth: 80,
      rubyAnnotations: [],
    });

    expect(result.effectiveAdvances).toBeUndefined();
    expect(result.breakPoints.length).toBe(0);
  });
});
