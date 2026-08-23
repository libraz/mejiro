import type { BookOptions } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Options for {@link useMejiroBook}. */
export interface UseMejiroBookOptions {
  /**
   * Coalescing window (ms) applied before a change reaches the underlying
   * {@link MejiroBook}. The exposed snapshot is always updated synchronously so
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
   * rejection behind.
   */
  onError?: (error: Error) => void;
}

/** Return value of {@link useMejiroBook}. */
export interface UseMejiroBookReturn {
  /** The managed {@link MejiroBook} instance. Stable across renders. */
  book: MejiroBook;
  /** Reactive snapshot of the current options. */
  options: Readonly<BookOptions>;
  /**
   * Update options on the underlying book and the snapshot. The snapshot is
   * updated synchronously; the returned promise resolves once
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
 * React hook that owns a {@link MejiroBook} instance and exposes its
 * options as React state. The book is created once on mount; subsequent
 * option changes must go through {@link UseMejiroBookReturn.setOptions}
 * (e.g. via the `MejiroReader` imperative handle).
 *
 * @param initial - Initial book options (passed to the {@link MejiroBook} constructor).
 * @param options - Behavior overrides (debouncing, error reporting).
 */
export function useMejiroBook(
  initial: BookOptions,
  options: UseMejiroBookOptions = {},
): UseMejiroBookReturn {
  const bookRef = useRef<MejiroBook | null>(null);
  if (!bookRef.current) bookRef.current = new MejiroBook(initial);
  const [snapshot, setLocal] = useState<BookOptions>(initial);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pendingRef = useRef<PendingApply | null>(null);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (pending.timer) clearTimeout(pending.timer);
    const { waiters } = pending;
    const applied = bookRef.current?.setOptions(pending.patch) ?? Promise.resolve();
    void applied.then(
      () => {
        for (const waiter of waiters) waiter.resolve();
      },
      (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        const handler = optionsRef.current.onError;
        if (handler) {
          handler(error);
          for (const waiter of waiters) waiter.resolve();
        } else {
          for (const waiter of waiters) waiter.reject(error);
        }
      },
    );
  }, []);

  const setOptions = useCallback(
    (next: Partial<BookOptions>): Promise<void> => {
      setLocal((prev) => ({ ...prev, ...next }));
      const pending: PendingApply = pendingRef.current ?? { patch: {}, timer: null, waiters: [] };
      pendingRef.current = pending;
      Object.assign(pending.patch, next);
      const settled = new Promise<void>((resolve, reject) => {
        pending.waiters.push({ resolve, reject });
      });
      if (pending.timer) clearTimeout(pending.timer);
      const debounceMs = optionsRef.current.debounceMs ?? 0;
      if (debounceMs > 0) {
        pending.timer = setTimeout(() => {
          pending.timer = null;
          flush();
        }, debounceMs);
      } else {
        pending.timer = null;
        flush();
      }
      return settled;
    },
    [flush],
  );

  // A change still inside its debounce window is dropped on unmount — nothing
  // is left to render it — but its awaiters must not hang.
  useEffect(
    () => () => {
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      if (pending.timer) clearTimeout(pending.timer);
      for (const waiter of pending.waiters) waiter.resolve();
    },
    [],
  );

  return { book: bookRef.current, options: snapshot, setOptions };
}
