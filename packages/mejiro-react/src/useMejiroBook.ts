import type { BookOptions, MejiroBookOptions } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toError } from './errors.js';
import { mergeDefined } from './persistence.js';

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
   * Called when applying options to the book fails. When supplied, failures are
   * reported here and the promise returned by
   * {@link UseMejiroBookReturn.setOptions} resolves instead of rejecting, so
   * fire-and-forget callers cannot leave an unhandled rejection behind.
   */
  onError?: (error: Error) => void;
}

/** Return value of {@link useMejiroBook}. */
export interface UseMejiroBookReturn {
  /** The managed {@link MejiroBook} instance. Stable across renders. */
  book: MejiroBook;
  /**
   * Reactive snapshot of the current options. Once the latest application
   * settles it holds what the book applied, so a rejected change rolls back.
   */
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
  initial: MejiroBookOptions,
  options: UseMejiroBookOptions = {},
): UseMejiroBookReturn {
  const bookRef = useRef<MejiroBook | null>(null);
  if (!bookRef.current) bookRef.current = new MejiroBook(initial);
  const [snapshot, setLocal] = useState<BookOptions>(initial);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pendingRef = useRef<PendingApply | null>(null);
  const flushGenerationRef = useRef(0);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (pending.timer) clearTimeout(pending.timer);
    const { waiters } = pending;
    const generation = ++flushGenerationRef.current;
    const applied = bookRef.current?.setOptions(pending.patch) ?? Promise.resolve();
    // Only the latest application syncs: an earlier one settles before the book
    // has the newer change. A change still waiting to flush stays on top.
    const syncSnapshot = () => {
      const book = bookRef.current;
      if (!book || generation !== flushGenerationRef.current) return;
      setLocal((prev) => ({ ...prev, ...book.getOptions(), ...pendingRef.current?.patch }));
    };
    void applied.then(
      () => {
        syncSnapshot();
        for (const waiter of waiters) waiter.resolve();
      },
      (err: unknown) => {
        syncSnapshot();
        const error = toError(err);
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
      setLocal((prev) => mergeDefined(prev, next));
      const pending: PendingApply = pendingRef.current ?? { patch: {}, timer: null, waiters: [] };
      pendingRef.current = pending;
      pending.patch = mergeDefined(pending.patch, next);
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
  // is left to render it — but its awaiters must not hang. The book releases
  // its font subscription; it resubscribes if a remount keeps using it.
  useEffect(
    () => () => {
      bookRef.current?.dispose();
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
