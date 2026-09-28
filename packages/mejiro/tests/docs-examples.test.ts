/**
 * Pins values printed in the documentation that are not covered by a more
 * specific docs test: ruby preprocessing output, the manuscript tate-chu-yoko
 * length limit, the heading-style level range, the pagination walkthrough and
 * the kinsoku extension recipe.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HEADING_STYLES } from '../src/book/constants.js';
import {
  buildKinsokuRules,
  computeBreaks,
  getDefaultKinsokuRules,
  paginate,
  preprocessRuby,
  toCodepoints,
} from '../src/index.js';
import { parseManuscript } from '../src/manuscript.js';
import {
  buildParagraphMeasures,
  buildRenderPage,
  paragraphClassName,
} from '../src/render/index.js';
import type { RenderEntry } from '../src/render/types.js';

describe('ruby preprocessing example', () => {
  it('keeps advances and clusters indices 0 and 1', () => {
    const text = toCodepoints('漢字を読む');
    const advances = new Float32Array([16, 16, 16, 16, 16]);

    const { effectiveAdvances, clusterIds } = preprocessRuby(text, advances, [
      {
        startIndex: 0,
        endIndex: 2,
        rubyText: toCodepoints('かんじ'),
        rubyAdvances: new Float32Array([8, 8, 8]),
        type: 'group',
      },
    ]);

    expect([...effectiveAdvances]).toEqual([16, 16, 16, 16, 16]);
    expect([...clusterIds]).toEqual([5, 5, 2, 3, 4]);
  });
});

describe('kinsoku extension recipe', () => {
  it.each(['en', 'ja'])('adds a character outside the defaults in the %s guide', async (locale) => {
    const doc = await readFile(
      resolve(import.meta.dirname, `../../../docs/${locale}/09-advanced.md`),
      'utf8',
    );
    const added = /\[\.\.\.defaults\.lineStartProhibited, (0x[0-9a-f]+)\]/u.exec(doc);
    const sample = /text: toCodepoints\('([^']+)'\),\n\s+advances: new Float32Array\((\d+)\)/u.exec(
      doc,
    );
    const breaks = /result\.breakPoints → \[([\d, ]+)\]/u.exec(doc);
    expect(added && sample && breaks, 'recipe shape changed').toBeTruthy();
    if (!(added && sample && breaks)) return;

    const codepoint = Number(added[1]);
    const defaults = getDefaultKinsokuRules();
    expect(defaults.lineStartProhibited).not.toContain(codepoint);

    const text = toCodepoints(sample[1]);
    expect(text.length).toBe(Number(sample[2]));
    const advances = new Float32Array(text.length).fill(16);
    const rules = buildKinsokuRules({
      lineStartProhibited: [...defaults.lineStartProhibited, codepoint],
      lineEndProhibited: defaults.lineEndProhibited,
      unbreakablePairs: defaults.unbreakablePairs,
    });
    const custom = computeBreaks({ text, advances, lineWidth: 80, kinsokuRules: rules });
    const builtin = computeBreaks({ text, advances, lineWidth: 80 });
    expect([...custom.breakPoints]).toEqual(breaks[1].split(', ').map(Number));
    expect([...custom.breakPoints]).not.toEqual([...builtin.breakPoints]);
  });
});

describe('manuscript tate-chu-yoko limit', () => {
  it('annotates up to five characters inside the brackets', () => {
    const result = parseManuscript('〔12345〕');

    expect(result.text).toBe('12345');
    expect(result.inlineAnnotations).toEqual([{ kind: 'tcy', startIndex: 0, endIndex: 5 }]);
  });

  it('leaves a six-character payload as body text', () => {
    const result = parseManuscript('〔123456〕');

    expect(result.text).toBe('〔123456〕');
    expect(result.inlineAnnotations).toEqual([]);
  });
});

describe('heading style defaults', () => {
  it('covers heading levels 1 through 6', () => {
    expect(Object.keys(DEFAULT_HEADING_STYLES)).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});

/** Builds a render entry the way the pagination walkthrough does. */
function docsEntry(text: string, extra: Partial<RenderEntry>): RenderEntry {
  return {
    chars: [...text],
    breakPoints: new Uint32Array(),
    inlineAnnotations: [],
    ...extra,
  };
}

describe('pagination walkthrough example', () => {
  it('carries kind and headingLevel from RenderEntry to the rendered class list', () => {
    const entries: RenderEntry[] = [
      docsEntry('第一章', { kind: 'heading', headingLevel: 1 }),
      docsEntry('吾輩は猫である。', { kind: 'body' }),
      docsEntry('引用された一節。', { kind: 'blockquote' }),
    ];

    const measures = buildParagraphMeasures(entries, { fontSize: 16, lineSpacing: 1.8 });
    const pages = paginate(400, measures);
    const page = buildRenderPage(pages[0], entries);

    expect(page.paragraphs.map((paragraph) => paragraph.kind)).toEqual([
      'heading',
      'body',
      'blockquote',
    ]);
    expect(
      page.paragraphs.map((paragraph) =>
        paragraphClassName(paragraph.kind, paragraph.headingLevel),
      ),
    ).toEqual([
      'mejiro-paragraph mejiro-paragraph--h1',
      'mejiro-paragraph',
      'mejiro-paragraph mejiro-paragraph--blockquote',
    ]);
  });

  it('treats lineSpacing as the documented default of 1', () => {
    const entries = [docsEntry('本文', {})];
    expect(buildParagraphMeasures(entries, { fontSize: 16 })[0].linePitch).toBe(16);
    expect(buildParagraphMeasures(entries, { fontSize: 16, lineSpacing: 1.8 })[0].linePitch).toBe(
      16 * 1.8,
    );
  });

  it('never assigns the deprecated isHeading field in a walkthrough sample', async () => {
    const repoRoot = resolve(import.meta.dirname, '../../..');
    // Matches an object-literal assignment, not the `isHeading: boolean`
    // declaration in the printed `RenderParagraph` interface.
    const assignment = /isHeading\s*:\s*(?:true|false|!|Boolean)/u;
    for (const locale of ['en', 'ja']) {
      const path = `docs/${locale}/07-pagination-and-rendering.md`;
      const text = await readFile(resolve(repoRoot, path), 'utf8');
      const fences = [...text.matchAll(/```ts\n([\s\S]*?)```/gu)];
      expect(fences.length, `${path} has no TypeScript samples`).toBeGreaterThan(0);
      for (const fence of fences) {
        expect(fence[1], `${path} still assigns isHeading in a sample`).not.toMatch(assignment);
      }
    }
  });
});
