// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { InChapterAnchor, SpreadPoint, SpreadResult } from '@libraz/mejiro/book';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroSpread } from '../src/MejiroSpread.js';
import { pageResult, selectionRect } from './helpers/fixtures.js';

describe('MejiroSpread (React)', () => {
  it('leaves image-free pages in normal mode when slotMode is not given', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      pageCount: 2,
    };

    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread spread={spread} pageWidth={320} pageHeight={460} contentHeight={360} />
      </MejiroI18nProvider>,
    );

    expect(container.querySelectorAll('.mejiro-page-slots')).toHaveLength(0);
    expect(container.querySelectorAll('.mejiro-reader-page-content.mejiro-page')).toHaveLength(2);
  });

  it('forces slot rendering on both pages when slotMode is given', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      pageCount: 2,
    };

    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread
          spread={spread}
          pageWidth={320}
          pageHeight={460}
          contentHeight={360}
          slotMode
        />
      </MejiroI18nProvider>,
    );

    expect(container.querySelectorAll('.mejiro-page-slots')).toHaveLength(2);
    expect(container.querySelector('.mejiro-reader-page-content.mejiro-page')).toBeNull();
    expect(container.querySelector('br')).toBeNull();
  });

  it('paints only the selection rectangles that belong to the rendered spread', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      pageCount: 2,
    };
    const rects = [selectionRect({ spreadIndex: 0 }), selectionRect({ spreadIndex: 3, y: 60 })];

    const { container, rerender } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread
          spread={spread}
          pageWidth={320}
          pageHeight={460}
          contentHeight={360}
          spreadIndex={3}
          selectionRects={rects}
        />
      </MejiroI18nProvider>,
    );

    const onSpread3 = [...container.querySelectorAll<HTMLElement>('.mejiro-selection-rect')];
    expect(onSpread3).toHaveLength(1);
    expect(onSpread3[0]?.style.top).toBe('60px');

    rerender(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread
          spread={spread}
          pageWidth={320}
          pageHeight={460}
          contentHeight={360}
          spreadIndex={0}
          selectionRects={rects}
        />
      </MejiroI18nProvider>,
    );

    const onSpread0 = [...container.querySelectorAll<HTMLElement>('.mejiro-selection-rect')];
    expect(onSpread0).toHaveLength(1);
    expect(onSpread0[0]?.style.top).toBe('20px');
  });

  it('still slot-renders a page that carries images without slotMode', () => {
    const withImages = { ...pageResult('右頁'), hasImages: true };
    const spread: SpreadResult = {
      right: withImages,
      left: pageResult('左頁'),
      pageCount: 2,
    };

    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread spread={spread} pageWidth={320} pageHeight={460} contentHeight={360} />
      </MejiroI18nProvider>,
    );

    expect(
      container.querySelectorAll('.mejiro-reader-page--right .mejiro-page-slots'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(
        '.mejiro-reader-page--left .mejiro-reader-page-content.mejiro-page',
      ),
    ).toHaveLength(1);
  });

  it('keeps native text selection when only anchorAtCoord is given', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      pageCount: 2,
    };
    const anchorAtCoord = vi.fn(() => ({ paragraphIndex: 0, charIndex: 0 }));

    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread
          spread={spread}
          pageWidth={320}
          pageHeight={460}
          contentHeight={360}
          anchorAtCoord={anchorAtCoord}
        />
      </MejiroI18nProvider>,
    );
    const spreadEl = container.querySelector('.mejiro-reader-spread') as HTMLElement;
    const setPointerCapture = vi.fn();
    spreadEl.setPointerCapture = setPointerCapture;
    const content = container.querySelector('.mejiro-reader-page-content') as HTMLElement;

    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it('drag-selects when anchorAtCoord and onSelectionChange are both given', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      pageCount: 2,
    };
    const anchors: InChapterAnchor[] = [
      { paragraphIndex: 0, charIndex: 0 },
      { paragraphIndex: 0, charIndex: 5 },
    ];
    let call = 0;
    const anchorAtCoord = vi.fn(() => anchors[Math.min(call++, anchors.length - 1)] ?? null);
    const onSelectionChange = vi.fn();

    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread
          spread={spread}
          pageWidth={320}
          pageHeight={460}
          contentHeight={360}
          anchorAtCoord={anchorAtCoord}
          onSelectionChange={onSelectionChange}
        />
      </MejiroI18nProvider>,
    );
    const spreadEl = container.querySelector('.mejiro-reader-spread') as HTMLElement;
    spreadEl.setPointerCapture = vi.fn();
    spreadEl.hasPointerCapture = vi.fn(() => false);
    const content = container.querySelector('.mejiro-reader-page-content') as HTMLElement;

    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    content.dispatchEvent(down);
    content.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));

    expect(down.defaultPrevented).toBe(true);
    expect(spreadEl.setPointerCapture).toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenNthCalledWith(1, null);
    expect(onSelectionChange).toHaveBeenNthCalledWith(2, { start: anchors[0], end: anchors[1] });
  });

  describe('selection drag session', () => {
    function mountSelectable(onSurfaceTap?: () => void) {
      const spread: SpreadResult = {
        right: pageResult('右頁'),
        left: pageResult('左頁'),
        pageCount: 2,
      };
      let charIndex = 0;
      const anchorAtCoord = () => ({ paragraphIndex: 0, charIndex: charIndex++ });
      const onSelectionChange = vi.fn();
      const { container } = render(
        <MejiroI18nProvider messages={jaMessages}>
          <MejiroSpread
            spread={spread}
            pageWidth={320}
            pageHeight={460}
            contentHeight={360}
            anchorAtCoord={anchorAtCoord}
            onSelectionChange={onSelectionChange}
            onSurfaceTap={onSurfaceTap}
          />
        </MejiroI18nProvider>,
      );
      const spreadEl = container.querySelector('.mejiro-reader-spread') as HTMLElement;
      spreadEl.setPointerCapture = vi.fn();
      spreadEl.hasPointerCapture = vi.fn(() => false);
      const content = container.querySelector('.mejiro-reader-page-content') as HTMLElement;
      const fire = (type: string, pointerId: number) =>
        content.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, pointerId }),
        );
      return { fire, onSelectionChange };
    }

    it.each(['pointerup', 'pointercancel', 'lostpointercapture'])(
      'ends on %s so later moves leave the selection alone',
      (type) => {
        const { fire, onSelectionChange } = mountSelectable();
        fire('pointerdown', 1);
        fire('pointermove', 1);
        expect(onSelectionChange).toHaveBeenCalledTimes(2);
        fire(type, 1);
        fire('pointermove', 1);
        expect(onSelectionChange).toHaveBeenCalledTimes(2);
      },
    );

    it('does not treat a cancelled press as a surface tap', () => {
      const onSurfaceTap = vi.fn();
      const { fire } = mountSelectable(onSurfaceTap);
      fire('pointerdown', 1);
      fire('pointercancel', 1);
      expect(onSurfaceTap).not.toHaveBeenCalled();
    });

    it('ignores pointers other than the one that started the drag', () => {
      const { fire, onSelectionChange } = mountSelectable();
      fire('pointerdown', 1);
      fire('pointerdown', 2);
      fire('pointermove', 2);
      fire('pointerup', 2);
      expect(onSelectionChange).toHaveBeenCalledTimes(1);
      fire('pointermove', 1);
      expect(onSelectionChange).toHaveBeenCalledTimes(2);
    });
  });

  it('prints each page number in its own running head and hides it when null', () => {
    const spread: SpreadResult = {
      right: pageResult('右頁'),
      left: pageResult('左頁'),
      pageCount: 2,
    };

    // A null pageNumber is how `pageNumbers="right"` suppresses the left folio.
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroSpread
          spread={spread}
          pageWidth={320}
          pageHeight={460}
          contentHeight={360}
          rightHeader={{ title: 'Book', pageNumber: 7 }}
          leftHeader={{ title: 'Chapter', pageNumber: null }}
        />
      </MejiroI18nProvider>,
    );

    const rightNum = container.querySelector(
      '.mejiro-reader-page--right .mejiro-reader-page-header-num',
    );
    const leftNum = container.querySelector(
      '.mejiro-reader-page--left .mejiro-reader-page-header-num',
    );
    expect(rightNum?.textContent).toBe('7');
    expect(leftNum?.textContent).toBe('');
  });
});

describe('MejiroSpread (React) — overlays and pointer sessions', () => {
  const twoPages = (): SpreadResult => ({
    right: pageResult('右頁'),
    left: pageResult('左頁'),
    pageCount: 2,
  });
  const rectAt = (left: number) => () =>
    ({ left, right: left + 320, top: 0, bottom: 360, width: 320, height: 360 }) as DOMRect;

  it('never turns the page for a sideways drag that starts on an overlay', () => {
    const onSwipe = vi.fn();
    const { container } = render(
      <MejiroSpread
        spread={twoPages()}
        pageWidth={320}
        pageHeight={460}
        contentHeight={360}
        images={[{ id: 'img', rect: { x: 80, y: 100, width: 120, height: 160 } }]}
        onImagePointerDown={vi.fn()}
        onSwipe={onSwipe}
      />,
    );
    const spreadEl = container.querySelector('.mejiro-reader-spread') as HTMLElement;
    const overlay = container.querySelector('.mejiro-reader-image-overlay') as HTMLElement;
    const content = container.querySelector('.mejiro-reader-page-content') as HTMLElement;

    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(spreadEl, { clientX: 200, clientY: 200 });
    expect(onSwipe).not.toHaveBeenCalled();

    // The same gesture on the text does turn the page.
    fireEvent.pointerDown(content, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(spreadEl, { clientX: 200, clientY: 200 });
    expect(onSwipe).toHaveBeenCalledWith('next');
  });

  it('turns once for a drag-swipe that starts and ends on a nav zone', () => {
    const onSwipe = vi.fn();
    const onNext = vi.fn();
    const { container } = render(
      <MejiroSpread
        spread={twoPages()}
        pageWidth={320}
        pageHeight={460}
        contentHeight={360}
        onSwipe={onSwipe}
        onNext={onNext}
      />,
    );
    const zone = container.querySelector('.mejiro-reader-nav-zone--next') as HTMLElement;

    // A mouse drag ends with the click the browser dispatches on the zone.
    fireEvent.pointerDown(zone, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(zone, { clientX: 200, clientY: 200 });
    fireEvent.click(zone);
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();

    // The next press is a plain click again.
    fireEvent.pointerDown(zone, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(zone, { clientX: 300, clientY: 200 });
    fireEvent.click(zone);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('draws only the overlays whose centre lies on the single page shown', () => {
    const images = [
      { id: 'on-right', rect: { x: 80, y: 100, width: 120, height: 160 } },
      { id: 'on-left', rect: { x: -200, y: 100, width: 120, height: 160 } },
    ];
    const { container, rerender } = render(
      <MejiroSpread
        spread={twoPages()}
        pageWidth={320}
        pageHeight={460}
        contentHeight={360}
        images={images}
        spreadMode="single"
        singleSide="left"
      />,
    );
    let overlays = container.querySelectorAll<HTMLElement>('.mejiro-reader-image-overlay');
    expect(overlays).toHaveLength(1);
    expect(overlays[0].style.left).toBe('120px');

    rerender(
      <MejiroSpread
        spread={twoPages()}
        pageWidth={320}
        pageHeight={460}
        contentHeight={360}
        images={images}
        spreadMode="single"
        singleSide="right"
      />,
    );
    overlays = container.querySelectorAll<HTMLElement>('.mejiro-reader-image-overlay');
    expect(overlays).toHaveLength(1);
    expect(overlays[0].style.left).toBe('80px');
  });

  it('resolves a captured drag by coordinates, across to the other page', () => {
    const anchorAtCoord = vi.fn((point: SpreadPoint) => ({
      paragraphIndex: 0,
      charIndex: point.x < 0 ? 9 : 1,
    }));
    const onSelectionChange = vi.fn();
    const { container } = render(
      <MejiroSpread
        spread={twoPages()}
        pageWidth={320}
        pageHeight={460}
        contentHeight={360}
        anchorAtCoord={anchorAtCoord}
        onSelectionChange={onSelectionChange}
      />,
    );
    const spreadEl = container.querySelector('.mejiro-reader-spread') as HTMLElement;
    spreadEl.setPointerCapture = vi.fn();
    spreadEl.hasPointerCapture = vi.fn(() => false);
    const [right, left] = container.querySelectorAll<HTMLElement>('.mejiro-reader-page-content');
    right.getBoundingClientRect = rectAt(320);
    left.getBoundingClientRect = rectAt(0);

    fireEvent.pointerDown(right, { pointerId: 1, clientX: 600, clientY: 10 });
    // Once captured, the browser targets every later event at the spread root.
    fireEvent.pointerMove(spreadEl, { pointerId: 1, clientX: 100, clientY: 20 });

    expect(anchorAtCoord).toHaveBeenLastCalledWith({ x: -220, y: 20 });
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      start: { paragraphIndex: 0, charIndex: 1 },
      end: { paragraphIndex: 0, charIndex: 9 },
    });
  });
});
