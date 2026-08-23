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

interface ZipObjectWithStream extends JSZip.JSZipObject {
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
}

// JSZip decodes entry text as raw UTF-8; a leading BOM stays in the string.
const UTF8_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

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

/**
 * Checks ZIP metadata before any entry contents are decompressed.
 *
 * The sizes read here are self-declared by the archive and may under-report the
 * real expanded size, so this is only a cheap early rejection. The binding check
 * is {@link EpubExpansionBudget}, which measures what the decompressor actually
 * produces.
 */
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

/**
 * Enforces the expanded-size limits against the bytes a ZIP entry really
 * produces instead of the sizes the archive declares for itself.
 *
 * Every entry is decompressed as a stream: the accumulated buffer is released
 * and decompression is stopped as soon as `maxEntryBytes` (per entry),
 * `maxCompressionRatio` (per entry, against the compressed bytes the archive
 * really carries) or `maxTotalBytes` (across the archive) would be passed, so
 * an archive that under-reports its sizes never gets more than one
 * decompression block past the limit into memory.
 */
export class EpubExpansionBudget {
  private readonly limits: EpubParseLimits;
  private used = 0;

  constructor(limits: EpubParseLimits) {
    this.limits = limits;
  }

  /** Expanded bytes read through this budget so far. */
  get usedBytes(): number {
    return this.used;
  }

  /** Reads one ZIP entry as bytes, stopping early if a limit is passed. */
  async readBytes(file: JSZip.JSZipObject): Promise<Uint8Array> {
    return this.read(file);
  }

  /** Reads one ZIP entry as UTF-8 text, stopping early if a limit is passed. */
  async readText(file: JSZip.JSZipObject): Promise<string> {
    return UTF8_DECODER.decode(await this.read(file));
  }

  private read(file: JSZip.JSZipObject): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const stream = (file as ZipObjectWithStream).internalStream('uint8array');
      const expansionCap = this.entryExpansionCap(file);
      let chunks: Uint8Array[] = [];
      let entryBytes = 0;
      let settled = false;

      const abort = (error: Error): void => {
        settled = true;
        chunks = [];
        stream.pause();
        reject(error);
      };

      stream.on('data', (chunk) => {
        if (settled) return;
        entryBytes += chunk.length;
        this.used += chunk.length;
        if (entryBytes > this.limits.maxEntryBytes) {
          abort(new Error(`EPUB entry exceeds the expanded size limit: ${file.name}`));
          return;
        }
        if (entryBytes > expansionCap) {
          abort(new Error(`EPUB entry exceeds the compression ratio limit: ${file.name}`));
          return;
        }
        if (this.used > this.limits.maxTotalBytes) {
          abort(
            new Error(
              `EPUB exceeds the total expanded size limit (${this.limits.maxTotalBytes} bytes)`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', (error: unknown) => {
        if (settled) return;
        abort(error instanceof Error ? error : new Error(String(error)));
      });
      stream.on('end', () => {
        if (settled) return;
        settled = true;
        const result = new Uint8Array(entryBytes);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        chunks = [];
        resolve(result);
      });
      stream.resume();
    });
  }

  /**
   * Expanded bytes an entry may produce before its effective compression ratio
   * — real output over the compressed bytes the archive carries for it — passes
   * `maxCompressionRatio`.
   *
   * The declared expanded size is not consulted: an entry that under-reports it
   * clears the metadata check and would otherwise only be stopped by the total
   * byte budget, letting a single bomb expand up to the whole archive budget.
   * The compressed size stands in for real input because the archive has to
   * physically carry those bytes, which is the cost the ratio limit prices.
   *
   * Entries whose compressed size is unavailable are left uncapped here;
   * {@link assertEpubArchiveWithinLimits} rejects them before any read.
   */
  private entryExpansionCap(file: JSZip.JSZipObject): number {
    const { compressedSize } = (file as ZipObjectWithSizes)._data ?? {};
    if (!isByteCount(compressedSize)) return Number.POSITIVE_INFINITY;
    return Math.max(compressedSize, 1) * this.limits.maxCompressionRatio;
  }
}

function isByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
