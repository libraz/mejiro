import type { BookOptions } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { type Ref, readonly, ref, watch } from 'vue';

/** Return value of {@link useMejiroBook}. */
export interface UseMejiroBookReturn {
  /** The managed {@link MejiroBook} instance. */
  book: MejiroBook;
  /** Read-only reactive snapshot of the current options. */
  options: Ref<Readonly<BookOptions>>;
  /**
   * Update options on the underlying book and the reactive snapshot. The
   * returned promise resolves once {@link MejiroBook.setOptions} has propagated
   * font / size changes (re-measurement runs lazily inside that call).
   */
  setOptions: (next: Partial<BookOptions>) => Promise<void>;
}

/**
 * Vue composable that owns a {@link MejiroBook} instance and exposes its
 * options as a reactive ref. The book is created once; subsequent
 * `setOptions` calls update both the instance and the ref.
 *
 * @param initial - Initial book options (passed to the {@link MejiroBook} constructor).
 * @param source - Optional reactive options source. When provided, the book is
 *   re-configured whenever this ref changes.
 */
export function useMejiroBook(
  initial: BookOptions,
  source?: Ref<Partial<BookOptions>>,
): UseMejiroBookReturn {
  const book = new MejiroBook(initial);
  const opts = ref<BookOptions>({ ...initial });

  async function setOptions(next: Partial<BookOptions>): Promise<void> {
    opts.value = { ...opts.value, ...next };
    await book.setOptions(next);
  }

  if (source) {
    watch(
      source,
      (v) => {
        if (v) void setOptions(v);
      },
      { deep: true },
    );
  }

  return {
    book,
    options: readonly(opts) as Ref<Readonly<BookOptions>>,
    setOptions,
  };
}
