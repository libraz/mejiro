import type { PageHeaderData } from '@libraz/mejiro';
import type { AnchorRange, AnchorRect, InChapterAnchor, SpreadResult } from '@libraz/mejiro/book';
import { type FontFamily, normalizeFontFamily } from '@libraz/mejiro/browser';
import { defineComponent, h, type PropType, ref, type VNode } from 'vue';
import { useI18n } from './i18n.js';
import { MejiroImageOverlay } from './MejiroImageOverlay.js';
import { MejiroPageView } from './MejiroPageView.js';
import { MejiroSelectionLayer } from './MejiroSelectionLayer.js';
import type { MultiImageItem } from './useMultiImageOverlay.js';

export type { PageHeaderData };

/**
 * Renders a two-page spread with the book frame, page chrome, navigation
 * zones, and image overlays. Designed to be used inside a
 * `mejiro-reader-surface` element.
 *
 * The component is purely presentational — pair it with `useSpread`,
 * `useChapterLayout`, and `useMultiImageOverlay` (or hand-roll equivalents)
 * to manage state.
 */
export const MejiroSpread = defineComponent({
  name: 'MejiroSpread',
  props: {
    /** The spread data to render. */
    spread: {
      type: Object as PropType<SpreadResult>,
      required: true,
    },
    /** Width of each page in pixels. */
    pageWidth: { type: Number, required: true },
    /** Height of each page in pixels. */
    pageHeight: { type: Number, required: true },
    /** Height of the content area (page minus padding) in pixels. */
    contentHeight: { type: Number, required: true },
    /** CSS font family for slot-mode rendering. */
    fontFamily: { type: [String, Array] as PropType<FontFamily>, default: undefined },
    /** Line spacing multiplier (slot mode). */
    lineSpacing: { type: Number, default: undefined },
    /** Font size override applied to the body content. */
    fontSize: { type: Number, default: undefined },
    /** Whether to animate the page turn. */
    turning: { type: Boolean, default: false },
    /** Header data for the right page. */
    rightHeader: { type: Object as PropType<PageHeaderData>, default: () => ({}) },
    /** Header data for the left page. */
    leftHeader: { type: Object as PropType<PageHeaderData>, default: () => ({}) },
    /** Image overlays on the current spread (for the right page coordinate space). */
    images: { type: Array as PropType<MultiImageItem[]>, default: () => [] },
    /** Force slot-mode rendering on both pages even without images. */
    slotMode: { type: Boolean, default: false },
    /**
     * Resolves a spread-local pixel coordinate to an in-chapter anchor.
     * Typically `(x, y) => layout.anchorAtCoord(spreadIdx, x, y)`. When provided
     * together with the `selection-change` event handler, the spread enables
     * pointer-drag selection on the page content area.
     */
    anchorAtCoord: {
      type: Function as PropType<(x: number, y: number) => InChapterAnchor | null>,
      default: undefined,
    },
    /** Selection rectangles to render as a highlight overlay. */
    selectionRects: { type: Array as PropType<readonly AnchorRect[]>, default: undefined },
    /**
     * Hide the left page and render only the right page. Use this for
     * portrait viewports or when explicit single-page mode is requested.
     */
    singlePage: { type: Boolean, default: false },
  },
  emits: {
    prev: () => true,
    next: () => true,
    'image-pointerdown': (_id: string, _e: PointerEvent) => true,
    'image-resize-pointerdown': (_id: string, _e: PointerEvent) => true,
    'image-close': (_id: string) => true,
    'selection-change': (_range: AnchorRange | null) => true,
    swipe: (_direction: 'next' | 'prev') => true,
    'surface-tap': () => true,
  },
  setup(props, { emit, slots }) {
    const messages = useI18n();
    const selectionStart = ref<InChapterAnchor | null>(null);

    function resolvePointer(e: PointerEvent): InChapterAnchor | null {
      if (!props.anchorAtCoord) return null;
      const target = e.target as HTMLElement | null;
      if (!target) return null;
      const content = target.closest<HTMLElement>('.mejiro-reader-page-content');
      if (!content) return null;
      const pageEl = content.closest<HTMLElement>('.mejiro-reader-page');
      const isRight = pageEl?.classList.contains('mejiro-reader-page--right') ?? true;
      const rect = content.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      const spreadX = isRight ? offsetX : offsetX - rect.width;
      return props.anchorAtCoord(spreadX, offsetY);
    }

    function selectionEnabled(): boolean {
      return props.anchorAtCoord != null;
    }

    function handlePointerDown(e: PointerEvent): void {
      if (!selectionEnabled()) return;
      const anchor = resolvePointer(e);
      if (!anchor) return;
      e.preventDefault();
      selectionStart.value = anchor;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      emit('selection-change', null);
    }

    function handlePointerMove(e: PointerEvent): void {
      if (!selectionEnabled()) return;
      const start = selectionStart.value;
      if (!start) return;
      const end = resolvePointer(e);
      if (!end) return;
      if (end.paragraph === start.paragraph && end.charIndex === start.charIndex) return;
      emit('selection-change', { start, end });
    }

    function handlePointerUp(e: PointerEvent): void {
      if (!selectionEnabled()) return;
      selectionStart.value = null;
      const el = e.currentTarget as HTMLElement;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    }

    const gestureStart = ref<{ x: number; y: number } | null>(null);
    const SWIPE_THRESHOLD = 40;
    const TAP_MOVE_THRESHOLD = 8;
    function handleGesturePointerDown(e: PointerEvent): void {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      gestureStart.value = { x: e.clientX, y: e.clientY };
    }
    function handleGesturePointerUp(e: PointerEvent): void {
      const start = gestureStart.value;
      gestureStart.value = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ax >= SWIPE_THRESHOLD && ax >= ay * 1.4) {
        emit('swipe', dx < 0 ? 'next' : 'prev');
        return;
      }
      if (ax < TAP_MOVE_THRESHOLD && ay < TAP_MOVE_THRESHOLD) {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, a, .mejiro-reader-image-overlay')) return;
        emit('surface-tap');
      }
    }
    function combinedPointerDown(e: PointerEvent): void {
      handleGesturePointerDown(e);
      if (selectionEnabled()) handlePointerDown(e);
    }
    function combinedPointerMove(e: PointerEvent): void {
      if (selectionEnabled()) handlePointerMove(e);
    }
    function combinedPointerUp(e: PointerEvent): void {
      handleGesturePointerUp(e);
      if (selectionEnabled()) handlePointerUp(e);
    }
    function renderHeader(data: PageHeaderData): VNode {
      return h('div', { class: 'mejiro-reader-page-header' }, [
        h('span', { class: 'mejiro-reader-page-header-title' }, data.title ?? ''),
        h(
          'span',
          { class: 'mejiro-reader-page-header-num' },
          data.pageNumber != null ? String(data.pageNumber) : '',
        ),
      ]);
    }

    function renderPage(side: 'right' | 'left'): VNode {
      const isRight = side === 'right';
      const result = isRight ? props.spread.right : props.spread.left;
      const header = isRight ? props.rightHeader : props.leftHeader;
      const pageKey = `${side}-${header.pageNumber ?? 'blank'}`;
      const hasImages = props.images.length > 0;
      const useSlot = true;
      const contentStyle: Record<string, string | number> = {
        height: `${props.contentHeight}px`,
      };
      if (props.fontFamily) contentStyle.fontFamily = normalizeFontFamily(props.fontFamily);
      if (props.fontSize != null) contentStyle.fontSize = `${props.fontSize}px`;
      if (props.lineSpacing != null) contentStyle.lineHeight = String(props.lineSpacing);

      const overlays = isRight
        ? props.images.map((item) =>
            h(MejiroImageOverlay, {
              key: item.id,
              rect: item.rect,
              onOverlayPointerdown: (e: PointerEvent) => emit('image-pointerdown', item.id, e),
              onResizePointerdown: (e: PointerEvent) =>
                emit('image-resize-pointerdown', item.id, e),
              onClose: () => emit('image-close', item.id),
            }),
          )
        : [];

      return h(
        'div',
        {
          key: pageKey,
          class: [
            'mejiro-reader-page',
            isRight ? 'mejiro-reader-page--right' : 'mejiro-reader-page--left',
          ],
          style: {
            width: `${props.pageWidth}px`,
            height: `${props.pageHeight}px`,
            overflow: isRight && hasImages ? 'visible' : undefined,
          },
        },
        [
          h('div', { class: 'mejiro-reader-page-rule' }),
          slots.pageHeader ? slots.pageHeader({ side, header }) : renderHeader(header),
          h('div', { class: 'mejiro-reader-page-viewport' }, [
            h(
              'div',
              { class: 'mejiro-reader-page-clip', style: { height: `${props.contentHeight}px` } },
              [
                h(MejiroPageView, {
                  key: pageKey,
                  result,
                  slotMode: useSlot,
                  fontFamily: props.fontFamily,
                  lineSpacing: props.lineSpacing,
                  class: 'mejiro-reader-page-content',
                  style: contentStyle,
                }),
                props.selectionRects && props.selectionRects.length > 0
                  ? h(MejiroSelectionLayer, { rects: props.selectionRects, side })
                  : null,
              ],
            ),
          ]),
          ...overlays,
        ],
      );
    }

    return () =>
      h('div', { class: 'mejiro-reader-book' }, [
        h(
          'div',
          {
            class: [
              'mejiro-reader-spread',
              { 'is-turning': props.turning, 'mejiro-reader-spread--single': props.singlePage },
            ],
            onPointerdown: combinedPointerDown,
            onPointermove: combinedPointerMove,
            onPointerup: combinedPointerUp,
            onPointercancel: combinedPointerUp,
          },
          [
            renderPage('right'),
            props.singlePage ? null : renderPage('left'),
            h('button', {
              type: 'button',
              class: 'mejiro-reader-nav-zone mejiro-reader-nav-zone--prev',
              'aria-label': messages.value.prevSpread,
              onClick: () => emit('prev'),
            }),
            h('button', {
              type: 'button',
              class: 'mejiro-reader-nav-zone mejiro-reader-nav-zone--next',
              'aria-label': messages.value.nextSpread,
              onClick: () => emit('next'),
            }),
            slots.indicator ? slots.indicator() : null,
          ],
        ),
      ]);
  },
});

export type MejiroSpreadProps = InstanceType<typeof MejiroSpread>['$props'];
