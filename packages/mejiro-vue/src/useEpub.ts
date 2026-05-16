import type { EpubBook } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import { onBeforeUnmount, onMounted, type Ref, shallowRef, type WatchStopHandle, watch } from 'vue';

/** Options for {@link useEpub}. */
export interface UseEpubOptions {
  /** URL to fetch and load on mount. If omitted, no auto-load happens. */
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
   * raw `ArrayBuffer`. Overrides {@link fetchOptions} when set.
   */
  fetchEpub?: (url: string) => Promise<ArrayBuffer>;
}

/** Return value of {@link useEpub}. */
export interface UseEpubReturn {
  /** Current parsed EPUB, or `null` before any load. */
  epub: Ref<EpubBook | null>;
  /** Whether a load is in progress. */
  loading: Ref<boolean>;
  /** Last load error, if any. */
  error: Ref<Error | null>;
  /** Parse an EPUB from an in-memory buffer. */
  loadBuffer: (buffer: ArrayBuffer) => Promise<EpubBook | null>;
  /** Parse an EPUB from a {@link File}. */
  loadFile: (file: File) => Promise<EpubBook | null>;
  /** Fetch a URL and parse the response. Returns `null` on non-OK status. */
  loadUrl: (url: string) => Promise<EpubBook | null>;
  /** Replace the current EPUB without going through the parser. */
  setEpub: (book: EpubBook | null) => void;
}

/**
 * Vue composable that fetches and parses EPUB files, exposing reactive
 * loading/error state and convenience loaders for buffers, files, and URLs.
 *
 * When `options.defaultUrl` is set, it is fetched and loaded immediately.
 * If `options.defaultUrl` is exposed via a reactive getter, URL changes are
 * loaded as well.
 * A non-OK response is treated as "no default available" (no error is set).
 */
export function useEpub(options: UseEpubOptions = {}): UseEpubReturn {
  const epub = shallowRef<EpubBook | null>(null);
  const loading = shallowRef(false);
  const error = shallowRef<Error | null>(null);
  let requestId = 0;

  async function loadBuffer(buffer: ArrayBuffer): Promise<EpubBook | null> {
    const currentRequest = ++requestId;
    loading.value = true;
    error.value = null;
    try {
      const book = await parseEpub(buffer);
      if (currentRequest !== requestId) return null;
      epub.value = book;
      options.onLoad?.(book);
      return book;
    } catch (err) {
      if (currentRequest === requestId) {
        error.value = err instanceof Error ? err : new Error(String(err));
        options.onError?.(error.value);
      }
      return null;
    } finally {
      if (currentRequest === requestId) loading.value = false;
    }
  }

  async function loadFile(file: File): Promise<EpubBook | null> {
    const currentRequest = ++requestId;
    loading.value = true;
    error.value = null;
    try {
      const book = await parseEpub(await file.arrayBuffer());
      if (currentRequest !== requestId) return null;
      epub.value = book;
      options.onLoad?.(book);
      return book;
    } catch (err) {
      if (currentRequest === requestId) {
        error.value = err instanceof Error ? err : new Error(String(err));
        options.onError?.(error.value);
      }
      return null;
    } finally {
      if (currentRequest === requestId) loading.value = false;
    }
  }

  async function loadUrl(url: string): Promise<EpubBook | null> {
    const currentRequest = ++requestId;
    loading.value = true;
    error.value = null;
    try {
      let buffer: ArrayBuffer;
      if (options.fetchEpub) {
        buffer = await options.fetchEpub(url);
      } else {
        const init = options.fetchOptions;
        const res = init ? await fetch(url, init) : await fetch(url);
        if (!res.ok) return null;
        buffer = await res.arrayBuffer();
      }
      const book = await parseEpub(buffer);
      if (currentRequest !== requestId) return null;
      epub.value = book;
      options.onLoad?.(book);
      return book;
    } catch (err) {
      if (currentRequest === requestId) {
        error.value = err instanceof Error ? err : new Error(String(err));
        options.onError?.(error.value);
      }
      return null;
    } finally {
      if (currentRequest === requestId) loading.value = false;
    }
  }

  let stopDefaultUrlWatch: WatchStopHandle | undefined;
  onMounted(() => {
    stopDefaultUrlWatch = watch(
      () => options.defaultUrl,
      (url) => {
        if (url) void loadUrl(url);
      },
      { immediate: true },
    );
  });
  onBeforeUnmount(() => {
    stopDefaultUrlWatch?.();
  });

  function setEpub(book: EpubBook | null): void {
    requestId++;
    loading.value = false;
    error.value = null;
    epub.value = book;
  }

  return { epub, loading, error, loadBuffer, loadFile, loadUrl, setEpub };
}
