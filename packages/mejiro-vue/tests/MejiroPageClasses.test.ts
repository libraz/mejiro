// @vitest-environment happy-dom

import type { PageSlice } from '@libraz/mejiro';
import type { BookParagraph } from '@libraz/mejiro/book';
import {
  buildRenderPage,
  paragraphClassName,
  type RenderEntry,
  renderEpubStatic,
} from '@libraz/mejiro/render';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { MejiroPage } from '../src/MejiroPage.js';

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
  return [...html.matchAll(/<div class="(mejiro-paragraph[^"]*)"/gu)].map((m) => m[1]);
}

describe('MejiroPage paragraph classes', () => {
  it('emits the same class set as the static renderer', () => {
    const page = buildRenderPage(slicesFor(CHAPTER), entriesFor(CHAPTER));
    const wrapper = mount(MejiroPage, { props: { page } });

    const classes = wrapper.findAll('.mejiro-paragraph').map((el) => el.attributes('class'));
    expect(classes).toEqual(staticParagraphClasses(renderEpubStatic({ paragraphs: CHAPTER })));
    expect(classes).toContain('mejiro-paragraph mejiro-paragraph--blockquote');
    expect(classes).toContain('mejiro-paragraph mejiro-paragraph--scene-break');
    expect(classes).toContain('mejiro-paragraph mejiro-paragraph--pre');
    expect(classes).toContain('mejiro-paragraph mejiro-paragraph--figure');
    expect(classes).toContain('mejiro-paragraph mejiro-paragraph--h2');
  });

  it('falls back to the heading kind for a page that carries no kind', () => {
    const page = buildRenderPage(
      [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }],
      [
        {
          chars: [...'見出しのみ'],
          breakPoints: new Uint32Array([]),
          inlineAnnotations: [],
          isHeading: true,
        },
      ],
    );
    const wrapper = mount(MejiroPage, { props: { page } });

    expect(wrapper.findAll('.mejiro-paragraph').map((el) => el.attributes('class'))).toEqual([
      paragraphClassName('heading'),
    ]);
  });
});
