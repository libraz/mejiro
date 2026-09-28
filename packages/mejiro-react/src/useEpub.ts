import type { EpubBook, EpubParseLimits } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchEpubBuffer, readEpubFile, toError } from './errors.js';

/** Options for {@link useEpub}. */
export interface UseEpubOptions {
  /** URL fetched on mount. */
  defaultUrl?: string;
  /** Called after a successful load. */
  onLoad?: (book: EpubBook) => void;
  /** Called when a load fails, including a non-2xx URL response. */
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

  /** Parses whatever `read` yields; every failure lands in `error` and `onError` once. */
  const load = useCallback(async (read: () => Promise<ArrayBuffer>): Promise<EpubBook | null> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const book = await parseEpub(await read(), { limits: limitsRef.current });
      if (requestId !== requestIdRef.current) return null;
      setEpub(book);
      onLoadRef.current?.(book);
      return book;
    } catch (err) {
      if (requestId === requestIdRef.current) {
        const nextError = toError(err);
        setError(nextError);
        onErrorRef.current?.(nextError);
      }
      return null;
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const loadBuffer = useCallback((buffer: ArrayBuffer) => load(async () => buffer), [load]);

  const loadFile = useCallback(
    (file: File) => load(() => readEpubFile(file, limitsRef.current)),
    [load],
  );

  const loadUrl = useCallback(
    (url: string) =>
      load(() =>
        fetchEpubRef.current
          ? fetchEpubRef.current(url)
          : fetchEpubBuffer(url, fetchOptionsRef.current),
      ),
    [load],
  );

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
