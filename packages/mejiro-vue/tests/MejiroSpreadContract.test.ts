// @vitest-environment happy-dom

import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroSpread } from '../src/MejiroSpread.js';
import { pageResult, selectionRect } from './helpers/fixtures.js';

const spread = (): SpreadResult => ({
  right: pageResult('右頁'),
  left: pageResult('左頁'),
  pageCount: 2,
});

/** Layout stub carrying only what the components read for their defaults. */
const measuredLayout = {
  geometry: {
    pageWidth: 300,
    lineWidth: 400,
    paddingX: 10,
    paddingY: 20,
    pageHeight: 440,
    contentHeight: 400,
  },
  typography: { fontFamily: 'serif', fontSize: 18, lineSpacing: 2 },
} as unknown as ChapterLayout;

describe('MejiroSpread (Vue) — spread mode', () => {
  it('shows one page in single mode, on the side singleSide names', () => {
    const { container } = render(MejiroSpread, {
      props: { spread: spread(), layout: measuredLayout, spreadMode: 'single', singleSide: 'left' },
    });

    const pages = container.querySelectorAll('.mejiro-reader-page');
    expect(pages).toHaveLength(1);
    expect(pages[0].classList.contains('mejiro-reader-page--left')).toBe(true);
    expect(container.querySelector('.mejiro-reader-spread--single')).not.toBeNull();
  });

  it('shows the right page in single mode when singleSide is null', () => {
    const { container } = render(MejiroSpread, {
      props: { spread: spread(), layout: measuredLayout, spreadMode: 'single', singleSide: null },
    });

    const pages = container.querySelectorAll('.mejiro-reader-page');
    expect(pages).toHaveLength(1);
    expect(pages[0].classList.contains('mejiro-reader-page--right')).toBe(true);
  });

  it('shows both pages in the default double mode', () => {
    const { container } = render(MejiroSpread, {
      props: { spread: spread(), layout: measuredLayout, singleSide: null },
    });
    expect(container.querySelectorAll('.mejiro-reader-page')).toHaveLength(2);
  });
});

describe('MejiroSpread (Vue) — layout defaults', () => {
  it('takes page geometry and typography from the layout, explicit props winning', () => {
    const { container } = render(MejiroSpread, {
      props: { spread: spread(), layout: measuredLayout, fontSize: 14 },
    });

    const page = container.querySelector<HTMLElement>('.mejiro-reader-page');
    const content = container.querySelector<HTMLElement>('.mejiro-reader-page-content');
    expect(page?.style.width).toBe('300px');
    expect(page?.style.height).toBe('440px');
    expect(content?.style.height).toBe('400px');
    expect(content?.style.fontFamily).toBe('serif');
    expect(content?.style.lineHeight).toBe('2');
    expect(content?.style.fontSize).toBe('14px');
  });
});

describe('MejiroSpread (Vue) — selection and overlays', () => {
  it('paints the selection rectangles of the spread at spreadIndex', () => {
    const { container } = render(MejiroSpread, {
      props: {
        spread: spread(),
        layout: measuredLayout,
        spreadIndex: 2,
        selectionRects: [selectionRect({ spreadIndex: 2 }), selectionRect({ spreadIndex: 0 })],
      },
    });
    expect(container.querySelectorAll('.mejiro-selection-rect')).toHaveLength(1);
  });

  it('reports a drag selection through update:selection, resolving a spread point', () => {
    const anchorAtCoord = vi.fn(() => ({ paragraphIndex: 0, charIndex: 0 }));
    const onUpdateSelection = vi.fn();
    const { container } = render(MejiroSpread, {
      props: {
        spread: spread(),
        layout: measuredLayout,
        anchorAtCoord,
        'onUpdate:selection': onUpdateSelection,
      },
    });
    const spreadEl = container.querySelector('.mejiro-reader-spread') as HTMLElement;
    spreadEl.setPointerCapture = vi.fn();
    const content = container.querySelector('.mejiro-reader-page-content') as HTMLElement;

    content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));

    expect(anchorAtCoord).toHaveBeenCalledWith({ x: expect.any(Number), y: expect.any(Number) });
    expect(onUpdateSelection).toHaveBeenCalledWith(null);
  });

  it('forwards overlay presses as image-pointer-down and image-resize-pointer-down', () => {
    const onImagePointerDown = vi.fn();
    const onImageResizePointerDown = vi.fn();
    const { container } = render(MejiroSpread, {
      props: {
        spread: spread(),
        layout: measuredLayout,
        images: [{ id: 'img', rect: { x: 10, y: 10, width: 40, height: 50 } }],
        onImagePointerDown,
        onImageResizePointerDown,
      },
    });
    const overlay = container.querySelector('.mejiro-reader-image-overlay') as HTMLElement;
    const handle = container.querySelector('.mejiro-reader-image-overlay-resize') as HTMLElement;

    overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: false }));
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: false }));

    expect(overlay.style.width).toBe('40px');
    expect(onImagePointerDown).toHaveBeenCalledWith('img', expect.any(PointerEvent));
    expect(onImageResizePointerDown).toHaveBeenCalledWith('img', expect.any(PointerEvent));
  });
});

describe('MejiroSpread (Vue) — public types', () => {
  it('takes the resolved spread mode, read-only arrays and the named rectangle types', () => {
    expectTypeErrors(
      `import type { SpreadResult } from '@libraz/mejiro/book';
import { type MejiroSpreadProps, type MultiImageItem, type ReaderAnnotation, type SelectionRect } from '@libraz/mejiro-vue';
declare const spread: SpreadResult;
const images: readonly MultiImageItem[] = [];
const rects: readonly SelectionRect[] = [];
const annotation: ReaderAnnotation = { chapterIndex: 0, start: { paragraphIndex: 0, charIndex: 0 }, end: { paragraphIndex: 0, charIndex: 1 }, color: 'red' };
void annotation;
const ok: MejiroSpreadProps = { spread, images, selectionRects: rects, spreadMode: 'single', singleSide: null, spreadIndex: 0 };
const point: MejiroSpreadProps = { spread, anchorAtCoord: (p) => (p.x > 0 ? null : null) };
const events: MejiroSpreadProps = { spread, 'onImage-pointer-down': (id: string, e: PointerEvent) => void [id, e], 'onUpdate:selection': () => {} };
void [ok, point, events];
const p1: MejiroSpreadProps = { spread, singlePage: true };
const p2: MejiroSpreadProps = { spread, spreadMode: 'auto' };
const p3: MejiroSpreadProps = { spread, spreadIdx: 0 };
const p4: MejiroSpreadProps = { spread, 'onImage-pointer-down': (id: number) => void id };
const p5: MejiroSpreadProps = { spread, onSelectionChange: () => {} };`,
      {
        fails: ['const p1', 'const p2', 'const p3', 'const p4', 'const p5'],
      },
    );
  });

  it('accepts read-only arrays wherever a primitive takes a list', () => {
    expectTypeErrors(
      `import type { ChapterLayout } from '@libraz/mejiro/book';
import type { FontChoice } from '@libraz/mejiro';
import type { MejiroScrollViewProps, MejiroSelectionLayerProps, MejiroSettingsPanelProps, MejiroShelfProps, MultiImageItem, SelectionRect, VolumeInfo } from '@libraz/mejiro-vue';
import { useLibrary } from '@libraz/mejiro-vue';
declare const layout: ChapterLayout;
const rects: readonly SelectionRect[] = [];
const images: readonly MultiImageItem[] = [];
const volumes: readonly VolumeInfo[] = [];
const fonts: readonly FontChoice[] = [];
const a: MejiroSelectionLayerProps = { rects, side: 'right' };
const b: MejiroScrollViewProps = { layout, images, selectionRects: rects };
const c: MejiroShelfProps = { volumes };
const d: MejiroSettingsPanelProps = { settings: { fontFamily: 'serif', fontSize: 16 }, fonts };
void [a, b, c, d, useLibrary({ volumes })];
const e: MejiroSelectionLayerProps = { rects: [{ spreadIdx: 0 }], side: 'right' };`,
      { fails: ['const e'] },
    );
  });

  it('types the payload of every event the primitives emit', () => {
    expectTypeErrors(
      `import type { AnchorRange } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import type { MejiroChapterNavProps, MejiroDropZoneProps, MejiroImagePlaceholderProps, MejiroShelfProps, MejiroSpreadProps, MejiroTocProps, VolumeInfo } from '@libraz/mejiro-vue';
import type { SpreadResult } from '@libraz/mejiro/book';
declare const epub: EpubBook;
declare const spread: SpreadResult;
const rect = { x: 0, y: 0, width: 1, height: 1 };
const ok1: MejiroImagePlaceholderProps = { rect, 'onOverlay-pointer-down': (e: PointerEvent) => void e, 'onResize-pointer-down': (e: PointerEvent) => void e, onClose: () => {} };
const ok2: MejiroTocProps = { epub, 'onChapter-select': (i: number) => void i };
const ok3: MejiroShelfProps = { volumes: [], 'onVolume-select': (v: VolumeInfo) => void v };
const ok4: MejiroChapterNavProps = { epub, chapterIndex: 0, 'onUpdate:chapterIndex': (i: number) => void i };
const ok5: MejiroDropZoneProps = { onFile: (f: File) => void f };
const ok6: MejiroSpreadProps = { spread, 'onUpdate:selection': (r: AnchorRange | null) => void r, onSwipe: (d: 'next' | 'prev') => void d };
void [ok1, ok2, ok3, ok4, ok5, ok6];
const bad1: MejiroImagePlaceholderProps = { rect, 'onOverlay-pointer-down': (e: string) => void e };
const bad2: MejiroTocProps = { epub, 'onChapter-select': (i: string) => void i };
const bad3: MejiroShelfProps = { volumes: [], 'onVolume-select': (v: string) => void v };
const bad4: MejiroDropZoneProps = { onFile: (f: string) => void f };
const bad5: MejiroSpreadProps = { spread, onSwipe: (d: number) => void d };`,
      { fails: ['const bad1', 'const bad2', 'const bad3', 'const bad4', 'const bad5'] },
    );
  });
});
