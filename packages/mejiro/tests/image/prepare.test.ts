/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareImage } from '../../src/image/index.js';

describe('prepareImage', () => {
  beforeEach(() => {
    // happy-dom does not implement createImageBitmap or OffscreenCanvas.
    // Stub them so the encode pipeline can be exercised end-to-end.
    const fakeBitmap = { width: 1024, height: 768, close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap),
    );
    class StubOffscreen {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(_kind: string): { drawImage: () => void } {
        return { drawImage: () => {} };
      }
      async convertToBlob(opts: { type: string; quality?: number }): Promise<Blob> {
        // Encode size scales loosely with quality so the quality-decay loop
        // is observable in tests.
        const baseBytes = this.width * this.height;
        const q = opts.quality ?? 1;
        const size = Math.max(64, Math.floor(baseBytes * q * 0.05));
        return new Blob([new Uint8Array(size)], { type: opts.type });
      }
    }
    vi.stubGlobal('OffscreenCanvas', StubOffscreen as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns encoded data matching the requested format', async () => {
    const file = new Blob([new Uint8Array(16)], { type: 'image/png' });
    const result = await prepareImage(file, { convertTo: 'jpeg' });
    expect(result.mediaType).toBe('image/jpeg');
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
  });

  it('downscales when the image exceeds the configured bounds', async () => {
    const file = new Blob([new Uint8Array(16)], { type: 'image/jpeg' });
    const result = await prepareImage(file, { maxWidth: 512, maxHeight: 512 });
    expect(result.width).toBeLessThanOrEqual(512);
    expect(result.height).toBeLessThanOrEqual(512);
    expect(result.warnings.some((w) => /downscaled/.test(w))).toBe(true);
  });

  it('warns when encoded size still exceeds maxBytes after quality decay', async () => {
    const file = new Blob([new Uint8Array(16)], { type: 'image/jpeg' });
    const result = await prepareImage(file, { maxBytes: 4_000, quality: 0.85 });
    expect(result.warnings.some((w) => /Encoded size/.test(w))).toBe(true);
  });

  it('reports the reduced quality when smaller files fit within maxBytes', async () => {
    const file = new Blob([new Uint8Array(16)], { type: 'image/jpeg' });
    // Allow downscale so the stub's encoded size collapses below maxBytes.
    const result = await prepareImage(file, {
      maxBytes: 500,
      maxWidth: 128,
      maxHeight: 128,
      quality: 0.85,
    });
    expect(result.warnings.some((w) => /Quality reduced/.test(w))).toBe(true);
  });

  it('falls back to JPEG when the source type is unsupported', async () => {
    const file = new Blob([new Uint8Array(16)], { type: 'image/avif' });
    const result = await prepareImage(file);
    expect(result.mediaType).toBe('image/jpeg');
    expect(result.warnings.some((w) => /Unsupported source type/.test(w))).toBe(true);
  });

  it('keeps source type when convertTo is auto and source is supported', async () => {
    const file = new Blob([new Uint8Array(16)], { type: 'image/webp' });
    const result = await prepareImage(file);
    expect(result.mediaType).toBe('image/webp');
  });

  it('throws when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const file = new Blob([new Uint8Array(16)], { type: 'image/png' });
    await expect(prepareImage(file)).rejects.toThrow(/createImageBitmap/);
  });

  it('closes the decoded bitmap when encoding fails', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 16, height: 16, close }) as unknown as ImageBitmap),
    );
    class FailingOffscreen {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext(_kind: string): { drawImage: () => void } {
        return { drawImage: () => {} };
      }
      async convertToBlob(): Promise<Blob> {
        throw new Error('encode failed');
      }
    }
    vi.stubGlobal('OffscreenCanvas', FailingOffscreen as unknown as typeof OffscreenCanvas);

    const file = new Blob([new Uint8Array(16)], { type: 'image/png' });
    await expect(prepareImage(file)).rejects.toThrow(/encode failed/);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
