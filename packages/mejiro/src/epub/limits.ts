import type JSZip from 'jszip';
import { MejiroError } from '../errors.js';
import { mergeDefined } from '../merge.js';
import type { BinaryInput } from '../types.js';

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
  /**
   * Cancels the import. The returned promise rejects with `signal.reason`, at
   * the latest once the current step finishes; a signal that is already aborted
   * rejects without reading the archive.
   */
  signal?: AbortSignal;
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
  const limits = mergeDefined<EpubParseLimits>(DEFAULT_EPUB_PARSE_LIMITS, options.limits ?? {});
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`EPUB parse limit ${name} must be a positive integer`);
    }
  }
  return limits;
}

/**
 * Throws `signal.reason` when `signal` has been aborted.
 *
 * @param signal - Signal of the running import, if any.
 * @throws {TypeError} When `signal` is not an `AbortSignal`.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal === undefined) return;
  // Checked by shape: a signal made by another realm's AbortController is not an instance of this one's.
  if (
    typeof signal !== 'object' ||
    signal === null ||
    typeof signal.aborted !== 'boolean' ||
    typeof signal.addEventListener !== 'function'
  ) {
    throw new TypeError('EPUB parse option signal must be an AbortSignal');
  }
  if (signal.aborted) throw signal.reason;
}

/**
 * Checks that `data` is an `ArrayBuffer` or `Uint8Array`.
 *
 * @param data - Value handed to an EPUB import entry point.
 * @throws {TypeError} When `data` is neither.
 */
export function assertBinaryInput(data: unknown): asserts data is BinaryInput {
  // Checked by shape for the same cross-realm reason as the signal.
  const tag = Object.prototype.toString.call(data);
  if (tag === '[object ArrayBuffer]' || tag === '[object Uint8Array]') return;
  throw new TypeError('EPUB data must be an ArrayBuffer or a Uint8Array');
}

/**
 * Throws when an EPUB of `byteLength` compressed bytes exceeds the resolved
 * `maxInputBytes`. Lets a caller holding a `File` reject it by `file.size`
 * before reading any of its bytes into memory.
 *
 * @param byteLength - Compressed size of the EPUB, in bytes.
 * @param limits - Limits overriding {@link DEFAULT_EPUB_PARSE_LIMITS}.
 * @throws {MejiroError} `epub-limit-exceeded` when `byteLength` is over the limit.
 * @throws {RangeError} When a limit is not a positive integer.
 */
export function assertEpubInputSize(
  byteLength: number,
  limits: Partial<EpubParseLimits> = {},
): void {
  const { maxInputBytes } = resolveEpubParseLimits({ limits });
  if (byteLength > maxInputBytes) {
    throw new MejiroError(
      'epub-limit-exceeded',
      `EPUB exceeds the compressed input limit (${maxInputBytes} bytes)`,
    );
  }
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
  input: BinaryInput,
  zip: JSZip,
  limits: EpubParseLimits,
): void {
  assertEpubInputSize(input.byteLength, limits);

  const entries = Object.values(zip.files).filter((entry) => !entry.dir) as ZipObjectWithSizes[];
  if (entries.length > limits.maxEntries) {
    throw new MejiroError(
      'epub-limit-exceeded',
      `EPUB exceeds the entry limit (${limits.maxEntries})`,
    );
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    const { compressedSize, uncompressedSize } = entry._data ?? {};
    if (!(isByteCount(compressedSize) && isByteCount(uncompressedSize))) {
      throw new MejiroError(
        'epub-invalid-archive',
        `EPUB entry has unavailable size metadata: ${entry.name}`,
      );
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new MejiroError(
        'epub-limit-exceeded',
        `EPUB entry exceeds the expanded size limit: ${entry.name}`,
      );
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalBytes) {
      throw new MejiroError(
        'epub-limit-exceeded',
        `EPUB exceeds the total expanded size limit (${limits.maxTotalBytes} bytes)`,
      );
    }
    if (
      uncompressedSize > 0 &&
      uncompressedSize / Math.max(compressedSize, 1) > limits.maxCompressionRatio
    ) {
      throw new MejiroError(
        'epub-limit-exceeded',
        `EPUB entry exceeds the compression ratio limit: ${entry.name}`,
      );
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
  private readonly signal: AbortSignal | undefined;
  private used = 0;

  /**
   * @param limits - Resolved limits the reads are charged against.
   * @param signal - Stops a read in progress, at the next decompressed block, once aborted.
   */
  constructor(limits: EpubParseLimits, signal?: AbortSignal) {
    this.limits = limits;
    this.signal = signal;
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
      throwIfAborted(this.signal);
      const stream = (file as ZipObjectWithStream).internalStream('uint8array');
      const expansionCap = this.entryExpansionCap(file);
      let chunks: Uint8Array[] = [];
      let entryBytes = 0;
      let settled = false;

      const abort = (error: unknown): void => {
        settled = true;
        chunks = [];
        stream.pause();
        reject(error);
      };

      stream.on('data', (chunk) => {
        if (settled) return;
        if (this.signal?.aborted) {
          abort(this.signal.reason);
          return;
        }
        entryBytes += chunk.length;
        this.used += chunk.length;
        if (entryBytes > this.limits.maxEntryBytes) {
          abort(
            new MejiroError(
              'epub-limit-exceeded',
              `EPUB entry exceeds the expanded size limit: ${file.name}`,
            ),
          );
          return;
        }
        if (entryBytes > expansionCap) {
          abort(
            new MejiroError(
              'epub-limit-exceeded',
              `EPUB entry exceeds the compression ratio limit: ${file.name}`,
            ),
          );
          return;
        }
        if (this.used > this.limits.maxTotalBytes) {
          abort(
            new MejiroError(
              'epub-limit-exceeded',
              `EPUB exceeds the total expanded size limit (${this.limits.maxTotalBytes} bytes)`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', (error: unknown) => {
        if (settled) return;
        abort(
          new MejiroError('epub-invalid-archive', `EPUB entry cannot be read: ${file.name}`, {
            cause: error,
          }),
        );
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
