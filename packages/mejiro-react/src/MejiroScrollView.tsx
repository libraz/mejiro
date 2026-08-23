import type { ChapterLayout } from '@libraz/mejiro/book';
import { type FontFamily, normalizeFontFamily } from '@libraz/mejiro/browser';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { MejiroPageView } from './MejiroPageView.js';

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
}: MejiroScrollViewProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const onVisiblePageChangeRef = useRef(onVisiblePageChange);
  onVisiblePageChangeRef.current = onVisiblePageChange;
  const programmaticScrollRef = useRef(false);

  const pages = useMemo(() => {
    const total = layout.totalPages;
    return Array.from({ length: total }, (_, i) => layout.getPage(i));
  }, [layout]);
  const pageCount = pages.length;

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
          onVisiblePageChangeRef.current?.(
            mostVisibleIdx,
            programmaticScrollRef.current ? 'programmatic' : 'user',
          );
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
    const el = pageRefs.current[scrollToPage];
    if (!(el && containerRef.current)) return;
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
            style={{ width: pageWidth, height: pageHeight, flexShrink: 0 }}
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
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
