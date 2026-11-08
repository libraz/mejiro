import type { PageHeaderData } from '@libraz/mejiro';
import type {
  AnchorRange,
  AnchorRect,
  ChapterLayout,
  InChapterAnchor,
  SpreadPoint,
  SpreadResult,
} from '@libraz/mejiro/book';
import {
  type FontFamily,
  isPrimaryPointerPress,
  normalizeFontFamily,
} from '@libraz/mejiro/browser';
import {
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  type PropType,
  ref,
  toRaw,
  type VNode,
} from 'vue';
import { useI18n } from './i18n.js';
import { MejiroImagePlaceholder } from './MejiroImagePlaceholder.js';
import { MejiroPageView } from './MejiroPageView.js';
import { MejiroSelectionLayer } from './MejiroSelectionLayer.js';
import { type MultiImageItem, overlayPageSide } from './useImageOverlay.js';
import type { ResolvedSpreadMode } from './useSpread.js';

export type { PageHeaderData };

/**
 * A highlighted character box, as `ChapterLayout.selectionRects` returns it,
 * optionally with its own fill colour.
 */
export interface SelectionRect extends AnchorRect {
  /** CSS colour that fills this rectangle; the stylesheet's selection fill when absent. */
  color?: string;
}

/** A reader-side highlight over a range of one chapter. */
export interface ReaderAnnotation {
  /** Zero-based index of the chapter the range lies in. */
  chapterIndex: number;
  /** Start of the highlighted range. */
  start: InChapterAnchor;
  /** End of the highlighted range. */
  end: InChapterAnchor;
  /** CSS colour of the highlight; the stylesheet's selection fill when absent. */
  color?: string;
}

const OVERLAY_SELECTOR = '.mejiro-reader-image-overlay';
const CONTENT_SELECTOR = '.mejiro-reader-page-content';

/** The page content element under a client point, if any. */
function contentAtPoint(root: HTMLElement, x: number, y: number): HTMLElement | null {
  for (const content of root.querySelectorAll<HTMLElement>(CONTENT_SELECTOR)) {
    const r = content.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return content;
  }
  return null;
}

/**
 * Renders a two-page spread (or one page of it in single mode) with the
 * book frame, page chrome, navigation zones, and image overlays. Designed to be used inside a
 * `mejiro-reader-surface` element.
 *
 * The component is purely presentational — pair it with `useSpread`,
 * `useChapterLayout`, and `useImageOverlay` (or hand-roll equivalents)
 * to manage state. Given `layout`, page geometry and typography default to
 * the values that layout was measured with.
 */
export const MejiroSpread = defineComponent({
  name: 'MejiroSpread',
  props: {
    /** The spread data to render. */
    spread: {
      type: Object as PropType<SpreadResult>,
      required: true,
    },
    /**
     * Layout the spread comes from. Its `geometry` and `typography` supply the
     * page size and font props that are not given.
     */
    layout: { type: Object as PropType<ChapterLayout>, default: undefined },
    /** Width of each page in pixels. @defaultValue `layout.geometry.pageWidth` */
    pageWidth: { type: Number, default: undefined },
    /** Height of each page in pixels. @defaultValue `layout.geometry.pageHeight` */
    pageHeight: { type: Number, default: undefined },
    /**
     * Height of the content area (page minus padding) in pixels.
     * @defaultValue `layout.geometry.contentHeight`
     */
    contentHeight: { type: Number, default: undefined },
    /** CSS font family of the body content. @defaultValue `layout.typography.fontFamily` */
    fontFamily: { type: [String, Array] as PropType<FontFamily>, default: undefined },
    /** Line spacing multiplier. @defaultValue `layout.typography.lineSpacing` */
    lineSpacing: { type: Number, default: undefined },
    /** Font size of the body content in pixels. @defaultValue `layout.typography.fontSize` */
    fontSize: { type: Number, default: undefined },
    /** Whether to animate the page turn. */
    turning: { type: Boolean, default: false },
    /** Header data for the right page. */
    rightHeader: { type: Object as PropType<PageHeaderData>, default: () => ({}) },
    /** Header data for the left page. */
    leftHeader: { type: Object as PropType<PageHeaderData>, default: () => ({}) },
    /**
     * Image overlays on the current spread, relative to the right page. In
     * single mode, only those whose centre lies on the page shown are drawn.
     */
    images: { type: Array as PropType<readonly MultiImageItem[]>, default: () => [] },
    /**
     * Force slot-mode rendering on both pages even without images. When
     * omitted, each page falls through to `MejiroPageView`'s automatic choice:
     * slot mode for pages with images, native `writing-mode: vertical-rl`
     * otherwise.
     */
    slotMode: { type: Boolean, default: undefined },
    /**
     * Resolves a spread-local point to an in-chapter anchor. Typically
     * `(point) => layout.anchorAtCoord(spreadIndex, point)`. When provided
     * together with an `update:selection` handler, the spread enables
     * pointer-drag selection on the page content area.
     */
    anchorAtCoord: {
      type: Function as PropType<(point: SpreadPoint) => InChapterAnchor | null>,
      default: undefined,
    },
    /**
     * Zero-based index of the spread being rendered. Rectangles passed through
     * `selectionRects` carry spread-local coordinates, so this is what scopes
     * them to this spread. When omitted, every supplied rectangle is painted.
     */
    spreadIndex: { type: Number, default: undefined },
    /**
     * Selection rectangles to render as a highlight overlay. Entries whose
     * `spreadIndex` differs from the `spreadIndex` prop are ignored. An entry may
     * carry a `color` that becomes that rectangle's fill.
     */
    selectionRects: {
      type: Array as PropType<readonly SelectionRect[]>,
      default: undefined,
    },
    /**
     * `'single'` renders only one page of the spread (centered), chosen by
     * `singleSide`; `'double'` renders both. @defaultValue 'double'
     */
    spreadMode: { type: String as PropType<ResolvedSpreadMode>, default: 'double' },
    /**
     * Page of the spread shown in single mode, as `useSpread` reports it;
     * `null` (what `useSpread` reports in double mode) shows the right page.
     * @defaultValue null
     */
    singleSide: { type: String as PropType<'right' | 'left' | null>, default: null },
  },
  emits: {
    /** The previous-page zone was activated. */
    prev: () => true,
    /** The next-page zone was activated. */
    next: () => true,
    /** Pointer-down on an image overlay body. */
    'image-pointer-down': (_id: string, _e: PointerEvent) => true,
    /** Pointer-down on an image overlay's resize handle. */
    'image-resize-pointer-down': (_id: string, _e: PointerEvent) => true,
    /** An image overlay's remove button was activated. */
    'image-close': (_id: string) => true,
    /** The drag selection changed; `null` when a new drag starts. */
    'update:selection': (_range: AnchorRange | null) => true,
    /** A horizontal swipe over the spread. */
    swipe: (_direction: 'next' | 'prev') => true,
    /** A tap on the surface that hit no control. */
    'surface-tap': () => true,
  },
  setup(props, { emit, slots }) {
    const messages = useI18n();
    const instance = getCurrentInstance();
    let selection: { start: InChapterAnchor; pointerId: number } | null = null;

    // By coordinates, not by target: once the spread captures the pointer, every
    // event targets the spread root, which no page content is an ancestor of.
    function resolvePointer(e: PointerEvent): InChapterAnchor | null {
      if (!props.anchorAtCoord) return null;
      const content = contentAtPoint(e.currentTarget as HTMLElement, e.clientX, e.clientY);
      if (!content) return null;
      const pageEl = content.closest<HTMLElement>('.mejiro-reader-page');
      const isRight = pageEl?.classList.contains('mejiro-reader-page--right') ?? true;
      const rect = content.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      const spreadX = isRight ? offsetX : offsetX - rect.width;
      return props.anchorAtCoord({ x: spreadX, y: offsetY });
    }

    // A declared emit never reaches `attrs`, so the presence of an
    // `update:selection` handler is read off the current vnode.
    const selectionHandlerKeys = ['onUpdate:selection', 'onUpdate:selectionOnce'];

    function hasSelectionHandler(): boolean {
      const vnodeProps = instance?.vnode.props as Record<string, unknown> | null | undefined;
      if (!vnodeProps) return false;
      return selectionHandlerKeys.some((key) => vnodeProps[key] != null);
    }

    /**
     * Drag selection takes over pointer events on the page content, so it is
     * only enabled when the host asked for it: a coordinate resolver *and* an
     * `update:selection` handler. With `anchorAtCoord` alone (tap anchoring) the
     * page keeps native text selection.
     */
    function selectionEnabled(): boolean {
      return props.anchorAtCoord != null && hasSelectionHandler();
    }

    function handlePointerDown(e: PointerEvent): void {
      if (!selectionEnabled() || selection) return;
      // Only a press on the text starts a selection; buttons and overlays keep theirs.
      if (!(e.target as HTMLElement | null)?.closest(CONTENT_SELECTOR)) return;
      const anchor = resolvePointer(e);
      if (!anchor) return;
      e.preventDefault();
      selection = { start: anchor, pointerId: e.pointerId };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      emit('update:selection', null);
    }

    function handlePointerMove(e: PointerEvent): void {
      const session = selection;
      if (!session || e.pointerId !== session.pointerId) return;
      const end = resolvePointer(e);
      if (!end) return;
      const { start } = session;
      if (end.paragraphIndex === start.paragraphIndex && end.charIndex === start.charIndex) return;
      emit('update:selection', { start, end });
    }

    // The one teardown path: pointerup, pointercancel and lost capture all end here, once.
    function endSelection(e: PointerEvent): void {
      const session = selection;
      if (!session || e.pointerId !== session.pointerId) return;
      selection = null;
      const el = e.currentTarget as HTMLElement;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    }

    const gestureStart = ref<{ x: number; y: number } | null>(null);
    // Set when a press ends as a swipe, so the click that press produces is not a second turn.
    let swiped = false;
    const SWIPE_THRESHOLD = 40;
    const TAP_MOVE_THRESHOLD = 8;
    function handleGesturePointerDown(e: PointerEvent): void {
      swiped = false;
      if (!isPrimaryPointerPress(e)) return;
      // A press on an overlay drags, resizes or removes it; it is never a page turn.
      if ((e.target as HTMLElement | null)?.closest(OVERLAY_SELECTOR)) return;
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
        swiped = true;
        emit('swipe', dx < 0 ? 'next' : 'prev');
        return;
      }
      if (ax < TAP_MOVE_THRESHOLD && ay < TAP_MOVE_THRESHOLD) {
        const target = e.target as HTMLElement | null;
        if (target?.closest(`button, a, ${OVERLAY_SELECTOR}`)) return;
        emit('surface-tap');
      }
    }
    function suppressSwipeClick(e: MouseEvent): void {
      if (!swiped) return;
      swiped = false;
      e.preventDefault();
      e.stopPropagation();
    }
    function combinedPointerDown(e: PointerEvent): void {
      handleGesturePointerDown(e);
      if (selectionEnabled()) handlePointerDown(e);
    }
    function combinedPointerUp(e: PointerEvent): void {
      handleGesturePointerUp(e);
      endSelection(e);
    }
    // A cancelled press is neither a tap nor a swipe.
    function combinedPointerCancel(e: PointerEvent): void {
      gestureStart.value = null;
      endSelection(e);
    }
    // Selection rectangles are spread-local, so painting an entry that belongs
    // to another spread would place it over unrelated text.
    const visibleRects = computed(() => {
      const rects = props.selectionRects;
      if (!rects) return undefined;
      if (props.spreadIndex == null) return rects;
      return rects.filter((r) => r.spreadIndex === props.spreadIndex);
    });

    const single = computed(() => props.spreadMode === 'single');
    const shownSide = computed<'right' | 'left'>(() => props.singleSide ?? 'right');
    const geometry = computed(() => toRaw(props.layout)?.geometry);
    const typography = computed(() => toRaw(props.layout)?.typography);
    const pageWidth = computed(() => props.pageWidth ?? geometry.value?.pageWidth ?? 0);
    const pageHeight = computed(() => props.pageHeight ?? geometry.value?.pageHeight ?? 0);
    const contentHeight = computed(() => props.contentHeight ?? geometry.value?.contentHeight ?? 0);
    const fontFamily = computed(() => props.fontFamily ?? typography.value?.fontFamily);
    const fontSize = computed(() => props.fontSize ?? typography.value?.fontSize);
    const lineSpacing = computed(() => props.lineSpacing ?? typography.value?.lineSpacing);

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
      // Image rects are relative to the right page, so both pages' overlays hang
      // off it; a page shown alone hosts only its own, the left one shifted a page width.
      const hostsImages = side === (single.value ? shownSide.value : 'right');
      const hosted = single.value
        ? props.images.filter((item) => overlayPageSide(item.rect) === shownSide.value)
        : props.images;
      const result = isRight ? props.spread.right : props.spread.left;
      const header = isRight ? props.rightHeader : props.leftHeader;
      const pageKey = `${side}-${header.pageNumber ?? 'blank'}`;
      const hasImages = hosted.length > 0;
      const contentStyle: Record<string, string | number> = {
        height: `${contentHeight.value}px`,
      };
      if (fontFamily.value) contentStyle.fontFamily = normalizeFontFamily(fontFamily.value);
      if (fontSize.value != null) contentStyle.fontSize = `${fontSize.value}px`;
      if (lineSpacing.value != null) contentStyle.lineHeight = String(lineSpacing.value);

      const overlays = hostsImages
        ? hosted.map((item) =>
            h(MejiroImagePlaceholder, {
              key: item.id,
              rect: isRight ? item.rect : { ...item.rect, x: item.rect.x + pageWidth.value },
              onOverlayPointerDown: (e: PointerEvent) => emit('image-pointer-down', item.id, e),
              onResizePointerDown: (e: PointerEvent) =>
                emit('image-resize-pointer-down', item.id, e),
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
            width: `${pageWidth.value}px`,
            height: `${pageHeight.value}px`,
            overflow: hostsImages && hasImages ? 'visible' : undefined,
          },
        },
        [
          h('div', { class: 'mejiro-reader-page-rule' }),
          slots.pageHeader ? slots.pageHeader({ side, header }) : renderHeader(header),
          h('div', { class: 'mejiro-reader-page-viewport' }, [
            h(
              'div',
              { class: 'mejiro-reader-page-clip', style: { height: `${contentHeight.value}px` } },
              [
                h(MejiroPageView, {
                  key: pageKey,
                  result,
                  slotMode: props.slotMode,
                  fontFamily: fontFamily.value,
                  lineSpacing: lineSpacing.value,
                  class: 'mejiro-reader-page-content',
                  style: contentStyle,
                }),
                visibleRects.value && visibleRects.value.length > 0
                  ? h(MejiroSelectionLayer, { rects: visibleRects.value, side })
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
              { 'is-turning': props.turning, 'mejiro-reader-spread--single': single.value },
            ],
            onPointerdown: combinedPointerDown,
            onPointermove: handlePointerMove,
            onPointerup: combinedPointerUp,
            onPointercancel: combinedPointerCancel,
            onLostpointercapture: endSelection,
            onClickCapture: suppressSwipeClick,
          },
          [
            renderPage(single.value ? shownSide.value : 'right'),
            single.value ? null : renderPage('left'),
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

/** Props accepted by {@link MejiroSpread}. */
export type MejiroSpreadProps = InstanceType<typeof MejiroSpread>['$props'];
