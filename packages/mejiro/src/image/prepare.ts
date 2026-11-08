import type { MejiroWarning } from '../errors.js';
import { MejiroError } from '../errors.js';

/**
 * Options for {@link prepareImage}. All fields are optional; defaults are
 * conservative so calling `prepareImage(file)` is safe. A field set to
 * `undefined` takes its default, exactly as if it were omitted.
 */
export interface PrepareImageOptions {
  /**
   * Maximum file size in bytes after re-encoding. If the encoded image still
   * exceeds this size, `prepareImage` keeps reducing the JPEG/WebP quality
   * (down to 0.4) before reporting a `max-bytes-exceeded` warning.
   * @defaultValue 2097152 (2 MiB)
   */
  maxBytes?: number;
  /**
   * Maximum width in CSS pixels after downscale.
   * @defaultValue 2048
   */
  maxWidth?: number;
  /**
   * Maximum height in CSS pixels after downscale.
   * @defaultValue 2048
   */
  maxHeight?: number;
  /**
   * Output format. `auto` keeps the source format when it is JPEG, PNG or WebP,
   * re-encodes GIF as `image/png` (animation is flattened), and falls back to
   * `image/jpeg` for anything else (e.g. AVIF).
   *
   * The request is not a guarantee: a platform that cannot encode the requested
   * format silently produces another one, and
   * {@link PrepareImageResult.mediaType} then reports what was actually written.
   * @defaultValue 'auto'
   */
  convertTo?: 'auto' | 'webp' | 'jpeg' | 'png';
  /**
   * Initial JPEG/WebP quality, from 0 to 1.
   * @defaultValue 0.85
   */
  quality?: number;
  /**
   * Cancels the preparation. The returned promise then rejects with
   * `signal.reason` (an `AbortError` by default), also when the signal is
   * already aborted at the call. The decoded bitmap is released either way.
   * @defaultValue no cancellation
   */
  signal?: AbortSignal;
}

/** Result of preparing an image for EPUB embedding. */
export interface PrepareImageResult {
  /** Re-encoded binary payload, ready to drop into an EPUB. */
  data: Uint8Array<ArrayBuffer>;
  /**
   * MIME type of the bytes in {@link PrepareImageResult.data}, taken from the
   * encoder's output rather than from the requested format. Browsers that
   * cannot encode the requested format fall back to another one.
   */
  mediaType: string;
  /** Decoded pixel width after any downscale step. */
  width: number;
  /** Decoded pixel height after any downscale step. */
  height: number;
  /** Degradations the caller may want to act on. Empty when the result is as requested. */
  warnings: readonly MejiroWarning[];
}

const DEFAULTS = {
  maxBytes: 2 * 1024 * 1024,
  maxWidth: 2048,
  maxHeight: 2048,
  convertTo: 'auto' as const,
  quality: 0.85,
};

type ResolvedOptions = Required<Omit<PrepareImageOptions, 'signal'>>;

/**
 * Fills each unset field from {@link DEFAULTS} and rejects bounds no encoder can
 * honour and a `signal` that is not an `AbortSignal`.
 */
function resolveOptions(options: PrepareImageOptions): ResolvedOptions {
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new TypeError('prepareImage: signal must be an AbortSignal');
  }
  const config: ResolvedOptions = {
    maxBytes: options.maxBytes ?? DEFAULTS.maxBytes,
    maxWidth: options.maxWidth ?? DEFAULTS.maxWidth,
    maxHeight: options.maxHeight ?? DEFAULTS.maxHeight,
    convertTo: options.convertTo ?? DEFAULTS.convertTo,
    quality: options.quality ?? DEFAULTS.quality,
  };
  for (const key of ['maxBytes', 'maxWidth', 'maxHeight'] as const) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) {
      throw new RangeError(`prepareImage: ${key} must be a positive finite number`);
    }
  }
  if (!Number.isFinite(config.quality) || config.quality < 0 || config.quality > 1) {
    throw new RangeError('prepareImage: quality must be a finite number between 0 and 1');
  }
  return config;
}

/**
 * Decodes an image, downscales it if it exceeds the given pixel bounds, and
 * re-encodes it to fit within {@link PrepareImageOptions.maxBytes}.
 *
 * Runs only in browsers (uses `createImageBitmap`, `OffscreenCanvas`, and
 * `HTMLCanvasElement`). The library itself does not depend on this module —
 * import it from `@libraz/mejiro/image` only when needed.
 *
 * The input is only read: it is neither retained nor modified, and `data` in
 * the result is a fresh `Uint8Array` that owns its buffer. A result that still
 * exceeds `maxBytes` at the lowest quality is returned, not thrown, with a
 * `max-bytes-exceeded` entry in `warnings`.
 *
 * @param file - The image to prepare; any format the platform can decode.
 * @param options - Bounds, output format and cancellation.
 * @returns The re-encoded image with its final size and media type.
 * @throws RangeError if `maxBytes`, `maxWidth` or `maxHeight` is not a positive
 *   finite number, or `quality` is not a finite number in [0, 1].
 * @throws TypeError if `options.signal` is set but is not an `AbortSignal`.
 * @throws MejiroError with code `environment-unsupported` when
 *   `createImageBitmap`, or both `OffscreenCanvas` and a document canvas with a
 *   2D context, are missing.
 * @throws MejiroError with code `image-decode-failed` when the platform cannot
 *   decode `file`; the platform error is the `cause`.
 * @throws MejiroError with code `image-encode-failed` when the canvas cannot
 *   encode the image; the platform error, if any, is the `cause`.
 * @throws The `signal.reason` when `options.signal` aborts, which is an
 *   `AbortError` unless the caller aborted with another reason.
 */
export async function prepareImage(
  file: Blob | File,
  options: PrepareImageOptions = {},
): Promise<PrepareImageResult> {
  const config = resolveOptions(options);
  const { signal } = options;
  const warnings: MejiroWarning[] = [];

  signal?.throwIfAborted();
  const bitmap = await decodeImage(file, signal);

  // Everything that runs after the bitmap exists belongs inside the try, so no
  // exit path can leave a decoded bitmap holding GPU/CPU memory.
  try {
    signal?.throwIfAborted();
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;

    const scale = Math.min(1, config.maxWidth / sourceWidth, config.maxHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const sourceType = await sniffMediaType(file);
    signal?.throwIfAborted();
    const targetType = resolveTargetType(config.convertTo, sourceType);

    let quality = config.quality;
    let blob = await renderToBlob(bitmap, width, height, targetType, quality);
    signal?.throwIfAborted();
    // Quality only affects lossy encoders, so the decay loop is driven by what
    // the canvas actually produced — not by what was asked for.
    let encodedType = encodedMediaType(blob, targetType);
    while (
      blob.size > config.maxBytes &&
      quality > 0.4 &&
      (encodedType === 'image/jpeg' || encodedType === 'image/webp')
    ) {
      quality = Math.max(0.4, quality - 0.1);
      blob = await renderToBlob(bitmap, width, height, targetType, quality);
      signal?.throwIfAborted();
      encodedType = encodedMediaType(blob, targetType);
    }
    if (blob.size > config.maxBytes) {
      warnings.push({
        code: 'max-bytes-exceeded',
        message: `Encoded size ${blob.size} bytes exceeds maxBytes (${config.maxBytes}); quality is already at ${quality.toFixed(2)}`,
      });
    }

    const data = new Uint8Array(await blob.arrayBuffer());
    signal?.throwIfAborted();
    return { data, mediaType: encodedType, width, height, warnings };
  } finally {
    bitmap.close?.();
  }
}

/**
 * MIME type of an encoded blob, without any parameters. Falls back to the
 * requested type when the platform leaves `Blob.type` empty.
 */
function encodedMediaType(blob: Blob, targetType: string): string {
  const declared = blob.type.split(';', 1)[0].trim().toLowerCase();
  return declared || targetType;
}

/**
 * Decodes `file`, wrapping a platform decode failure. A failure the abort
 * itself caused is reported as the abort, not as a decode failure.
 */
async function decodeImage(file: Blob, signal: AbortSignal | undefined): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new MejiroError(
      'environment-unsupported',
      'prepareImage requires createImageBitmap (browser/worker environment)',
    );
  }
  try {
    return await createImageBitmap(file);
  } catch (cause) {
    signal?.throwIfAborted();
    throw new MejiroError('image-decode-failed', 'prepareImage could not decode the image', {
      cause,
    });
  }
}

/** Source media type: the magic bytes when they identify one, else the declared type. */
async function sniffMediaType(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return mediaTypeFromMagicBytes(bytes) ?? (file.type || 'application/octet-stream');
}

function mediaTypeFromMagicBytes(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

function resolveTargetType(
  convertTo: NonNullable<PrepareImageOptions['convertTo']>,
  sourceType: string,
): string {
  if (convertTo === 'webp') return 'image/webp';
  if (convertTo === 'jpeg') return 'image/jpeg';
  if (convertTo === 'png') return 'image/png';

  if (sourceType === 'image/jpeg' || sourceType === 'image/png' || sourceType === 'image/webp') {
    return sourceType;
  }
  if (sourceType === 'image/gif') return 'image/png';
  return 'image/jpeg';
}

async function renderToBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  mediaType: string,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new MejiroError(
        'environment-unsupported',
        'prepareImage could not acquire a 2D context on OffscreenCanvas',
      );
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    try {
      return await canvas.convertToBlob({ type: mediaType, quality });
    } catch (cause) {
      throw new MejiroError('image-encode-failed', 'prepareImage could not encode the image', {
        cause,
      });
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new MejiroError(
        'environment-unsupported',
        'prepareImage could not acquire a 2D context on HTMLCanvasElement',
      );
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(
                new MejiroError('image-encode-failed', 'prepareImage could not encode the image'),
              ),
        mediaType,
        quality,
      );
    });
  }

  throw new MejiroError(
    'environment-unsupported',
    'prepareImage requires OffscreenCanvas or HTMLCanvasElement',
  );
}
