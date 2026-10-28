import { useEffect, useRef } from 'react';

/**
 * Hands out tokens for async loads. A result is delivered only while its token
 * is still current; starting a newer request, calling `invalidate` or
 * unmounting the owner makes every earlier token stale.
 */
export interface RequestToken {
  /** Starts a request and returns its token, invalidating all earlier ones. */
  begin: () => number;
  /** The newest token handed out. */
  current: () => number;
  /** Whether `token` is still the newest and its owner is still mounted. */
  isCurrent: (token: number) => boolean;
  /** Makes every token handed out so far stale. */
  invalidate: () => void;
}

/** Owns one {@link RequestToken}, invalidated when the calling component unmounts. */
export function useRequestToken(): RequestToken {
  const ref = useRef<RequestToken | null>(null);
  if (!ref.current) {
    let latest = 0;
    ref.current = {
      begin: () => ++latest,
      current: () => latest,
      isCurrent: (token) => token === latest,
      invalidate: () => {
        latest++;
      },
    };
  }
  const token = ref.current;
  useEffect(() => () => token.invalidate(), [token]);
  return token;
}
