import * as render from '@libraz/mejiro/render';
import {
  adjustExclusionSlots,
  buildColumnSlots,
  buildInlineNodes,
  buildLineMetrics,
  buildParagraphMeasures,
  buildRenderPage,
  countPageLines,
  DEFAULT_LINE_SPACING,
  findPhysicalColumn,
  pageNumberFor,
  type RenderEntry,
  renderEpubStatic,
  segmentToInlineNode,
} from '@libraz/mejiro/render';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from '../type-probe.js';

const HEADER = "import * as render from '@libraz/mejiro/render';\n";

function entry(text: string, extra: Partial<RenderEntry> = {}): RenderEntry {
  return {
    chars: [...text],
    breakPoints: new Uint32Array(0),
    inlineAnnotations: [],
    ...extra,
  };
}

describe('render measures defaults', () => {
  it('shares one default line spacing with the rest of the package', () => {
    expect(DEFAULT_LINE_SPACING).toBe(1.8);
    const [measure] = buildParagraphMeasures([entry('あいう')], { fontSize: 16 });
    expect(measure.linePitch).toBe(16 * DEFAULT_LINE_SPACING);
    const { linePitch } = buildLineMetrics([entry('あいう')], { fontSize: 16 });
    expect(linePitch).toBe(16 * DEFAULT_LINE_SPACING);
  });

  it('accepts only lineSpacing as the line spacing option', () => {
    expectTypeErrors(
      `${HEADER}export const ok: render.MeasureOptions = { fontSize: 16, lineSpacing: 1.6 };
export const bad: render.MeasureOptions = { fontSize: 16, lineHeight: 1.6 };`,
      { fails: ['const bad'] },
    );
  });
});

describe('inline tree keys', () => {
  const chars = [...'漢字です'];

  it('names the base text of a ruby node and segment text', () => {
    const [node] = buildInlineNodes(chars, [
      { type: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ' },
    ]);
    expect(node).toMatchObject({ type: 'ruby', text: '漢字', rubyText: 'かんじ' });
    expect(node).not.toHaveProperty('base');

    const page = buildRenderPage(
      [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }],
      [
        entry('漢字です', {
          inlineAnnotations: [{ type: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ' }],
        }),
      ],
    );
    const [segment] = page.paragraphs[0].lines[0].segments;
    expect(segment).toMatchObject({ type: 'ruby', text: '漢字', rubyText: 'かんじ' });
    expect(segment).not.toHaveProperty('base');
  });

  it('tags a footnote annotation and its node alike', () => {
    const [node] = buildInlineNodes(chars, [
      { type: 'footnote-ref', startIndex: 0, endIndex: 1, noteId: 'n1' },
    ]);
    expect(node).toMatchObject({ type: 'footnote-ref', noteId: 'n1' });
  });

  it('types a ruby segment by text, not base', () => {
    expectTypeErrors(
      `${HEADER}export const ok: render.RenderSegment = { type: 'ruby', text: '漢', rubyText: 'かん' };
export const bad: render.RenderSegment = { type: 'ruby', base: '漢', rubyText: 'かん' };`,
      { fails: ['const bad'] },
    );
  });

  it('renders a segment that carries both text and children once', () => {
    const node = segmentToInlineNode({
      type: 'em',
      text: '強調',
      children: [{ type: 'strong', text: '強調', children: [] }],
    });
    expect(node).toEqual({
      type: 'element',
      tag: 'em',
      className: undefined,
      href: undefined,
      title: undefined,
      children: [
        {
          type: 'element',
          tag: 'strong',
          className: undefined,
          href: undefined,
          title: undefined,
          children: [{ type: 'text', text: '強調' }],
        },
      ],
    });
  });
});

describe('heading classification', () => {
  it('carries no legacy heading flag on entries or rendered paragraphs', () => {
    const page = buildRenderPage(
      [
        { paragraphIndex: 0, lineStart: 0, lineEnd: 1 },
        { paragraphIndex: 1, lineStart: 0, lineEnd: 1 },
      ],
      [entry('見出し', { kind: 'heading' }), entry('章', { headingLevel: 1 })],
    );
    for (const paragraph of page.paragraphs) {
      expect(paragraph).not.toHaveProperty('isHeading');
    }
    expect(page.paragraphs.map((p) => [p.kind, p.headingLevel])).toEqual([
      ['heading', undefined],
      [undefined, 1],
    ]);
  });

  it('measures a heading from headingLevel or kind alone', () => {
    const body = buildParagraphMeasures([entry('本文')], { fontSize: 16 })[0];
    const byKind = buildParagraphMeasures([entry('見出し', { kind: 'heading' })], {
      fontSize: 16,
    })[0];
    const byLevel = buildParagraphMeasures([entry('章', { headingLevel: 1 })], { fontSize: 16 })[0];
    expect(byKind.linePitch).toBeGreaterThan(body.linePitch);
    expect(byLevel.linePitch).toBeGreaterThan(body.linePitch);
  });

  it('rejects isHeading and a level outside 1 to 6', () => {
    expectTypeErrors(
      `${HEADER}const base = { chars: [], breakPoints: new Uint32Array(0), inlineAnnotations: [] };
export const ok: render.RenderEntry = { ...base, headingLevel: 2 };
export const flagged: render.RenderEntry = { ...base, isHeading: true };
export const deep: render.RenderEntry = { ...base, headingLevel: 7 };`,
      { fails: ['const flagged', 'const deep'] },
    );
  });
});

describe('exclusion layout helpers', () => {
  const tenLines = entry('あ'.repeat(40), { breakPoints: new Uint32Array(9) });
  const { metrics, offsets } = buildLineMetrics([tenLines], { fontSize: 16, lineSpacing: 1.8 });

  it('takes one named input object per multi-value helper', () => {
    const slots = buildColumnSlots({ metrics, startIndex: 0, count: 3, columnHeight: 500 });
    expect(slots.map((s) => s.columnIndex)).toEqual([0, 1, 2]);

    const adjusted = adjustExclusionSlots({ slots, metrics, startIndex: 0, basePitch: 16 * 1.8 });
    expect(adjusted).toHaveLength(3);

    expect(
      findPhysicalColumn({ offsets, spreadStartLine: 0, fromRight: 90, basePitch: 16 * 1.8 }),
    ).toBe(3);
  });

  it('counts the lines that fit a page from a start index', () => {
    expect(countPageLines(metrics, 0, 16 * 1.8 * 3)).toBe(3);
    expect(render).not.toHaveProperty('packPageLines');
  });

  it('exposes the input types and rejects the positional forms', () => {
    expectTypeErrors(
      `${HEADER}declare const metrics: render.LineMetric[];
declare const offsets: Float32Array;
export const a: render.BuildColumnSlotsInput = { metrics, startIndex: 0, count: 1, columnHeight: 9 };
export const b = render.buildColumnSlots({ metrics, startIndex: 0, count: 1, columnHeight: 9 });
export const c = render.findPhysicalColumn({ offsets, spreadStartLine: 0, fromRight: 1, basePitch: 1 });
export const d = render.adjustExclusionSlots({ slots: b, metrics, startIndex: 0, basePitch: 1 });
export const e: render.AdjustExclusionSlotsInput = { slots: b, metrics, startIndex: 0, basePitch: 1 };
export const f: render.FindPhysicalColumnInput = { offsets, spreadStartLine: 0, fromRight: 1, basePitch: 1 };
export const oldBuild = render.buildColumnSlots(metrics, 0, 1, 9);
export const oldFind = render.findPhysicalColumn(offsets, 0, 1, 1);
export const oldAdjust = render.adjustExclusionSlots(b, metrics, 0, 1);`,
      { fails: ['const oldBuild', 'const oldFind', 'const oldAdjust'] },
    );
  });

  it('keeps the nesting helpers out of the public entry', () => {
    expect(render).not.toHaveProperty('annotationNestingRank');
    expect(render).not.toHaveProperty('partiallyOverlaps');
  });
});

describe('chapter input and page numbers', () => {
  it('renders any chapter-shaped source without a dedicated type', () => {
    const chapter = { paragraphs: [{ text: 'hello', headingLevel: 1 as const }] };
    expect(renderEpubStatic(chapter)).toContain('mejiro-paragraph--h1');
    expectTypeErrors(
      `${HEADER}import type { ChapterSource } from '@libraz/mejiro';
declare const source: ChapterSource;
export const ok = render.renderEpubStatic(source);
export const bad: render.StaticChapter = source;`,
      { fails: ['const bad'] },
    );
  });

  it('numbers pages by zero-based index', () => {
    expect(pageNumberFor('both', 0)).toBe(1);
    expect(pageNumberFor('both', 1)).toBe(2);
    expect(pageNumberFor('right', 1)).toBeNull();
    expect(pageNumberFor('left', 1)).toBe(2);
    expect(pageNumberFor('none', 0)).toBeNull();
  });
});
