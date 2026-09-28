// Internal error-reporting contract shared by every async load / export
// path in the components and hooks: a thrown value is normalized to one
// `Error`, handed to a single report callback, and never left as an unhandled
// rejection. The React and Vue packages carry identical copies.

import { assertEpubInputSize, type EpubParseLimits } from '@libraz/mejiro/epub';

/** Normalizes a thrown value to an `Error`. */
export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Fetches `url` as an `ArrayBuffer`, throwing on a network failure or a
 * non-2xx response so both reach the caller's error path.
 */
export async function fetchEpubBuffer(url: string, init?: RequestInit): Promise<ArrayBuffer> {
  const res = init ? await fetch(url, init) : await fetch(url);
  if (!res.ok) throw new Error(`Failed to load EPUB: ${res.status}`);
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
