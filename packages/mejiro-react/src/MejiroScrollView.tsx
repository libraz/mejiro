import type { AnchorRect, ChapterLayout } from '@libraz/mejiro/book';
import { type FontFamily, normalizeFontFamily } from '@libraz/mejiro/browser';
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { MejiroImageOverlay } from './MejiroImageOverlay.js';
import { MejiroPageView } from './MejiroPageView.js';
import { MejiroSelectionLayer } from './MejiroSelectionLayer.js';
import type { MultiImageItem } from './useMultiImageOverlay.js';

// Shared default, so an omitted `images` never re-reads the pages.
const NO_IMAGES: MultiImageItem[] = [];

/** Props for {@link MejiroScrollView}. */
export interface MejiroScrollViewProps {
  /** Layout containing the pages to render. */
  layout: ChapterLayout;
  /** Page width in px. */
  pageWidth: number;
  /** Page height in px. */
  pageHeight: number;
  /** Content area height (px). */
  contentHeight: number;
  /** CSS font family applied to the content. */
  fontFamily?: FontFamily;
  /** Font size override (px). */
  fontSize?: number;
  /** Line spacing multiplier. */
  lineSpacing?: number;
  /** Force slot-based rendering on every page. */
  slotMode?: boolean;
  /**
   * Visible page index reported to the parent as the user scrolls. The page
   * with the largest intersection with the viewport is treated as visible.
   */
  onVisiblePageChange?: (pageIdx: number, source: 'user' | 'programmatic') => void;
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
   * `pageIdx` addresses. An entry may carry a `color` fill.
   */
  selectionRects?: readonly (AnchorRect & { color?: string })[];
  /** Zero-based spread whose right page carries {@link MejiroScrollViewProps.images}. */
  spreadIdx?: number;
  /**
   * Image overlays on the right page of {@link MejiroScrollViewProps.spreadIdx}.
   * The layout reflows in place when its images change, so a new array here is
   * also what re-reads the pages; `useMultiImageOverlay`'s `currentImages`
   * provides one on every change.
   */
  images?: MultiImageItem[];
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
export function MejiroScrollView({
  layout,
  pageWidth,
  pageHeight,
  contentHeight,
  fontFamily,
  fontSize,
  lineSpacing,
  slotMode,
  onVisiblePageChange,
  scrollToPage,
  pageGap = 24,
  selectionRects,
  spreadIdx,
  images = NO_IMAGES,
  onImagePointerDown,
  onImageResizePointerDown,
  onImageClose,
}: MejiroScrollViewProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const onVisiblePageChangeRef = useRef(onVisiblePageChange);
  onVisiblePageChangeRef.current = onVisiblePageChange;
  const programmaticScrollRef = useRef(false);
  // The page a user scroll last settled on; it is already under the viewport.
  const userPageRef = useRef<number | null>(null);
  const imagesPage = spreadIdx != null && images.length > 0 ? spreadIdx * 2 : -1;

  // The layout reflows in place when images change, so `images` keys this too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: images changes whenever the layout's exclusions do.
  const pages = useMemo(() => {
    const total = layout.totalPages;
    return Array.from({ length: total }, (_, i) => layout.getPage(i));
  }, [layout, images]);
  const pageCount = pages.length;

  const rectsByPage = useMemo(() => {
    const byPage: Array<(AnchorRect & { color?: string })[]> = [];
    for (const rect of selectionRects ?? []) {
      const list = byPage[rect.pageIdx] ?? [];
      list.push(rect);
      byPage[rect.pageIdx] = list;
    }
    return byPage;
  }, [selectionRects]);

  const contentStyle: CSSProperties = { height: contentHeight };
  if (fontFamily) contentStyle.fontFamily = normalizeFontFamily(fontFamily);
  if (fontSize != null) contentStyle.fontSize = fontSize;
  if (lineSpacing != null) contentStyle.lineHeight = String(lineSpacing);

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
    <div ref={containerRef} className="mejiro-reader-scroll">
      <div
        className="mejiro-reader-scroll-track"
        style={{ display: 'flex', flexDirection: 'column', gap: pageGap }}
      >
        {pages.map((result, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: pages have no stable ID
            key={i}
            ref={(el) => {
              pageRefs.current[i] = el;
            }}
            data-page-idx={i}
            className="mejiro-reader-page"
            style={{
              width: pageWidth,
              height: pageHeight,
              flexShrink: 0,
              ...(i === imagesPage ? { overflow: 'visible' } : null),
            }}
          >
            <div className="mejiro-reader-page-rule" />
            <div className="mejiro-reader-page-header">
              <span className="mejiro-reader-page-header-title" />
              <span className="mejiro-reader-page-header-num">{i + 1}</span>
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
                {rectsByPage[i] && (
                  <MejiroSelectionLayer
                    rects={rectsByPage[i]}
                    side={i % 2 === 0 ? 'right' : 'left'}
                  />
                )}
              </div>
            </div>
            {i === imagesPage &&
              images.map((item) => (
                <MejiroImageOverlay
                  key={item.id}
                  rect={item.rect}
                  onOverlayPointerDown={(e) => onImagePointerDown?.(item.id, e)}
                  onResizePointerDown={(e) => onImageResizePointerDown?.(item.id, e)}
                  onClose={() => onImageClose?.(item.id)}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
