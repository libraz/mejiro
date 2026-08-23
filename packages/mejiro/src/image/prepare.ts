/**
 * Options for {@link prepareImage}. All fields are optional; defaults are
 * conservative so calling `prepareImage(file)` is safe.
 */
export interface PrepareImageOptions {
  /**
   * Maximum file size in bytes after re-encoding. If the encoded image still
   * exceeds this size, `prepareImage` keeps reducing the JPEG/WebP quality
   * (down to 0.4) before emitting a warning. Default: 2 MiB.
   */
  maxBytes?: number;
  /** Maximum width in CSS pixels after downscale. Default: 2048. */
  maxWidth?: number;
  /** Maximum height in CSS pixels after downscale. Default: 2048. */
  maxHeight?: number;
  /**
   * Output format. `auto` keeps the source format when it is JPEG, PNG or WebP,
   * re-encodes GIF as `image/png` (animation is flattened), and falls back to
   * `image/jpeg` for anything else (e.g. AVIF).
   *
   * The request is not a guarantee: a platform that cannot encode the requested
   * format silently produces another one, and
   * {@link PrepareImageResult.mediaType} then reports what was actually written.
   */
  convertTo?: 'auto' | 'webp' | 'jpeg' | 'png';
  /** Initial JPEG/WebP quality. Default: 0.85. */
  quality?: number;
}

/** Result of preparing an image for EPUB embedding. */
export interface PrepareImageResult {
  /** Re-encoded binary payload, ready to drop into an EPUB. */
  data: Uint8Array;
  /**
   * MIME type of the bytes in {@link PrepareImageResult.data}, taken from the
   * encoder's output rather than from the requested format. Browsers that
   * cannot encode the requested format fall back to another one; a warning is
   * added whenever that happens.
   */
  mediaType: string;
  /** Decoded pixel width after any downscale step. */
  width: number;
  /** Decoded pixel height after any downscale step. */
  height: number;
  /** Diagnostic notices (downscaling, quality drops, format fallbacks). */
  warnings: string[];
}

const DEFAULTS = {
  maxBytes: 2 * 1024 * 1024,
  maxWidth: 2048,
  maxHeight: 2048,
  convertTo: 'auto' as const,
  quality: 0.85,
};

/**
 * Decodes an image, downscales it if it exceeds the given pixel bounds, and
 * re-encodes it to fit within {@link PrepareImageOptions.maxBytes}.
 *
 * Runs only in browsers (uses `createImageBitmap`, `OffscreenCanvas`, and
 * `HTMLCanvasElement`). The library itself does not depend on this module —
 * import it from `@libraz/mejiro/image` only when needed.
 */
export async function prepareImage(
  file: Blob | File,
  options: PrepareImageOptions = {},
): Promise<PrepareImageResult> {
  const config = { ...DEFAULTS, ...options };
  const warnings: string[] = [];

  const bitmap = await decodeImage(file);

  // Everything that runs after the bitmap exists belongs inside the try, so no
  // exit path can leave a decoded bitmap holding GPU/CPU memory.
  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;

    const scale = Math.min(1, config.maxWidth / sourceWidth, config.maxHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    if (scale < 1) {
      warnings.push(`Image downscaled from ${sourceWidth}x${sourceHeight} to ${width}x${height}`);
    }

    const sourceType = await sniffMediaType(file, warnings);
    const targetType = resolveTargetType(config.convertTo, sourceType, warnings);
    warnAboutPotentialFlattening(sourceType, targetType, warnings);

    let quality = config.quality;
    let blob = await renderToBlob(bitmap, width, height, targetType, quality);
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
      encodedType = encodedMediaType(blob, targetType);
    }
    if (encodedType !== targetType) {
      warnings.push(
        `Canvas encoded the image as "${encodedType}" instead of the requested "${targetType}"`,
      );
    }
    if (blob.size > config.maxBytes) {
      warnings.push(
        `Encoded size ${blob.size} bytes exceeds maxBytes (${config.maxBytes}); quality is already at ${quality.toFixed(2)}`,
      );
    } else if (quality < config.quality) {
      warnings.push(`Quality reduced to ${quality.toFixed(2)} to fit maxBytes`);
    }

    const data = new Uint8Array(await blob.arrayBuffer());
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

async function decodeImage(file: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('prepareImage requires createImageBitmap (browser/worker environment)');
  }
  return createImageBitmap(file);
}

async function sniffMediaType(file: Blob, warnings: string[]): Promise<string> {
  const declared = file.type || '';
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const detected = mediaTypeFromMagicBytes(bytes);
  if (detected) {
    if (declared && declared !== detected) {
      warnings.push(`Declared source type "${declared}" does not match image bytes "${detected}"`);
    }
    return detected;
  }
  return declared || 'application/octet-stream';
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
  warnings: string[],
): string {
  if (convertTo === 'webp') return 'image/webp';
  if (convertTo === 'jpeg') return 'image/jpeg';
  if (convertTo === 'png') return 'image/png';

  if (sourceType === 'image/jpeg' || sourceType === 'image/png' || sourceType === 'image/webp') {
    return sourceType;
  }
  if (sourceType === 'image/gif') return 'image/png';
  warnings.push(`Unsupported source type "${sourceType}" — re-encoded as JPEG`);
  return 'image/jpeg';
}

function warnAboutPotentialFlattening(
  sourceType: string,
  targetType: string,
  warnings: string[],
): void {
  if (sourceType === 'image/png' && targetType === 'image/jpeg') {
    warnings.push('PNG transparency may be flattened when re-encoded as JPEG');
  }
  if (sourceType === 'image/gif' && targetType !== 'image/gif') {
    warnings.push('GIF animation is flattened to a static image during re-encoding');
  }
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
    if (!ctx) throw new Error('Failed to acquire 2D context on OffscreenCanvas');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: mediaType, quality });
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D context on HTMLCanvasElement');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('toBlob returned null'))),
        mediaType,
        quality,
      );
    });
  }

  throw new Error('prepareImage requires OffscreenCanvas or HTMLCanvasElement');
}
