// Internal error-reporting contract shared by every async load / export
// path in the components and hooks: a thrown value is handed to a single report
// callback as an `Error` — a `MejiroError` passes through untouched — and never
// left as an unhandled rejection. The React and Vue packages carry identical
// copies.

import { type BinaryInput, MejiroError } from '@libraz/mejiro';
import { assertEpubInputSize, type EpubParseLimits } from '@libraz/mejiro/epub';
import type { FetchEpubOptions } from './useEpub.js';

/** Normalizes a thrown value to an `Error`; an `Error` (a `MejiroError` included) is returned as is. */
export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Fetches `url` as an `ArrayBuffer`. A non-2xx response or a network failure
 * rejects with `MejiroError` `fetch-failed`; an abort through `init.signal`
 * rejects with the signal's reason.
 */
export async function fetchEpubBuffer(url: string, init?: RequestInit): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = init ? await fetch(url, init) : await fetch(url);
  } catch (cause) {
    if (init?.signal?.aborted) throw init.signal.reason;
    throw new MejiroError('fetch-failed', `Failed to load EPUB from ${url}`, { cause });
  }
  if (!res.ok) {
    throw new MejiroError('fetch-failed', `Failed to load EPUB: HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}

/** How a hook or component fetches an EPUB by URL. */
export interface EpubFetchSource {
  /** Host fetcher; wins over `fetchOptions` when set. */
  fetchEpub?: (url: string, options: FetchEpubOptions) => Promise<BinaryInput>;
  /** Extra `fetch` options for the default fetcher. */
  fetchOptions?: RequestInit;
}

/**
 * Fetches the EPUB at `url` through the host fetcher when one is given, else
 * the global `fetch` with `fetchOptions`, passing `signal` to either.
 */
export function fetchEpubBytes(
  url: string,
  source: EpubFetchSource,
  signal: AbortSignal,
): Promise<BinaryInput> {
  if (source.fetchEpub) return source.fetchEpub(url, { signal });
  return fetchEpubBuffer(url, { ...source.fetchOptions, signal });
}

/**
 * Reads `file` as an `ArrayBuffer`, rejecting it by `file.size` before any
 * byte is read when it exceeds the resolved `maxInputBytes`.
 */
export async function readEpubFile(
  file: File,
  limits?: Partial<EpubParseLimits>,
): Promise<ArrayBuffer> {
  assertEpubInputSize(file.size, limits);
  return file.arrayBuffer();
}

/**
 * Runs `task`, passing any failure to `report` exactly once as an `Error`.
 * Resolves to the task's value, or `undefined` when it failed.
 */
export async function withErrorReporting<T>(
  task: () => Promise<T>,
  report: (error: Error) => void,
): Promise<T | undefined> {
  try {
    return await task();
  } catch (cause) {
    report(toError(cause));
    return undefined;
  }
}
