import type { BookOptions, BookOptionsPatch } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import {
  type MaybeRefOrGetter,
  markRaw,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
} from 'vue';
import { toError } from './errors.js';
import { mergeDefined } from './persistence.js';

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
   * Called when applying options to the book fails. When supplied, failures are
   * reported here and the promise returned by
   * {@link UseMejiroBookReturn.updateOptions} resolves instead of rejecting, so
   * fire-and-forget callers cannot leave an unhandled rejection behind.
   * Applications triggered by a reactive `options` source are only observable
   * through this callback. A `MejiroError` arrives as thrown.
   */
  onError?: (error: Error) => void;
}

/** Return value of {@link useMejiroBook}. */
export interface UseMejiroBookReturn {
  /** The managed {@link MejiroBook} instance, marked raw so reactive state holds it unwrapped. */
  book: MejiroBook;
  /**
   * Read-only reactive snapshot of the current options. Once the latest
   * application settles it holds what the book applied, so a rejected change
   * rolls back.
   */
  options: Readonly<Ref<Readonly<BookOptions>>>;
  /**
   * Merges `patch` into the underlying book's options and the reactive
   * snapshot. The snapshot is updated synchronously; the returned promise
   * resolves once {@link MejiroBook.updateOptions} has propagated font / size
   * changes (which complete only after the font has loaded).
   */
  updateOptions: (patch: BookOptionsPatch) => Promise<void>;
}

/** A coalesced option change waiting for its debounce window to elapse. */
interface PendingApply {
  patch: BookOptionsPatch;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>;
}

/** The keys {@link MejiroBook.updateOptions} accepts; every other key is construction-time only. */
const RUNTIME_KEYS = [
  'fontFamily',
  'fontSize',
  'lineSpacing',
  'kinsoku',
  'enableHanging',
  'headingStyles',
  'headingScale',
] as const satisfies readonly (keyof BookOptionsPatch)[];

/** The runtime-changeable keys of `next` whose value differs from `current`. */
function runtimeChanges(
  current: Readonly<BookOptions>,
  next: Readonly<BookOptions>,
): BookOptionsPatch {
  const patch: Record<string, unknown> = {};
  for (const key of RUNTIME_KEYS) {
    if (next[key] !== undefined && !Object.is(next[key], current[key])) patch[key] = next[key];
  }
  return patch as BookOptionsPatch;
}

/**
 * Vue composable that owns a {@link MejiroBook} instance and exposes its
 * options as a reactive ref. The book is created once, from the value
 * `options` has during setup.
 *
 * Pass a ref or getter as `options` to follow it: whenever it changes, the
 * keys {@link MejiroBook.updateOptions} accepts that changed are applied, like
 * an {@link UseMejiroBookReturn.updateOptions} call. Construction-time keys
 * (`strictFontCheck`, `analyzer`, `pageSize`, …) are read once and later
 * changes to them are ignored; remount with a `:key` to rebuild the book.
 *
 * @param options - Book options, or a ref / getter that yields them.
 * @param hookOptions - Behavior overrides (debouncing, error reporting).
 */
export function useMejiroBook(
  options: MaybeRefOrGetter<BookOptions>,
  hookOptions: UseMejiroBookOptions = {},
): UseMejiroBookReturn {
  const initial = toValue(options);
  const book = markRaw(new MejiroBook(initial));
  const opts = shallowRef<Readonly<BookOptions>>({ ...initial });

  let pending: PendingApply | null = null;
  let flushGeneration = 0;

  function flush(): void {
    const current = pending;
    if (!current) return;
    pending = null;
    if (current.timer) clearTimeout(current.timer);
    const { waiters } = current;
    const generation = ++flushGeneration;
    // Only the latest application syncs: an earlier one settles before the book
    // has the newer change. A change still waiting to flush stays on top.
    const syncSnapshot = (): void => {
      if (generation !== flushGeneration) return;
      opts.value = { ...opts.value, ...book.getOptions(), ...pending?.patch };
    };
    void book.updateOptions(current.patch).then(
      () => {
        syncSnapshot();
        for (const waiter of waiters) waiter.resolve();
      },
      (err: unknown) => {
        syncSnapshot();
        const error = toError(err);
        if (hookOptions.onError) {
          hookOptions.onError(error);
          for (const waiter of waiters) waiter.resolve();
        } else {
          for (const waiter of waiters) waiter.reject(error);
        }
      },
    );
  }

  function updateOptions(patch: BookOptionsPatch): Promise<void> {
    opts.value = mergeDefined<BookOptions>(opts.value, patch);
    const current: PendingApply = pending ?? { patch: {}, timer: null, waiters: [] };
    pending = current;
    current.patch = mergeDefined(current.patch, patch);
    const settled = new Promise<void>((resolve, reject) => {
      current.waiters.push({ resolve, reject });
    });
    if (current.timer) clearTimeout(current.timer);
    const debounceMs = hookOptions.debounceMs ?? 0;
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

  watch(
    () => toValue(options),
    (next) => {
      const patch = runtimeChanges(opts.value, next);
      if (Object.keys(patch).length === 0) return;
      // Triggered by the caller's reactive source, so there is nobody to hand
      // a rejection to — `onError` is the observation point.
      void updateOptions(patch).catch(() => {});
    },
    { deep: true },
  );

  // A change still inside its debounce window is dropped when the scope is
  // disposed — nothing is left to render it — but its awaiters must not hang.
  // The book releases its font subscription.
  onScopeDispose(() => {
    book.dispose();
    const current = pending;
    if (!current) return;
    pending = null;
    if (current.timer) clearTimeout(current.timer);
    for (const waiter of current.waiters) waiter.resolve();
  });

  return {
    book,
    options: shallowReadonly(opts),
    updateOptions,
  };
}
