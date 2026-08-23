import type { BookOptions } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { onScopeDispose, type Ref, readonly, ref, watch } from 'vue';

/** Options for {@link useMejiroBook}. */
export interface UseMejiroBookOptions {
  /**
   * Coalescing window (ms) applied before a change reaches the underlying
   * {@link MejiroBook}. The reactive snapshot is always updated synchronously so
   * controlled settings UI stays responsive; only the book application — and the
   * font load it may trigger — is debounced, so dragging a continuous control
   * results in a single re-measurement. `0` applies immediately.
   * @defaultValue 0
   */
  debounceMs?: number;
  /**
   * Called when applying options to the book fails — typically a font that
   * could not be loaded. When supplied, failures are reported here and the
   * promise returned by {@link UseMejiroBookReturn.setOptions} resolves instead
   * of rejecting, so fire-and-forget callers cannot leave an unhandled
   * rejection behind. Applications triggered by `source` are only observable
   * through this callback.
   */
  onError?: (error: Error) => void;
}

/** Return value of {@link useMejiroBook}. */
export interface UseMejiroBookReturn {
  /** The managed {@link MejiroBook} instance. */
  book: MejiroBook;
  /** Read-only reactive snapshot of the current options. */
  options: Ref<Readonly<BookOptions>>;
  /**
   * Update options on the underlying book and the reactive snapshot. The
   * snapshot is updated synchronously; the returned promise resolves once
   * {@link MejiroBook.setOptions} has propagated font / size changes (which
   * complete only after the font has loaded).
   */
  setOptions: (next: Partial<BookOptions>) => Promise<void>;
}

/** A coalesced option change waiting for its debounce window to elapse. */
interface PendingApply {
  patch: Partial<BookOptions>;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>;
}

/**
 * Vue composable that owns a {@link MejiroBook} instance and exposes its
 * options as a reactive ref. The book is created once; subsequent
 * `setOptions` calls update both the instance and the ref.
 *
 * @param initial - Initial book options (passed to the {@link MejiroBook} constructor).
 * @param source - Optional reactive options source. When provided, the book is
 *   re-configured whenever this ref changes.
 * @param options - Behavior overrides (debouncing, error reporting).
 */
export function useMejiroBook(
  initial: BookOptions,
  source?: Ref<Partial<BookOptions>>,
  options: UseMejiroBookOptions = {},
): UseMejiroBookReturn {
  const book = new MejiroBook(initial);
  const opts = ref<BookOptions>({ ...initial });

  let pending: PendingApply | null = null;

  function flush(): void {
    const current = pending;
    if (!current) return;
    pending = null;
    if (current.timer) clearTimeout(current.timer);
    const { waiters } = current;
    void book.setOptions(current.patch).then(
      () => {
        for (const waiter of waiters) waiter.resolve();
      },
      (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        if (options.onError) {
          options.onError(error);
          for (const waiter of waiters) waiter.resolve();
        } else {
          for (const waiter of waiters) waiter.reject(error);
        }
      },
    );
  }

  function setOptions(next: Partial<BookOptions>): Promise<void> {
    opts.value = { ...opts.value, ...next };
    const current: PendingApply = pending ?? { patch: {}, timer: null, waiters: [] };
    pending = current;
    Object.assign(current.patch, next);
    const settled = new Promise<void>((resolve, reject) => {
      current.waiters.push({ resolve, reject });
    });
    if (current.timer) clearTimeout(current.timer);
    const debounceMs = options.debounceMs ?? 0;
    if (debounceMs > 0) {
      current.timer = setTimeout(() => {
        current.timer = null;
        flush();
      }, debounceMs);
    } else {
      current.timer = null;
      flush();
    }
    return settled;
  }

  if (source) {
    watch(
      source,
      (v) => {
        // Triggered by the caller's reactive source, so there is nobody to hand
        // a rejection to — `onError` is the observation point.
        if (v) void setOptions(v).catch(() => {});
      },
      { deep: true },
    );
  }

  // A change still inside its debounce window is dropped when the scope is
  // disposed — nothing is left to render it — but its awaiters must not hang.
  onScopeDispose(() => {
    const current = pending;
    if (!current) return;
    pending = null;
    if (current.timer) clearTimeout(current.timer);
    for (const waiter of current.waiters) waiter.resolve();
  });

  return {
    book,
    options: readonly(opts) as Ref<Readonly<BookOptions>>,
    setOptions,
  };
}
