import type { ChapterLayout, InChapterAnchor, MejiroBook } from '@libraz/mejiro/book';
import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { toError } from './errors.js';

/** Page dimensions as returned by {@link MejiroBook.computePageSize}. */
type SurfacePageSize = ReturnType<MejiroBook['computePageSize']>;

/**
 * The content a {@link useSurfaceLayout} lays out. Its identity is the source
 * key: a new object starts a fresh (blank) layout, an equal one does not.
 */
export interface SurfaceLayoutSource {
  /** Sizes the pages against the surface; runs before {@link layout}. */
  measure: (surface: HTMLElement) => SurfacePageSize;
  /** Lays the content out with the page size {@link measure} applied. */
  layout: () => Promise<ChapterLayout | null>;
}

/** Options for {@link useSurfaceLayout}; function values are read at call time. */
export interface SurfaceLayoutOptions {
  /** Observe the surface element for size changes and re-flow. */
  enableResize: boolean;
  /** Debounce window (ms) applied to size-triggered re-flows. */
  resizeDebounce: number;
  /** Captures the reading position before a reflow (non-blank) re-layout. */
  capturePosition?: (layout: ChapterLayout) => InChapterAnchor | null;
  /** Applies a captured anchor once the new layout is in place. */
  restorePosition?: (layout: ChapterLayout, position: InChapterAnchor) => void;
  /** Receives a failed layout of a still-current request. */
  onError?: (error: Error) => void;
}

/** State and controls returned by {@link useSurfaceLayout}. */
export interface SurfaceLayoutState {
  /** Current layout, or `null` before the first computation. */
  layout: ChapterLayout | null;
  /** Page width in pixels. */
  pageWidth: number;
  /** Page height in pixels. */
  pageHeight: number;
  /** Content height in pixels. */
  contentHeight: number;
  /** Most recent layout time (ms). */
  elapsedMs: number;
  /** Lays the source out again; see `RecomputeOptions` for `blank`. */
  recompute: (opts?: { blank?: boolean }) => Promise<void>;
  /** Anchor captured before the most recent reflow, awaiting restoration. */
  pendingRestore: MutableRefObject<InChapterAnchor | null>;
}

/** Client box the page size was last computed from. */
interface SurfaceBox {
  width: number;
  height: number;
}

/**
 * Layout core shared by the chapter and manuscript layout hooks: lays
 * `source` out against `surface`, once per source change, and re-flows when
 * the surface's client box changes.
 *
 * The observer is keyed on the surface and the resize options only, so a
 * source change never re-creates it. An observation reporting the box the
 * current layout was measured with is skipped, so mounting or switching the
 * source lays out exactly once. A failed layout of a current request goes to
 * `onError` once and `recompute` resolves; without `onError` an awaited
 * `recompute` rejects, while the hook's own triggers drop the failure.
 */
export function useSurfaceLayout(
  source: SurfaceLayoutSource | null,
  surface: RefObject<HTMLElement | null>,
  options: SurfaceLayoutOptions,
): SurfaceLayoutState {
  const { enableResize, resizeDebounce } = options;

  const [layout, setLayout] = useState<ChapterLayout | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const layoutRef = useRef<ChapterLayout | null>(null);
  layoutRef.current = layout;
  const requestIdRef = useRef(0);
  const pendingRestore = useRef<InChapterAnchor | null>(null);
  const measuredBoxRef = useRef<SurfaceBox | null>(null);

  // Latest function-valued options, so `recompute` stays stable across renders.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const recompute = useCallback(
    async (opts: { blank?: boolean } = {}) => {
      const blank = opts.blank ?? true;
      const o = optionsRef.current;
      const requestId = ++requestIdRef.current;
      const el = surface.current;
      if (!(source && el)) {
        measuredBoxRef.current = null;
        setLayout(null);
        setPageWidth(0);
        setPageHeight(0);
        setContentHeight(0);
        setElapsedMs(0);
        return;
      }
      try {
        // Capture the reading position before a reflow swaps in a new layout so
        // it can be restored once the new layout commits (a new layout object
        // resets the spread index). Blank (content-change) re-layouts start at 0.
        const captured =
          !blank && layoutRef.current ? (o.capturePosition?.(layoutRef.current) ?? null) : null;
        pendingRestore.current = captured;
        if (blank) setLayout(null);
        measuredBoxRef.current = { width: el.clientWidth, height: el.clientHeight };
        const dims = source.measure(el);
        setPageWidth(dims.pageWidth);
        setPageHeight(dims.pageHeight);
        setContentHeight(dims.contentHeight);
        const t0 = performance.now();
        const next = await source.layout();
        if (requestId !== requestIdRef.current) return;
        layoutRef.current = next;
        setLayout(next);
        setElapsedMs(performance.now() - t0);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        const handler = optionsRef.current.onError;
        if (!handler) throw err;
        handler(toError(err));
      }
    },
    [source, surface],
  );

  const recomputeRef = useRef(recompute);
  recomputeRef.current = recompute;
  /** Starts a re-layout nobody awaits; a failure is `onError`'s alone. */
  const trigger = useCallback((opts?: { blank?: boolean }) => {
    recomputeRef.current(opts).catch(() => {});
  }, []);

  // Reset before paint when the source changes so a stale spread from the
  // previous source can never be rendered under the new one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: recompute changes exactly when the source changes.
  useLayoutEffect(() => {
    requestIdRef.current++;
    pendingRestore.current = null;
    setLayout(null);
    setPageWidth(0);
    setPageHeight(0);
    setContentHeight(0);
    setElapsedMs(0);
  }, [recompute]);

  useEffect(() => {
    recompute().catch(() => {});
    return () => {
      requestIdRef.current++;
    };
  }, [recompute]);

  useLayoutEffect(() => {
    const anchor = pendingRestore.current;
    const restore = optionsRef.current.restorePosition;
    if (!(layout && anchor && restore)) return;
    pendingRestore.current = null;
    restore(layout, anchor);
  }, [layout]);

  // Size-driven re-flow, as a fresh layout that keeps the current one on screen.
  useEffect(() => {
    if (!enableResize) return;
    const el = surface.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let observed = false;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const scheduleReflow = (immediate: boolean) => {
      clear();
      if (immediate) {
        trigger({ blank: false });
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        trigger({ blank: false });
      }, resizeDebounce);
    };

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        // The first callback reports the element's real, laid-out size — run it
        // immediately so a surface that mounted before its final box is sized
        // correctly on first paint. Debounce later changes.
        const immediate = !observed;
        observed = true;
        const box = measuredBoxRef.current;
        if (box && box.width === el.clientWidth && box.height === el.clientHeight) {
          clear();
          return;
        }
        scheduleReflow(immediate);
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
        clear();
      };
    }

    // Fallback for environments without ResizeObserver (e.g. very old browsers).
    const onWindowResize = () => scheduleReflow(false);
    window.addEventListener('resize', onWindowResize);
    return () => {
      window.removeEventListener('resize', onWindowResize);
      clear();
    };
  }, [surface, enableResize, resizeDebounce, trigger]);

  return { layout, pageWidth, pageHeight, contentHeight, elapsedMs, recompute, pendingRestore };
}
