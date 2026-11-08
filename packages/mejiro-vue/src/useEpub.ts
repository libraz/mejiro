import type { BinaryInput } from '@libraz/mejiro';
import type { EpubBook, EpubParseLimits } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import {
  getCurrentScope,
  type MaybeRefOrGetter,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef,
  toValue,
  type WatchStopHandle,
  watch,
} from 'vue';
import { fetchEpubBuffer, readEpubFile, toError } from './errors.js';
import { createRequestToken } from './useRequestToken.js';

/** Second argument of a custom `fetchEpub` loader. */
export interface FetchEpubOptions {
  /**
   * Aborted when the load is superseded by a newer one, cancelled, or its
   * owner unmounts. Hand it to `fetch` (or the transport in use) so the
   * download stops too.
   */
  signal: AbortSignal;
}

/** Options for {@link useEpub}. */
export interface UseEpubOptions {
  /**
   * URL fetched and loaded once mounted. A ref or getter loads every new URL,
   * abandoning the load still in flight; an empty value loads nothing.
   */
  url?: MaybeRefOrGetter<string | null | undefined>;
  /** Called after a successful load. */
  onLoad?: (epub: EpubBook) => void;
  /**
   * Called when a load fails, including a non-2xx URL response
   * (`MejiroError` `fetch-failed`). A `MejiroError` arrives as thrown.
   */
  onError?: (error: Error) => void;
  /**
   * Extra options merged into the `fetch` call when loading by URL. Useful
   * for sending bearer tokens or cookies (`credentials: 'include'`). Its
   * `signal` is replaced by the composable's own.
   */
  fetchOptions?: RequestInit;
  /**
   * Custom EPUB fetcher used in place of the global `fetch`. Returns the raw
   * bytes. Overrides {@link UseEpubOptions.fetchOptions} when set.
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
  /** Current parsed EPUB, or `null` before any load. Change it through `setEpub` or a loader. */
  epub: Readonly<Ref<EpubBook | null>>;
  /** Whether a load is in progress. */
  loading: Readonly<Ref<boolean>>;
  /** Last load error, if any. */
  error: Readonly<Ref<Error | null>>;
  /** Parse an EPUB from in-memory bytes. */
  loadBuffer: (bytes: BinaryInput) => Promise<EpubBook | null>;
  /** Parse an EPUB from a {@link File}. */
  loadFile: (file: File) => Promise<EpubBook | null>;
  /** Fetch a URL and parse the response. A non-2xx response is reported as an error. */
  loadUrl: (url: string) => Promise<EpubBook | null>;
  /** Replace the current EPUB without going through the parser. */
  setEpub: (epub: EpubBook | null) => void;
}

/**
 * Vue composable that fetches and parses EPUB files, exposing reactive
 * loading/error state and convenience loaders for buffers, files, and URLs.
 *
 * Starting a load aborts the one still in flight — its fetch and parse are
 * cancelled through their `signal`, and it settles to `null` without
 * reporting — and so do `setEpub` and disposing the owning scope. When
 * `options.url` is set, it is fetched and loaded once mounted, and again
 * whenever a reactive `url` changes.
 */
export function useEpub(options: UseEpubOptions = {}): UseEpubReturn {
  const epub = shallowRef<EpubBook | null>(null);
  const loading = shallowRef(false);
  const error = shallowRef<Error | null>(null);
  const requests = createRequestToken();
  let controller: AbortController | null = null;

  /** Aborts the load in flight, if any, and makes its result stale. */
  function abandon(): void {
    requests.invalidate();
    controller?.abort();
    controller = null;
  }

  /** Parses whatever `read` yields; every failure lands in `error` and `onError` once. */
  async function load(
    read: (signal: AbortSignal) => Promise<BinaryInput>,
  ): Promise<EpubBook | null> {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    const currentRequest = requests.begin();
    loading.value = true;
    error.value = null;
    try {
      const book = await parseEpub(await read(own.signal), {
        limits: options.limits,
        signal: own.signal,
      });
      if (!requests.isCurrent(currentRequest)) return null;
      epub.value = book;
      options.onLoad?.(book);
      return book;
    } catch (err) {
      if (requests.isCurrent(currentRequest)) {
        error.value = toError(err);
        options.onError?.(error.value);
      }
      return null;
    } finally {
      if (requests.isCurrent(currentRequest)) {
        loading.value = false;
        controller = null;
      }
    }
  }

  function loadBuffer(bytes: BinaryInput): Promise<EpubBook | null> {
    return load(async () => bytes);
  }

  function loadFile(file: File): Promise<EpubBook | null> {
    return load(() => readEpubFile(file, options.limits));
  }

  function loadUrl(url: string): Promise<EpubBook | null> {
    return load((signal) =>
      options.fetchEpub
        ? options.fetchEpub(url, { signal })
        : fetchEpubBuffer(url, { ...options.fetchOptions, signal }),
    );
  }

  // A URL load still in flight when the URL changes or clears is abandoned.
  let stopUrlWatch: WatchStopHandle | undefined;
  onMounted(() => {
    stopUrlWatch = watch(
      () => toValue(options.url),
      (url, _previous, onCleanup) => {
        if (!url) return;
        void loadUrl(url);
        const urlRequest = requests.current();
        onCleanup(() => {
          if (requests.current() !== urlRequest) return;
          abandon();
          loading.value = false;
        });
      },
      { immediate: true },
    );
  });
  onBeforeUnmount(() => {
    stopUrlWatch?.();
  });
  // Nothing settles into a disposed scope, and its download stops.
  if (getCurrentScope()) onScopeDispose(abandon);

  function setEpub(next: EpubBook | null): void {
    abandon();
    loading.value = false;
    error.value = null;
    epub.value = next;
  }

  return {
    epub: shallowReadonly(epub),
    loading: shallowReadonly(loading),
    error: shallowReadonly(error),
    loadBuffer,
    loadFile,
    loadUrl,
    setEpub,
  };
}
