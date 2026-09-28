import type { PageHeaderData } from '@libraz/mejiro';
import type { AnchorRange, AnchorRect, InChapterAnchor, SpreadResult } from '@libraz/mejiro/book';
import {
  type FontFamily,
  isPrimaryPointerPress,
  normalizeFontFamily,
} from '@libraz/mejiro/browser';
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useRef,
} from 'react';
import { useI18n } from './i18n.js';
import { MejiroImageOverlay } from './MejiroImageOverlay.js';
import { MejiroPageView } from './MejiroPageView.js';
import { MejiroSelectionLayer } from './MejiroSelectionLayer.js';
import { type MultiImageItem, overlayPageSide } from './useMultiImageOverlay.js';

export type { PageHeaderData };

/** Props for {@link MejiroSpread}. */
export interface MejiroSpreadProps {
  /** Spread data to render. */
  spread: SpreadResult;
  /** Page width (px). */
  pageWidth: number;
  /** Page height (px). */
  pageHeight: number;
  /** Content area height (px). */
  contentHeight: number;
  /** CSS font family applied to the content. */
  fontFamily?: FontFamily;
  /** Font size override (px). */
  fontSize?: number;
  /** Line spacing multiplier (slot mode). */
  lineSpacing?: number;
  /** Animate the page turn. */
  turning?: boolean;
  /** Header data for the right page. */
  rightHeader?: PageHeaderData;
  /** Header data for the left page. */
  leftHeader?: PageHeaderData;
  /**
   * Image overlays on the current spread, relative to the right page. With
   * {@link MejiroSpreadProps.singlePage}, only those whose centre lies on the
   * page shown are drawn.
   */
  images?: MultiImageItem[];
  /**
   * Force slot-mode rendering on both pages. When omitted, each page falls
   * through to {@link MejiroPageView}'s automatic choice: slot mode for pages
   * with images, native `writing-mode: vertical-rl` otherwise.
   */
  slotMode?: boolean;
  /** Custom renderer for per-page headers. */
  renderPageHeader?: (side: 'right' | 'left', header: PageHeaderData) => ReactNode;
  /** Custom indicator placed inside the spread (e.g. {@link MejiroPageIndicator}). */
  indicator?: ReactNode;
  /** Called when the previous-page zone is clicked. */
  onPrev?: () => void;
  /** Called when the next-page zone is clicked. */
  onNext?: () => void;
  /** Pointer-down on an image overlay. */
  onImagePointerDown?: (id: string, e: ReactPointerEvent) => void;
  /** Pointer-down on an image resize handle. */
  onImageResizePointerDown?: (id: string, e: ReactPointerEvent) => void;
  /** Image overlay close button. */
  onImageClose?: (id: string) => void;
  /**
   * Resolves a spread-local pixel coordinate to an in-chapter anchor.
   * Typically `(x, y) => layout.anchorAtCoord(spreadIdx, x, y)`. When provided
   * together with {@link MejiroSpreadProps.onSelectionChange}, the spread
   * enables pointer-drag selection on the page content area.
   */
  anchorAtCoord?: (x: number, y: number) => InChapterAnchor | null;
  /**
   * Zero-based index of the spread being rendered. Rectangles passed through
   * {@link MejiroSpreadProps.selectionRects} carry spread-local coordinates,
   * so this is what scopes them to this spread. When omitted, every supplied
   * rectangle is painted.
   */
  spreadIdx?: number;
  /**
   * Selection rectangles to render as a highlight overlay. Compute via
   * {@link ChapterLayout.selectionRects}. Entries whose `spreadIdx` differs
   * from {@link MejiroSpreadProps.spreadIdx} are ignored. An entry may carry
   * a `color` that becomes that rectangle's fill.
   */
  selectionRects?: readonly (AnchorRect & { color?: string })[];
  /**
   * Called when the user drags-selects text on the spread.
   * Called with `null` on a single-click (caret) where start equals end.
   */
  onSelectionChange?: (range: AnchorRange | null) => void;
  /**
   * Render only one page of the spread (centered), chosen by
   * {@link MejiroSpreadProps.singleSide}. Use this for portrait viewports or
   * when a reader explicitly opts into single-page mode.
   */
  singlePage?: boolean;
  /**
   * Page of the spread shown when {@link MejiroSpreadProps.singlePage} is set
   * (`useSpread` reports it as `singleSide`). @defaultValue 'right'
   */
  singleSide?: 'right' | 'left';
  /**
   * Called when the user makes a quick swipe gesture on the spread.
   * `direction === 'next'` means the user swiped from right to left (the
   * natural direction in vertical-rl for advancing).
   */
  onSwipe?: (direction: 'next' | 'prev') => void;
  /** Called when the user taps the center area without swiping. */
  onSurfaceTap?: () => void;
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

function defaultHeader(data: PageHeaderData): ReactNode {
  return (
    <div className="mejiro-reader-page-header">
      <span className="mejiro-reader-page-header-title">{data.title ?? ''}</span>
      <span className="mejiro-reader-page-header-num">
        {data.pageNumber != null ? String(data.pageNumber) : ''}
      </span>
    </div>
  );
}

/**
 * Renders a two-page spread (or one page of it in single-page mode) with the
 * book frame, page chrome, navigation zones, and image overlays. Used inside
 * `mejiro-reader-surface`.
 */
export function MejiroSpread({
  spread,
  pageWidth,
  pageHeight,
  contentHeight,
  fontFamily,
  fontSize,
  lineSpacing,
  turning = false,
  rightHeader = {},
  leftHeader = {},
  images = [],
  slotMode,
  renderPageHeader,
  indicator,
  onPrev,
  onNext,
  onImagePointerDown,
  onImageResizePointerDown,
  onImageClose,
  anchorAtCoord,
  spreadIdx,
  selectionRects,
  onSelectionChange,
  singlePage = false,
  singleSide = 'right',
  onSwipe,
  onSurfaceTap,
}: MejiroSpreadProps): ReactNode {
  const messages = useI18n();
  const selectionRef = useRef<{ start: InChapterAnchor; pointerId: number } | null>(null);
  const selectionEnabled = anchorAtCoord != null && onSelectionChange != null;
  const gestureRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const gestureEnabled = onSwipe != null || onSurfaceTap != null;
  const SWIPE_THRESHOLD = 40;
  const TAP_MOVE_THRESHOLD = 8;

  function handleGesturePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (!gestureEnabled) return;
    if (!isPrimaryPointerPress(e)) return;
    // A press on an overlay drags, resizes or removes it; it is never a page turn.
    if ((e.target as HTMLElement | null)?.closest(OVERLAY_SELECTOR)) return;
    gestureRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }

  function handleGesturePointerUp(e: ReactPointerEvent<HTMLDivElement>): void {
    if (!gestureEnabled) return;
    const start = gestureRef.current;
    gestureRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax >= SWIPE_THRESHOLD && ax >= ay * 1.4) {
      // Vertical-RL convention: swiping right-to-left advances the reader.
      onSwipe?.(dx < 0 ? 'next' : 'prev');
      return;
    }
    if (ax < TAP_MOVE_THRESHOLD && ay < TAP_MOVE_THRESHOLD) {
      // Only treat as surface tap if the press landed on a neutral zone
      // (the spread or pages themselves, not the buttons / overlays).
      const target = e.target as HTMLElement | null;
      if (target?.closest(`button, a, ${OVERLAY_SELECTOR}`)) return;
      onSurfaceTap?.();
    }
  }

  // By coordinates, not by target: once the spread captures the pointer, every
  // event targets the spread root, which no page content is an ancestor of.
  function resolvePointer(e: ReactPointerEvent<HTMLDivElement>): InChapterAnchor | null {
    if (!anchorAtCoord) return null;
    const content = contentAtPoint(e.currentTarget, e.clientX, e.clientY);
    if (!content) return null;
    const pageEl = content.closest<HTMLElement>('.mejiro-reader-page');
    const isRight = pageEl?.classList.contains('mejiro-reader-page--right') ?? true;
    const rect = content.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const spreadX = isRight ? offsetX : offsetX - rect.width;
    return anchorAtCoord(spreadX, offsetY);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (!selectionEnabled || selectionRef.current) return;
    // Only a press on the text starts a selection; buttons and overlays keep theirs.
    if (!(e.target as HTMLElement | null)?.closest(CONTENT_SELECTOR)) return;
    const anchor = resolvePointer(e);
    if (!anchor) return;
    e.preventDefault();
    selectionRef.current = { start: anchor, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectionChange?.(null);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const session = selectionRef.current;
    if (!session || e.pointerId !== session.pointerId) return;
    const end = resolvePointer(e);
    if (!end) return;
    const { start } = session;
    if (end.paragraph === start.paragraph && end.charIndex === start.charIndex) return;
    onSelectionChange?.({ start, end });
  }

  // The one teardown path: pointerup, pointercancel and lost capture all end here, once.
  function endSelection(e: ReactPointerEvent<HTMLDivElement>): void {
    const session = selectionRef.current;
    if (!session || e.pointerId !== session.pointerId) return;
    selectionRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const contentStyle: CSSProperties = { height: contentHeight };
  if (fontFamily) contentStyle.fontFamily = normalizeFontFamily(fontFamily);
  if (fontSize != null) contentStyle.fontSize = fontSize;
  if (lineSpacing != null) contentStyle.lineHeight = String(lineSpacing);

  // Selection rectangles are spread-local, so painting an entry that belongs
  // to another spread would place it over unrelated text.
  const visibleRects =
    selectionRects && spreadIdx != null
      ? selectionRects.filter((r) => r.spreadIdx === spreadIdx)
      : selectionRects;

  // Image rects are relative to the right page, so both pages' overlays hang off
  // it; a page shown alone hosts only its own, the left one shifted a page width.
  const imageSide = singlePage ? singleSide : 'right';
  const hostedImages = singlePage
    ? images.filter((item) => overlayPageSide(item.rect) === singleSide)
    : images;
  const hasImages = hostedImages.length > 0;

  const renderPage = (side: 'right' | 'left'): ReactNode => {
    const isRight = side === 'right';
    const hostsImages = side === imageSide;
    const result = isRight ? spread.right : spread.left;
    const header = isRight ? rightHeader : leftHeader;
    const pageKey = `${side}-${header.pageNumber ?? 'blank'}`;
    const pageStyle: CSSProperties = {
      width: pageWidth,
      height: pageHeight,
    };
    if (hostsImages && hasImages) pageStyle.overflow = 'visible';

    return (
      <div
        key={pageKey}
        className={`mejiro-reader-page mejiro-reader-page--${side}`}
        style={pageStyle}
      >
        <div className="mejiro-reader-page-rule" />
        {renderPageHeader ? renderPageHeader(side, header) : defaultHeader(header)}
        <div className="mejiro-reader-page-viewport">
          <div className="mejiro-reader-page-clip" style={{ height: contentHeight }}>
            <MejiroPageView
              key={pageKey}
              result={result}
              slotMode={slotMode}
              fontFamily={fontFamily}
              lineSpacing={lineSpacing}
              className="mejiro-reader-page-content"
              style={contentStyle}
            />
            {visibleRects && visibleRects.length > 0 && (
              <MejiroSelectionLayer rects={visibleRects} side={side} />
            )}
          </div>
        </div>
        {hostsImages &&
          hostedImages.map((item) => (
            <MejiroImageOverlay
              key={item.id}
              rect={isRight ? item.rect : { ...item.rect, x: item.rect.x + pageWidth }}
              onOverlayPointerDown={(e) => onImagePointerDown?.(item.id, e)}
              onResizePointerDown={(e) => onImageResizePointerDown?.(item.id, e)}
              onClose={() => onImageClose?.(item.id)}
            />
          ))}
      </div>
    );
  };

  function combinedPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (gestureEnabled) handleGesturePointerDown(e);
    if (selectionEnabled) handlePointerDown(e);
  }
  function combinedPointerUp(e: ReactPointerEvent<HTMLDivElement>): void {
    if (gestureEnabled) handleGesturePointerUp(e);
    endSelection(e);
  }
  // A cancelled press is neither a tap nor a swipe.
  function combinedPointerCancel(e: ReactPointerEvent<HTMLDivElement>): void {
    gestureRef.current = null;
    endSelection(e);
  }

  const useCombined = selectionEnabled || gestureEnabled;

  return (
    <div className="mejiro-reader-book">
      <div
        className={`mejiro-reader-spread${turning ? ' is-turning' : ''}${singlePage ? ' mejiro-reader-spread--single' : ''}`}
        onPointerDown={useCombined ? combinedPointerDown : undefined}
        onPointerMove={useCombined ? handlePointerMove : undefined}
        onPointerUp={useCombined ? combinedPointerUp : undefined}
        onPointerCancel={useCombined ? combinedPointerCancel : undefined}
        onLostPointerCapture={selectionEnabled ? endSelection : undefined}
      >
        {renderPage(singlePage ? singleSide : 'right')}
        {!singlePage && renderPage('left')}
        <button
          type="button"
          aria-label={messages.prevSpread}
          className="mejiro-reader-nav-zone mejiro-reader-nav-zone--prev"
          onClick={onPrev}
        />
        <button
          type="button"
          aria-label={messages.nextSpread}
          className="mejiro-reader-nav-zone mejiro-reader-nav-zone--next"
          onClick={onNext}
        />
        {indicator}
      </div>
    </div>
  );
}
