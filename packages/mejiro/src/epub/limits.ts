import type JSZip from 'jszip';

/** Resource limits applied while opening an untrusted EPUB archive. */
export interface EpubParseLimits {
  /** Largest accepted compressed input, in bytes. @defaultValue 100 MiB */
  maxInputBytes: number;
  /** Largest number of non-directory ZIP entries. @defaultValue 10,000 */
  maxEntries: number;
  /** Largest allowed expanded entry, in bytes. @defaultValue 50 MiB */
  maxEntryBytes: number;
  /** Largest allowed total expanded archive, in bytes. @defaultValue 200 MiB */
  maxTotalBytes: number;
  /** Largest allowed per-entry expansion ratio. @defaultValue 1,000 */
  maxCompressionRatio: number;
}

/** Defaults for safely opening user-provided EPUB archives. */
export const DEFAULT_EPUB_PARSE_LIMITS: Readonly<EpubParseLimits> = {
  maxInputBytes: 100 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 50 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 1_000,
};

/** Options shared by read-only and editable EPUB import APIs. */
export interface EpubParseOptions {
  /** Override one or more archive resource limits for a trusted environment. */
  limits?: Partial<EpubParseLimits>;
}

interface ZipObjectWithSizes extends JSZip.JSZipObject {
  _data?: { compressedSize?: number; uncompressedSize?: number };
}

/** Resolves caller limits and rejects malformed limit values early. */
export function resolveEpubParseLimits(options: EpubParseOptions = {}): EpubParseLimits {
  const limits = { ...DEFAULT_EPUB_PARSE_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`EPUB parse limit ${name} must be a positive integer`);
    }
  }
  return limits;
}

/** Checks ZIP metadata before any entry contents are decompressed. */
export function assertEpubArchiveWithinLimits(
  input: ArrayBuffer,
  zip: JSZip,
  limits: EpubParseLimits,
): void {
  if (input.byteLength > limits.maxInputBytes) {
    throw new Error(`EPUB exceeds the compressed input limit (${limits.maxInputBytes} bytes)`);
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir) as ZipObjectWithSizes[];
  if (entries.length > limits.maxEntries) {
    throw new Error(`EPUB exceeds the entry limit (${limits.maxEntries})`);
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    const { compressedSize, uncompressedSize } = entry._data ?? {};
    if (!(isByteCount(compressedSize) && isByteCount(uncompressedSize))) {
      throw new Error(`EPUB entry has unavailable size metadata: ${entry.name}`);
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new Error(`EPUB entry exceeds the expanded size limit: ${entry.name}`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalBytes) {
      throw new Error(`EPUB exceeds the total expanded size limit (${limits.maxTotalBytes} bytes)`);
    }
    if (
      uncompressedSize > 0 &&
      uncompressedSize / Math.max(compressedSize, 1) > limits.maxCompressionRatio
    ) {
      throw new Error(`EPUB entry exceeds the compression ratio limit: ${entry.name}`);
    }
  }
}

function isByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
