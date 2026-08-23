import type { EpubBook, EpubParseLimits } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Options for {@link useEpub}. */
export interface UseEpubOptions {
  /** URL fetched on mount. A non-OK response is treated as "no default". */
  defaultUrl?: string;
  /** Called after a successful load. */
  onLoad?: (book: EpubBook) => void;
  /** Called when a load fails. Non-OK URL responses are still treated as "no default". */
  onError?: (error: Error) => void;
  /**
   * Extra options merged into the `fetch` call when loading by URL. Useful
   * for sending bearer tokens or cookies (`credentials: 'include'`).
   */
  fetchOptions?: RequestInit;
  /**
   * Custom EPUB fetcher used in place of the global `fetch`. Returns the
   * raw `ArrayBuffer`. Overrides {@link fetchOptions} when set — common
   * for hosts that already own an auth-aware HTTP client.
   */
  fetchEpub?: (url: string) => Promise<ArrayBuffer>;
  /**
   * Archive resource limits applied while opening an EPUB. Raise them for
   * trusted, image-heavy books; tighten them for a public drop zone. Omitted
   * fields keep their `DEFAULT_EPUB_PARSE_LIMITS` value.
   */
  limits?: Partial<EpubParseLimits>;
}

/** Return value of {@link useEpub}. */
export interface UseEpubReturn {
  /** Current parsed EPUB, or `null` before any load. */
  epub: EpubBook | null;
  /** Whether a load is in progress. */
  loading: boolean;
  /** Last load error, if any. */
  error: Error | null;
  /** Parse from an in-memory buffer. */
  loadBuffer: (buffer: ArrayBuffer) => Promise<EpubBook | null>;
  /** Parse from a {@link File}. */
  loadFile: (file: File) => Promise<EpubBook | null>;
  /** Fetch a URL and parse the response. */
  loadUrl: (url: string) => Promise<EpubBook | null>;
  /** Replace the current EPUB without going through the parser. */
  setEpub: (book: EpubBook | null) => void;
}

/**
 * React hook that parses EPUB files and exposes loading/error state plus
 * convenience loaders for buffers, files, and URLs.
 */
export function useEpub(options: UseEpubOptions = {}): UseEpubReturn {
  const [epub, setEpub] = useState<EpubBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const onLoadRef = useRef(options.onLoad);
  onLoadRef.current = options.onLoad;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;
  const fetchOptionsRef = useRef(options.fetchOptions);
  fetchOptionsRef.current = options.fetchOptions;
  const fetchEpubRef = useRef(options.fetchEpub);
  fetchEpubRef.current = options.fetchEpub;
  const limitsRef = useRef(options.limits);
  limitsRef.current = options.limits;

  const loadBuffer = useCallback(async (buffer: ArrayBuffer): Promise<EpubBook | null> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const book = await parseEpub(buffer, { limits: limitsRef.current });
      if (requestId !== requestIdRef.current) return null;
      setEpub(book);
      onLoadRef.current?.(book);
      return book;
    } catch (err) {
      if (requestId === requestIdRef.current) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        onErrorRef.current?.(nextError);
      }
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (file: File) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const book = await parseEpub(await file.arrayBuffer(), { limits: limitsRef.current });
      if (requestId !== requestIdRef.current) return null;
      setEpub(book);
      onLoadRef.current?.(book);
      return book;
    } catch (err) {
      if (requestId === requestIdRef.current) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        onErrorRef.current?.(nextError);
      }
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const loadUrl = useCallback(async (url: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      let buffer: ArrayBuffer;
      if (fetchEpubRef.current) {
        buffer = await fetchEpubRef.current(url);
      } else {
        const init = fetchOptionsRef.current;
        const res = init ? await fetch(url, init) : await fetch(url);
        if (!res.ok) return null;
        buffer = await res.arrayBuffer();
      }
      const book = await parseEpub(buffer, { limits: limitsRef.current });
      if (requestId !== requestIdRef.current) return null;
      setEpub(book);
      onLoadRef.current?.(book);
      return book;
    } catch (err) {
      if (requestId === requestIdRef.current) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        onErrorRef.current?.(nextError);
      }
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const defaultUrl = options.defaultUrl;
  useEffect(() => {
    if (defaultUrl) void loadUrl(defaultUrl);
  }, [defaultUrl, loadUrl]);

  const replaceEpub = useCallback((book: EpubBook | null) => {
    requestIdRef.current++;
    setLoading(false);
    setError(null);
    setEpub(book);
  }, []);

  return { epub, loading, error, loadBuffer, loadFile, loadUrl, setEpub: replaceEpub };
}
