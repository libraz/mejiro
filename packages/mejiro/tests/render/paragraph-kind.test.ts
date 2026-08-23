import { describe, expect, it } from 'vitest';
import type { BookParagraph } from '../../src/book/types.js';
import type { PageSlice } from '../../src/paginate.js';
import * as renderBarrel from '../../src/render/index.js';
import { buildRenderPage } from '../../src/render/page.js';
import { paragraphClassName, renderEpubStatic } from '../../src/render/static.js';
import type { RenderEntry } from '../../src/render/types.js';

const CHAPTER: BookParagraph[] = [
  { text: '見出し', kind: 'heading', headingLevel: 2 },
  { text: '本文です', kind: 'body' },
  { text: '引用文です', kind: 'blockquote' },
  { text: '＊＊＊', kind: 'sceneBreak' },
  { text: 'const x = 1;', kind: 'pre' },
  { text: '図版キャプション', kind: 'figure' },
];

function entriesFor(paragraphs: readonly BookParagraph[]): RenderEntry[] {
  return paragraphs.map((p) => ({
    chars: [...p.text],
    breakPoints: new Uint32Array([]),
    inlineAnnotations: p.inlineAnnotations ?? [],
    isHeading: p.headingLevel != null || p.kind === 'heading',
    headingLevel: p.headingLevel,
    kind: p.kind,
  }));
}

function slicesFor(paragraphs: readonly BookParagraph[]): PageSlice[] {
  return paragraphs.map((_, i) => ({ paragraphIndex: i, lineStart: 0, lineEnd: 1 }));
}

function staticParagraphClasses(html: string): string[] {
  return [...html.matchAll(/<div class="(mejiro-paragraph[^"]*)"/g)].map((m) => m[1]);
}

describe('paragraph kind in the page pipeline', () => {
  it('keeps the structural kind of every paragraph on the render page', () => {
    const page = buildRenderPage(slicesFor(CHAPTER), entriesFor(CHAPTER));

    expect(page.paragraphs.map((p) => p.kind)).toEqual([
      'heading',
      'body',
      'blockquote',
      'sceneBreak',
      'pre',
      'figure',
    ]);
  });

  it('produces the same paragraph classes as the static renderer', () => {
    const page = buildRenderPage(slicesFor(CHAPTER), entriesFor(CHAPTER));
    const fromPage = page.paragraphs.map((p) => paragraphClassName(p.kind, p.headingLevel));

    expect(fromPage).toEqual(staticParagraphClasses(renderEpubStatic({ paragraphs: CHAPTER })));
    expect(fromPage).toContain('mejiro-paragraph mejiro-paragraph--blockquote');
    expect(fromPage).toContain('mejiro-paragraph mejiro-paragraph--scene-break');
    expect(fromPage).toContain('mejiro-paragraph mejiro-paragraph--pre');
    expect(fromPage).toContain('mejiro-paragraph mejiro-paragraph--figure');
    expect(fromPage).toContain('mejiro-paragraph mejiro-paragraph--h2');
  });

  it('reaches the class-name rule from the render entry point', () => {
    // Framework page components import it from `@libraz/mejiro/render`; without
    // the re-export they fall back to a private copy of the naming rule.
    expect(renderBarrel.paragraphClassName).toBe(paragraphClassName);
  });

  it('lets headingLevel win over kind and leaves body unmodified', () => {
    expect(paragraphClassName('blockquote', 3)).toBe('mejiro-paragraph mejiro-paragraph--h3');
    expect(paragraphClassName('body')).toBe('mejiro-paragraph');
    expect(paragraphClassName(undefined)).toBe('mejiro-paragraph');
    expect(paragraphClassName('heading')).toBe('mejiro-paragraph mejiro-paragraph--heading');
  });
});
