// Internal error-reporting contract shared by every async load / export
// path in the components and hooks: a thrown value is normalized to one
// `Error` (a `MejiroError` passes through unchanged), handed to a single report
// callback, and never left as an unhandled rejection. The React and Vue
// packages carry identical copies.

import { MejiroError } from '@libraz/mejiro';
import { assertEpubInputSize, type EpubParseLimits } from '@libraz/mejiro/epub';

/** Normalizes a thrown value to an `Error`; an `Error` (a `MejiroError` included) is returned as is. */
export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Fetches `url` as an `ArrayBuffer`, throwing on a network failure or a
 * non-2xx response so both reach the caller's error path.
 *
 * @throws MejiroError `fetch-failed` for a non-2xx response.
 */
export async function fetchEpubBuffer(url: string, init?: RequestInit): Promise<ArrayBuffer> {
  const res = init ? await fetch(url, init) : await fetch(url);
  if (!res.ok) throw new MejiroError('fetch-failed', `Failed to load EPUB: ${res.status}`);
  return res.arrayBuffer();
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

/**
 * Returns the reporter for a recovered failure: `onError` when the host gave
 * one, otherwise a `console.warn`, so the notice still reaches the developer.
 */
export function nonFatalReporter(
  onError: ((error: MejiroError) => void) | undefined,
): (error: MejiroError) => void {
  if (onError) return onError;
  return (error) => {
    // biome-ignore lint/suspicious/noConsole: the documented default when no onError is given
    if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
    // biome-ignore lint/suspicious/noConsole: the documented default when no onError is given
    console.warn(`[mejiro] ${error.message}`, error.cause);
  };
}
