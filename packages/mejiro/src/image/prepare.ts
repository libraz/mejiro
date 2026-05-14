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
   * Output format. `auto` keeps the source format unless it is unsupported
   * (e.g. AVIF) — in that case the image is re-encoded as `image/jpeg`.
   */
  convertTo?: 'auto' | 'webp' | 'jpeg' | 'png';
  /** Initial JPEG/WebP quality. Default: 0.85. */
  quality?: number;
}

/** Result of preparing an image for EPUB embedding. */
export interface PrepareImageResult {
  /** Re-encoded binary payload, ready to drop into an EPUB. */
  data: Uint8Array;
  /** MIME type of {@link PrepareImageResult.data}. */
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
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;

  const scale = Math.min(1, config.maxWidth / sourceWidth, config.maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (scale < 1) {
    warnings.push(`Image downscaled from ${sourceWidth}x${sourceHeight} to ${width}x${height}`);
  }

  const sourceType = sniffMediaType(file);
  const targetType = resolveTargetType(config.convertTo, sourceType, warnings);

  try {
    let quality = config.quality;
    let blob = await renderToBlob(bitmap, width, height, targetType, quality);
    while (
      blob.size > config.maxBytes &&
      quality > 0.4 &&
      (targetType === 'image/jpeg' || targetType === 'image/webp')
    ) {
      quality = Math.max(0.4, quality - 0.1);
      blob = await renderToBlob(bitmap, width, height, targetType, quality);
    }
    if (blob.size > config.maxBytes) {
      warnings.push(
        `Encoded size ${blob.size} bytes exceeds maxBytes (${config.maxBytes}); quality is already at ${quality.toFixed(2)}`,
      );
    } else if (quality < config.quality) {
      warnings.push(`Quality reduced to ${quality.toFixed(2)} to fit maxBytes`);
    }

    const data = new Uint8Array(await blob.arrayBuffer());
    return { data, mediaType: targetType, width, height, warnings };
  } finally {
    bitmap.close?.();
  }
}

async function decodeImage(file: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('prepareImage requires createImageBitmap (browser/worker environment)');
  }
  return createImageBitmap(file);
}

function sniffMediaType(file: Blob): string {
  return file.type || 'application/octet-stream';
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
