import type { BookOptions, BookOptionsPatch } from '@libraz/mejiro/book';
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
   * {@link UseMejiroBookReturn.updateOptions} resolves instead of rejecting, so
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
   * Merges `patch` into the options of the underlying book and the snapshot.
   * The snapshot is updated synchronously; the returned promise resolves once
   * {@link MejiroBook.updateOptions} has propagated font / size changes (which
   * complete only after the font has loaded).
   */
  updateOptions: (patch: BookOptionsPatch) => Promise<void>;
}

/** The {@link BookOptions} keys a live book accepts, i.e. those of {@link BookOptionsPatch}. */
const RUNTIME_KEYS = [
  'fontFamily',
  'fontSize',
  'lineSpacing',
  'kinsoku',
  'enableHanging',
  'headingStyles',
  'headingScale',
] as const satisfies readonly (keyof BookOptionsPatch)[];

/** The runtime keys of `next` whose content differs from `prev`. */
function changedRuntimeKeys(prev: BookOptions, next: BookOptions): BookOptionsPatch {
  const patch: Record<string, unknown> = {};
  for (const key of RUNTIME_KEYS) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) patch[key] = next[key];
  }
  return patch as BookOptionsPatch;
}

/** A coalesced option change waiting for its debounce window to elapse. */
interface PendingApply {
  patch: BookOptionsPatch;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>;
}

/**
 * React hook that owns a {@link MejiroBook} instance and exposes its
 * options as React state.
 *
 * The book is created once on mount from `options`. Afterwards, a change to
 * the content of a key {@link MejiroBook.updateOptions} accepts — compared by
 * value, so an object literal recreated every render is fine — is applied like
 * an {@link UseMejiroBookReturn.updateOptions} call; without `onError`, a
 * failure of such an application goes to `console.warn`. A change to a
 * construction-time key (`strictFontCheck`, `analyzer`, `pageSize`, …) is
 * ignored and the book is not recreated; give the component a new React `key`
 * to start over with a new book.
 *
 * @param options - Book options; read in full on mount, and for their runtime keys on every render.
 * @param hookOptions - Behavior overrides (debouncing, error reporting).
 */
export function useMejiroBook(
  options: BookOptions,
  hookOptions: UseMejiroBookOptions = {},
): UseMejiroBookReturn {
  const bookRef = useRef<MejiroBook | null>(null);
  if (!bookRef.current) bookRef.current = new MejiroBook(options);
  const [snapshot, setLocal] = useState<BookOptions>(options);

  const hookOptionsRef = useRef(hookOptions);
  hookOptionsRef.current = hookOptions;
  const pendingRef = useRef<PendingApply | null>(null);
  const flushGenerationRef = useRef(0);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (pending.timer) clearTimeout(pending.timer);
    const { waiters } = pending;
    const generation = ++flushGenerationRef.current;
    const applied = bookRef.current?.updateOptions(pending.patch) ?? Promise.resolve();
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
        const handler = hookOptionsRef.current.onError;
        if (handler) {
          handler(error);
          for (const waiter of waiters) waiter.resolve();
        } else {
          for (const waiter of waiters) waiter.reject(error);
        }
      },
    );
  }, []);

  const updateOptions = useCallback(
    (patch: BookOptionsPatch): Promise<void> => {
      setLocal((prev) => mergeDefined(prev, patch));
      const pending: PendingApply = pendingRef.current ?? { patch: {}, timer: null, waiters: [] };
      pendingRef.current = pending;
      pending.patch = mergeDefined(pending.patch, patch);
      const settled = new Promise<void>((resolve, reject) => {
        pending.waiters.push({ resolve, reject });
      });
      if (pending.timer) clearTimeout(pending.timer);
      const debounceMs = hookOptionsRef.current.debounceMs ?? 0;
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

  // Follows the runtime keys of `options` by content. The comparison is against
  // the options last seen, not the snapshot, so a value the host keeps passing
  // never undoes an `updateOptions` call.
  const seenOptionsRef = useRef(options);
  useEffect(() => {
    const patch = changedRuntimeKeys(seenOptionsRef.current, options);
    seenOptionsRef.current = options;
    if (Object.keys(patch).length === 0) return;
    // Nobody awaits this application; without `onError` its failure is only logged.
    // biome-ignore lint/suspicious/noConsole: the documented default for a failed application of `options`
    updateOptions(patch).catch((error: unknown) => console.warn(error));
  });

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

  return { book: bookRef.current, options: snapshot, updateOptions };
}
