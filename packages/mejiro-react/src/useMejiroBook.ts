import type { BookOptions } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { useCallback, useRef, useState } from 'react';

/** Return value of {@link useMejiroBook}. */
export interface UseMejiroBookReturn {
  /** The managed {@link MejiroBook} instance. Stable across renders. */
  book: MejiroBook;
  /** Reactive snapshot of the current options. */
  options: Readonly<BookOptions>;
  /**
   * Update options on the underlying book and the snapshot. The returned
   * promise resolves once {@link MejiroBook.setOptions} has propagated
   * font / size changes (re-measurement runs lazily inside that call).
   */
  setOptions: (next: Partial<BookOptions>) => Promise<void>;
}

/**
 * React hook that owns a {@link MejiroBook} instance and exposes its
 * options as React state. The book is created once on mount; subsequent
 * option changes must go through {@link UseMejiroBookReturn.setOptions}
 * (e.g. via the `MejiroReader` imperative handle).
 */
export function useMejiroBook(initial: BookOptions): UseMejiroBookReturn {
  const bookRef = useRef<MejiroBook | null>(null);
  if (!bookRef.current) bookRef.current = new MejiroBook(initial);
  const [options, setLocal] = useState<BookOptions>(initial);

  const setOptions = useCallback(async (next: Partial<BookOptions>) => {
    setLocal((prev) => ({ ...prev, ...next }));
    await bookRef.current?.setOptions(next);
  }, []);

  return { book: bookRef.current, options, setOptions };
}
