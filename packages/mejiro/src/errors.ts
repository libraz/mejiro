/**
 * Identifies the failure a {@link MejiroError} reports.
 *
 * Branch on this rather than on the message, which is written for people and
 * may change in any release. The union grows in minor releases, so a `switch`
 * over it should keep a `default` branch.
 *
 * - `epub-invalid-archive` — the input is not a ZIP archive an EPUB can live in.
 * - `epub-invalid-package` — the container or package document is malformed, or
 *   a project with no chapters was exported.
 * - `epub-limit-exceeded` — the archive exceeds one of the configured parse limits.
 * - `epub-unsupported-content` — an edited chapter holds content the exporter
 *   cannot write back without losing it.
 * - `dom-unavailable` — `DOMParser` or another required DOM API is missing.
 * - `environment-unsupported` — `createImageBitmap`, canvas or the FontFace API
 *   is missing.
 * - `font-unavailable` — the requested font is not available, or the canvas
 *   rejected the font specification.
 * - `font-load-failed` — loading a font face failed.
 * - `page-size-unset` — layout was requested before a page size was set.
 * - `fetch-failed` — fetching an EPUB by URL returned a failure status.
 * - `asset-fetch-failed` — fetching an image asset returned a failure status.
 * - `analyzer-unavailable` — the morphological analyzer could not be loaded.
 * - `analyzer-disposed` — the analyzer was used after `dispose()`.
 * - `analyzer-failed` — the analyzer threw while a chapter was laid out.
 * - `image-decode-failed` — the image could not be decoded.
 * - `image-encode-failed` — the prepared image could not be encoded.
 * - `storage-read-failed` / `storage-write-failed` — the persistence storage threw.
 * - `storage-corrupt` — the stored data could not be read back.
 * - `snapshot-invalid` — a chapter layout snapshot is malformed or of an unknown version.
 * - `regex-unsafe` — a search pattern was rejected as unsafe to evaluate.
 */
export type MejiroErrorCode =
  | 'epub-invalid-archive'
  | 'epub-invalid-package'
  | 'epub-limit-exceeded'
  | 'epub-unsupported-content'
  | 'dom-unavailable'
  | 'environment-unsupported'
  | 'font-unavailable'
  | 'font-load-failed'
  | 'page-size-unset'
  | 'fetch-failed'
  | 'asset-fetch-failed'
  | 'analyzer-unavailable'
  | 'analyzer-disposed'
  | 'analyzer-failed'
  | 'image-decode-failed'
  | 'image-encode-failed'
  | 'storage-read-failed'
  | 'storage-write-failed'
  | 'storage-corrupt'
  | 'snapshot-invalid'
  | 'regex-unsafe';

/**
 * A failure raised by mejiro that is not a programming error.
 *
 * Invalid arguments throw `TypeError` or `RangeError` instead, and an aborted
 * operation rejects with its `signal.reason`. Every entry point of every
 * package throws this same class, so one `instanceof MejiroError` check covers
 * them all.
 *
 * @example
 * ```ts
 * try {
 *   await parseEpub(bytes);
 * } catch (error) {
 *   if (error instanceof MejiroError && error.code === 'epub-invalid-archive') {
 *     showMessage('This file is not an EPUB.');
 *   }
 * }
 * ```
 */
export class MejiroError extends Error {
  /** The failure this error reports. */
  readonly code: MejiroErrorCode;

  /**
   * @param code - The failure this error reports.
   * @param message - Human-readable description of the failure.
   * @param options - `cause` carries the underlying error, when there is one.
   */
  constructor(code: MejiroErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MejiroError';
    this.code = code;
  }
}

/**
 * Identifies a non-fatal degradation reported in a `warnings` list.
 *
 * - `alignment-failed` — analyzer output could not be aligned with the text.
 * - `morphemes-dropped` — some morphemes were discarded during alignment.
 * - `max-bytes-exceeded` — `prepareImage` could not bring the encoded image under
 *   `maxBytes`; the returned image is the smallest one it produced.
 */
export type MejiroWarningCode = 'alignment-failed' | 'morphemes-dropped' | 'max-bytes-exceeded';

/** A non-fatal degradation: the operation completed, with reduced quality. */
export interface MejiroWarning {
  /** The degradation this warning reports. */
  code: MejiroWarningCode;
  /** Human-readable description of the degradation. */
  message: string;
}
