import { describe, expect, it } from 'vitest';
import { computeBreaks } from '../src/layout.js';
import type { RubyAnnotation } from '../src/ruby.js';
import { toCodepoints, uniformAdvances } from './helpers.js';

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

  it('group ruby prevents break within annotated span', () => {
    // 12 chars × 16px = 192px total, lineWidth = 112px (7 chars per line)
    // Group ruby on indices 5-7 (明日) means they must stay together
    const text = toCodepoints('あいうえお明日かきくけこ');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(5, 7, 'あした', 8, 'group');

    const result = computeBreaks({
      text,
      advances,
      lineWidth: 112,
      rubyAnnotations: [ann],
    });

    // Verify no break occurs between indices 5 and 6
    for (const bp of result.breakPoints) {
      expect(bp).not.toBe(5); // cannot break after 明 (index 5) since 明日 is a cluster
    }
  });

  it('jukugo ruby allows break at split points', () => {
    // 東京都 with splitPoints [2] → can break after 京(index 6)
    const text = toCodepoints('あいうえお東京都かきく');
    const advances = uniformAdvances(text.length, 16);
    const ann = makeAnnotation(5, 8, 'とうきょうと', 8, 'jukugo', [2]);

    const result = computeBreaks({
      text,
      advances,
      lineWidth: 128, // 8 chars
      rubyAnnotations: [ann],
    });

    // Break should respect jukugo clustering: 東京 are grouped, 都 is separate
    // Verify that if there's a break in the 東京都 range, it's after 京 (index 6)
    for (const bp of result.breakPoints) {
      if (bp >= 5 && bp < 7) {
        expect(bp).not.toBe(5); // cannot break after 東 within 東京 group
      }
    }
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
