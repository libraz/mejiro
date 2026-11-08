// @vitest-environment happy-dom

import type { PageSlice } from '@libraz/mejiro';
import {
  type BookParagraph,
  type ChapterLayout,
  type ChapterLayoutSnapshot,
  MejiroBook,
} from '@libraz/mejiro/book';
import {
  buildRenderPage,
  paragraphClassName,
  type RenderEntry,
  renderEpubStatic,
} from '@libraz/mejiro/render';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { MejiroPage } from '../src/MejiroPage.js';
import { MejiroPageView } from '../src/MejiroPageView.js';

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

/** A real layout of `paragraphs`, one line each, with h2 set to scale 2. */
function layoutFor(paragraphs: readonly BookParagraph[]): ChapterLayout {
  const snapshot: ChapterLayoutSnapshot = {
    version: 3,
    config: {
      fontSize: 10,
      lineSpacing: 1,
      headingScale: 1.4,
      headingStyles: { 2: { scale: 2 } },
      kinsoku: 'strict',
      enableHanging: true,
    },
    size: { pageWidth: 400, lineWidth: 400, paddingX: 0, paddingY: 0 },
    paragraphs: paragraphs.map((p) => ({
      text: p.text,
      advances: Array.from({ length: [...p.text].length }, () => 10),
      breakPoints: [],
      inlineAnnotations: [],
      ...(p.headingLevel != null ? { headingLevel: p.headingLevel } : {}),
      ...(p.kind && p.kind !== 'body' ? { kind: p.kind } : {}),
    })),
  };
  return new MejiroBook({ fontFamily: 'serif', fontSize: 10 }).layoutFromSnapshot(snapshot);
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

  it('styles a heading paragraph without a level as a heading from the page data alone', () => {
    const page = buildRenderPage(
      [{ paragraphIndex: 0, lineStart: 0, lineEnd: 1 }],
      [
        {
          chars: [...'見出しのみ'],
          breakPoints: new Uint32Array([]),
          inlineAnnotations: [],
          kind: 'heading',
        },
      ],
    );
    const wrapper = mount(MejiroPage, { props: { page } });

    expect(wrapper.findAll('.mejiro-paragraph').map((el) => el.attributes('class'))).toEqual([
      paragraphClassName('heading'),
    ]);
  });

  it('gives slot-mode columns the classes flow mode gives their paragraphs', () => {
    const result = layoutFor(CHAPTER).getPage(0);
    const classes = (slotMode: boolean) =>
      mount(MejiroPageView, { props: { result, slotMode } })
        .findAll('.mejiro-paragraph')
        .map((el) => el.attributes('class'));

    expect(classes(false)).toHaveLength(CHAPTER.length);
    expect(classes(true)).toEqual(classes(false));
  });

  it('draws a heading at the scale its layout measured', () => {
    const result = layoutFor(CHAPTER).getPage(0);
    const wrapper = mount(MejiroPage, { props: { page: result.page } });

    const heading = wrapper.find('.mejiro-paragraph--h2').element as HTMLElement;
    expect(heading.style.getPropertyValue('--mejiro-paragraph-scale')).toBe('2');
    const body = wrapper.find('.mejiro-paragraph--blockquote').element as HTMLElement;
    expect(body.style.getPropertyValue('--mejiro-paragraph-scale')).toBe('');
  });
});
