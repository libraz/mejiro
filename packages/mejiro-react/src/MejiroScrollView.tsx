import type { ChapterLayout, PageResult } from '@libraz/mejiro/book';
import { type FontFamily, normalizeFontFamily } from '@libraz/mejiro/browser';
import { type PageNumberDisplay, pageNumberFor } from '@libraz/mejiro/render';
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  forwardRef,
  memo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { MejiroImagePlaceholder } from './MejiroImagePlaceholder.js';
import { MejiroPageView } from './MejiroPageView.js';
import { MejiroSelectionLayer } from './MejiroSelectionLayer.js';
import type { SelectionRect } from './MejiroSpread.js';
import { type MultiImageItem, overlayPageSide } from './useImageOverlay.js';

// Shared default, so an omitted `images` never re-reads the pages.
const NO_IMAGES: readonly MultiImageItem[] = [];

interface ScrollPageProps {
  result: PageResult;
  index: number;
  pageNumber: number | null;
  pageWidth: number | undefined;
  pageHeight: number | undefined;
  contentHeight: number | undefined;
  slotMode?: boolean;
  fontFamily?: FontFamily;
  lineSpacing?: number;
  contentStyle: CSSProperties;
  rects?: SelectionRect[];
  /** Overlays this page carries; empty for every page but the current spread's. */
  overlays: readonly MultiImageItem[];
  /** Whether the overlays belong to the left page of the spread (offset by one page width). */
  overlaysLeft: boolean;
  registerPage: (index: number, el: HTMLDivElement | null) => void;
  onImagePointerDown: (id: string, e: ReactPointerEvent) => void;
  onImageResizePointerDown: (id: string, e: ReactPointerEvent) => void;
  onImageClose: (id: string) => void;
}

/** One page of the scroll track; memoized so only pages whose inputs changed re-render. */
const ScrollPage = memo(function ScrollPage({
  result,
  index,
  pageNumber,
  pageWidth,
  pageHeight,
  contentHeight,
  slotMode,
  fontFamily,
  lineSpacing,
  contentStyle,
  rects,
  overlays,
  overlaysLeft,
  registerPage,
  onImagePointerDown,
  onImageResizePointerDown,
  onImageClose,
}: ScrollPageProps): ReactNode {
  return (
    <div
      ref={(el) => registerPage(index, el)}
      data-page-idx={index}
      className="mejiro-reader-page"
      style={{
        width: pageWidth,
        height: pageHeight,
        flexShrink: 0,
        ...(overlays.length > 0 ? { overflow: 'visible' } : null),
      }}
    >
      <div className="mejiro-reader-page-rule" />
      <div className="mejiro-reader-page-header">
        <span className="mejiro-reader-page-header-title" />
        <span className="mejiro-reader-page-header-num">
          {pageNumber != null ? String(pageNumber) : ''}
        </span>
      </div>
      <div className="mejiro-reader-page-viewport">
        <div className="mejiro-reader-page-clip" style={{ height: contentHeight }}>
          <MejiroPageView
            result={result}
            slotMode={slotMode}
            fontFamily={fontFamily}
            lineSpacing={lineSpacing}
            className="mejiro-reader-page-content"
            style={contentStyle}
          />
          {rects && (
            <MejiroSelectionLayer rects={rects} side={index % 2 === 0 ? 'right' : 'left'} />
          )}
        </div>
      </div>
      {overlays.map((item) => (
        <MejiroImagePlaceholder
          key={item.id}
          rect={overlaysLeft ? { ...item.rect, x: item.rect.x + (pageWidth ?? 0) } : item.rect}
          onOverlayPointerDown={(e) => onImagePointerDown(item.id, e)}
          onResizePointerDown={(e) => onImageResizePointerDown(item.id, e)}
          onClose={() => onImageClose(item.id)}
        />
      ))}
    </div>
  );
});

/** Props for {@link MejiroScrollView}; other `div` attributes go to the scroll container. */
export interface MejiroScrollViewProps extends ComponentPropsWithoutRef<'div'> {
  /**
   * Layout containing the pages to render. Its `geometry` and `typography`
   * supply every page-size and font prop left unset.
   */
  layout: ChapterLayout;
  /** Page width in px. Defaults to `layout.geometry.pageWidth`. */
  pageWidth?: number;
  /** Page height in px. Defaults to `layout.geometry.pageHeight`. */
  pageHeight?: number;
  /** Content area height (px). Defaults to `layout.geometry.contentHeight`. */
  contentHeight?: number;
  /** CSS font family applied to the content. Defaults to `layout.typography.fontFamily`. */
  fontFamily?: FontFamily;
  /** Font size (px). Defaults to `layout.typography.fontSize`. */
  fontSize?: number;
  /** Line spacing multiplier. Defaults to `layout.typography.lineSpacing`. */
  lineSpacing?: number;
  /** Force slot-based rendering on every page. */
  slotMode?: boolean;
  /**
   * Visible page index reported to the parent as the user scrolls. The page
   * with the largest intersection with the viewport is treated as visible.
   */
  onVisiblePageChange?: (pageIndex: number, source: 'user' | 'programmatic') => void;
  /**
   * Target page to scroll into view. When set, the view scrolls so that the
   * matching page sits at the top of the scroll container.
   */
  scrollToPage?: number;
  /** Vertical gap between pages (px). @defaultValue 24 */
  pageGap?: number;
  /**
   * Selection rectangles to highlight. Compute via
   * {@link ChapterLayout.selectionRects}; each entry is painted on the page its
   * `pageIndex` addresses. An entry may carry a `color` fill.
   */
  selectionRects?: readonly SelectionRect[];
  /** Zero-based spread whose pages carry {@link MejiroScrollViewProps.images}. */
  spreadIndex?: number;
  /**
   * Image overlays on the spread at {@link MejiroScrollViewProps.spreadIndex}.
   * Each renders on the page whose area contains its centre (see
   * `overlayPageSide`), matching {@link MejiroSpread}'s single-page routing.
   * The layout reflows in place when its images change, so a new array here is
   * also what re-reads the pages; `useImageOverlay`'s `currentImages`
   * provides one on every change.
   */
  images?: readonly MultiImageItem[];
  /**
   * Which pages print their page number in the running head, by the same rule
   * as the paginated reader. @defaultValue 'both'
   */
  pageNumbers?: PageNumberDisplay;
  /** Pointer-down on an image overlay. */
  onImagePointerDown?: (id: string, e: ReactPointerEvent) => void;
  /** Pointer-down on an image resize handle. */
  onImageResizePointerDown?: (id: string, e: ReactPointerEvent) => void;
  /** Image overlay close button. */
  onImageClose?: (id: string) => void;
}

/**
 * Continuous-scroll variant of {@link MejiroSpread}. Stacks every page in
 * the chapter inside a vertically scrollable container. The visible page is
 * detected via `IntersectionObserver` and reported through
 * {@link MejiroScrollViewProps.onVisiblePageChange}.
 */
export const MejiroScrollView = forwardRef<HTMLDivElement, MejiroScrollViewProps>(
  function MejiroScrollView(
    {
      layout,
      pageWidth: pageWidthProp,
      pageHeight: pageHeightProp,
      contentHeight: contentHeightProp,
      fontFamily: fontFamilyProp,
      fontSize: fontSizeProp,
      lineSpacing: lineSpacingProp,
      slotMode,
      onVisiblePageChange,
      scrollToPage,
      pageGap = 24,
      selectionRects,
      spreadIndex,
      images = NO_IMAGES,
      pageNumbers = 'both',
      onImagePointerDown,
      onImageResizePointerDown,
      onImageClose,
      className,
      ...rest
    },
    ref,
  ): ReactNode {
    const pageWidth = pageWidthProp ?? layout.geometry.pageWidth;
    const pageHeight = pageHeightProp ?? layout.geometry.pageHeight;
    const contentHeight = contentHeightProp ?? layout.geometry.contentHeight;
    const fontFamily = fontFamilyProp ?? layout.typography.fontFamily;
    const fontSize = fontSizeProp ?? layout.typography.fontSize;
    const lineSpacing = lineSpacingProp ?? layout.typography.lineSpacing;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const forwardedRef = useRef(ref);
    forwardedRef.current = ref;
    const setContainer = useCallback((el: HTMLDivElement | null) => {
      containerRef.current = el;
      const target = forwardedRef.current;
      if (typeof target === 'function') target(el);
      else if (target) target.current = el;
    }, []);
    const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
    const onVisiblePageChangeRef = useRef(onVisiblePageChange);
    onVisiblePageChangeRef.current = onVisiblePageChange;
    const programmaticScrollRef = useRef(false);
    // The page a user scroll last settled on; it is already under the viewport.
    const userPageRef = useRef<number | null>(null);
    const rightPage = spreadIndex != null ? spreadIndex * 2 : -1;
    const leftPage = spreadIndex != null ? spreadIndex * 2 + 1 : -1;
    // Each overlay renders on the page whose area contains its centre, matching
    // MejiroSpread's single-page routing.
    const rightImages = useMemo(
      () => images.filter((item) => overlayPageSide(item.rect) === 'right'),
      [images],
    );
    const leftImages = useMemo(
      () => images.filter((item) => overlayPageSide(item.rect) === 'left'),
      [images],
    );

    // The layout reflows in place when images change, so `images` keys this too.
    // biome-ignore lint/correctness/useExhaustiveDependencies: images changes whenever the layout's exclusions do.
    const pages = useMemo(() => {
      return Array.from({ length: layout.pageCount }, (_, i) => layout.getPage(i));
    }, [layout, images]);
    const pageCount = pages.length;

    const rectsByPage = useMemo(() => {
      const byPage: SelectionRect[][] = [];
      for (const rect of selectionRects ?? []) {
        const list = byPage[rect.pageIndex] ?? [];
        list.push(rect);
        byPage[rect.pageIndex] = list;
      }
      return byPage;
    }, [selectionRects]);

    const contentStyle = useMemo(() => {
      const style: CSSProperties = { height: contentHeight };
      if (fontFamily) style.fontFamily = normalizeFontFamily(fontFamily);
      if (fontSize != null) style.fontSize = fontSize;
      if (lineSpacing != null) style.lineHeight = String(lineSpacing);
      return style;
    }, [contentHeight, fontFamily, fontSize, lineSpacing]);

    const registerPage = useCallback((index: number, el: HTMLDivElement | null) => {
      pageRefs.current[index] = el;
    }, []);
    // Image callbacks are read through refs so they never invalidate a page.
    const imageHandlersRef = useRef({ onImagePointerDown, onImageResizePointerDown, onImageClose });
    imageHandlersRef.current = { onImagePointerDown, onImageResizePointerDown, onImageClose };
    const handleImagePointerDown = useCallback(
      (id: string, e: ReactPointerEvent) => imageHandlersRef.current.onImagePointerDown?.(id, e),
      [],
    );
    const handleImageResizePointerDown = useCallback(
      (id: string, e: ReactPointerEvent) =>
        imageHandlersRef.current.onImageResizePointerDown?.(id, e),
      [],
    );
    const handleImageClose = useCallback(
      (id: string) => imageHandlersRef.current.onImageClose?.(id),
      [],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      if (pageCount === 0) return;
      if (typeof IntersectionObserver === 'undefined') return;
      let mostVisibleIdx = -1;
      let mostVisibleRatio = 0;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset.pageIdx);
            if (Number.isNaN(idx)) continue;
            if (entry.intersectionRatio > mostVisibleRatio || idx === mostVisibleIdx) {
              if (entry.isIntersecting) {
                mostVisibleRatio = entry.intersectionRatio;
                mostVisibleIdx = idx;
              } else if (idx === mostVisibleIdx) {
                mostVisibleIdx = -1;
                mostVisibleRatio = 0;
              }
            }
          }
          if (mostVisibleIdx >= 0) {
            const source = programmaticScrollRef.current ? 'programmatic' : 'user';
            if (source === 'user') userPageRef.current = mostVisibleIdx;
            onVisiblePageChangeRef.current?.(mostVisibleIdx, source);
          }
        },
        { root: container, threshold: [0.25, 0.5, 0.75] },
      );
      for (const el of pageRefs.current) {
        if (el) observer.observe(el);
      }
      return () => observer.disconnect();
    }, [pageCount]);

    useLayoutEffect(() => {
      if (scrollToPage == null) return;
      if (pageCount === 0) return;
      // Scrolling to the page the user just scrolled onto would snap it away.
      if (scrollToPage === userPageRef.current) return;
      const el = pageRefs.current[scrollToPage];
      if (!(el && containerRef.current)) return;
      userPageRef.current = null;
      programmaticScrollRef.current = true;
      containerRef.current.scrollTo({
        top: el.offsetTop,
        behavior: 'auto',
      });
      const timer = setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 0);
      return () => clearTimeout(timer);
    }, [scrollToPage, pageCount]);

    return (
      <div
        {...rest}
        ref={setContainer}
        className={className ? `mejiro-reader-scroll ${className}` : 'mejiro-reader-scroll'}
      >
        <div
          className="mejiro-reader-scroll-track"
          style={{ display: 'flex', flexDirection: 'column', gap: pageGap }}
        >
          {pages.map((result, i) => (
            <ScrollPage
              // biome-ignore lint/suspicious/noArrayIndexKey: pages have no stable ID
              key={i}
              result={result}
              index={i}
              pageNumber={pageNumberFor(pageNumbers, i)}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              contentHeight={contentHeight}
              slotMode={slotMode}
              fontFamily={fontFamily}
              lineSpacing={lineSpacing}
              contentStyle={contentStyle}
              rects={rectsByPage[i]}
              overlays={i === rightPage ? rightImages : i === leftPage ? leftImages : NO_IMAGES}
              overlaysLeft={i === leftPage}
              registerPage={registerPage}
              onImagePointerDown={handleImagePointerDown}
              onImageResizePointerDown={handleImageResizePointerDown}
              onImageClose={handleImageClose}
            />
          ))}
        </div>
      </div>
    );
  },
);
