import { getCurrentScope, onScopeDispose } from 'vue';

/**
 * Hands out tokens for async loads and layouts. A result is delivered only
 * while its token is still current; starting a newer request, calling
 * `invalidate` or disposing the owning scope makes every earlier token stale.
 */
export interface RequestToken {
  /** Starts a request and returns its token, invalidating all earlier ones. */
  begin: () => number;
  /** The newest token handed out. */
  current: () => number;
  /** Whether `token` is still the newest and its owner is still alive. */
  isCurrent: (token: number) => boolean;
  /** Makes every token handed out so far stale. */
  invalidate: () => void;
}

/** Creates a {@link RequestToken} that is invalidated when the active effect scope is disposed. */
export function createRequestToken(): RequestToken {
  let latest = 0;
  const token: RequestToken = {
    begin: () => ++latest,
    current: () => latest,
    isCurrent: (id) => id === latest,
    invalidate: () => {
      latest++;
    },
  };
  if (getCurrentScope()) onScopeDispose(token.invalidate);
  return token;
}
