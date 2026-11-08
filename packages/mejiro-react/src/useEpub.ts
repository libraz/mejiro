import type { BinaryInput } from '@libraz/mejiro';
import type { EpubBook, EpubParseLimits } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchEpubBytes, readEpubFile, toError } from './errors.js';
import { useRequestToken } from './useRequestToken.js';

/** Second argument of a host `fetchEpub` callback. */
export interface FetchEpubOptions {
  /**
   * Aborted when the load is superseded — by a newer load, a `url` change,
   * `setEpub` or unmount. Pass it on to the request so the download stops too.
   */
  signal: AbortSignal;
}

/** Options for {@link useEpub}. */
export interface UseEpubOptions {
  /**
   * URL to load. Fetched on mount and again whenever it changes; clearing it
   * abandons a load still in flight and keeps the current EPUB.
   */
  url?: string;
  /** Called after a successful load. */
  onLoad?: (epub: EpubBook) => void;
  /**
   * Called when a load fails, including a non-2xx URL response
   * (`MejiroError` `fetch-failed`). A `MejiroError` is passed as thrown.
   */
  onError?: (error: Error) => void;
  /**
   * Extra options merged into the `fetch` call when loading by URL. Useful
   * for sending bearer tokens or cookies (`credentials: 'include'`).
   */
  fetchOptions?: RequestInit;
  /**
   * Custom EPUB fetcher used in place of the global `fetch`. Resolves to the
   * raw bytes. Overrides {@link UseEpubOptions.fetchOptions} when set — common
   * for hosts that already own an auth-aware HTTP client.
   */
  fetchEpub?: (url: string, options: FetchEpubOptions) => Promise<BinaryInput>;
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
  /**
   * Parse from in-memory bytes. A `Uint8Array` is read through its own view
   * and is neither retained nor modified.
   */
  loadBuffer: (bytes: BinaryInput) => Promise<EpubBook | null>;
  /** Parse from a {@link File}. */
  loadFile: (file: File) => Promise<EpubBook | null>;
  /** Fetch a URL and parse the response. */
  loadUrl: (url: string) => Promise<EpubBook | null>;
  /** Replace the current EPUB without going through the parser, abandoning a load in flight. */
  setEpub: (epub: EpubBook | null) => void;
}

/**
 * React hook that parses EPUB files and exposes loading/error state plus
 * convenience loaders for buffers, files, and URLs.
 *
 * One load runs at a time: starting another, changing `url`, calling
 * `setEpub` or unmounting aborts the one in flight — its fetch and parse
 * included — and its result is dropped. Each loader resolves to the parsed
 * EPUB, or `null` when the load failed or was superseded.
 */
export function useEpub(options: UseEpubOptions = {}): UseEpubReturn {
  const [epub, setEpub] = useState<EpubBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requests = useRequestToken();
  const controllerRef = useRef<AbortController | null>(null);

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

  /** Aborts the load in flight, if any, and makes its result stale. */
  const abandon = useCallback(() => {
    requests.invalidate();
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, [requests]);

  useEffect(() => abandon, [abandon]);

  /** Parses whatever `read` yields; every failure lands in `error` and `onError` once. */
  const load = useCallback(
    async (read: (signal: AbortSignal) => Promise<BinaryInput>): Promise<EpubBook | null> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const requestId = requests.begin();
      const { signal } = controller;
      setLoading(true);
      setError(null);
      try {
        const book = await parseEpub(await read(signal), { limits: limitsRef.current, signal });
        if (!requests.isCurrent(requestId)) return null;
        setEpub(book);
        onLoadRef.current?.(book);
        return book;
      } catch (err) {
        if (requests.isCurrent(requestId)) {
          const nextError = toError(err);
          setError(nextError);
          onErrorRef.current?.(nextError);
        }
        return null;
      } finally {
        if (requests.isCurrent(requestId)) {
          setLoading(false);
          controllerRef.current = null;
        }
      }
    },
    [requests],
  );

  const loadBuffer = useCallback((bytes: BinaryInput) => load(async () => bytes), [load]);

  const loadFile = useCallback(
    (file: File) => load(() => readEpubFile(file, limitsRef.current)),
    [load],
  );

  const loadUrl = useCallback(
    (url: string) =>
      load((signal) =>
        fetchEpubBytes(
          url,
          { fetchEpub: fetchEpubRef.current, fetchOptions: fetchOptionsRef.current },
          signal,
        ),
      ),
    [load],
  );

  // A URL load still in flight when the URL changes or clears is abandoned.
  const url = options.url;
  useEffect(() => {
    if (!url) return;
    void loadUrl(url);
    const requestId = requests.current();
    return () => {
      if (requests.current() !== requestId) return;
      abandon();
      setLoading(false);
    };
  }, [url, loadUrl, requests, abandon]);

  const replaceEpub = useCallback(
    (next: EpubBook | null) => {
      abandon();
      setLoading(false);
      setError(null);
      setEpub(next);
    },
    [abandon],
  );

  return { epub, loading, error, loadBuffer, loadFile, loadUrl, setEpub: replaceEpub };
}
