/**
 * @vitest-environment happy-dom
 */
import { CharMeasurer, FontLoader, MejiroError } from '@libraz/mejiro/browser';
import { describe, expect, it, vi } from 'vitest';

describe('FontLoader failures', () => {
  it('rejects with font-load-failed when the font is still unusable after loading', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(false);
    vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const loader = new FontLoader();

    await expect(loader.ensureLoaded('16px "NoSuchFont"')).rejects.toMatchObject({
      name: 'MejiroError',
      code: 'font-load-failed',
    });
  });

  it('rejects with font-load-failed, keeping the cause, when the host load itself fails', async () => {
    const cause = new Error('network down');
    vi.spyOn(document.fonts, 'check').mockReturnValue(false);
    vi.spyOn(document.fonts, 'load').mockRejectedValue(cause);
    const loader = new FontLoader();

    const error = await loader.ensureLoaded('16px "NoSuchFont"').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MejiroError);
    expect(error).toMatchObject({ code: 'font-load-failed', cause });
  });
});

describe('CharMeasurer failures', () => {
  it('throws environment-unsupported when the canvas has no 2d context', () => {
    const broken = { getContext: () => null } as unknown as HTMLCanvasElement;

    expect(() => new CharMeasurer({ canvas: broken })).toThrow(MejiroError);
    expect(() => new CharMeasurer({ canvas: broken })).toThrow(
      expect.objectContaining({ code: 'environment-unsupported' }),
    );
  });

  it('throws font-unavailable when the canvas rejects a font spec', () => {
    // A context that keeps its font unchanged for any spec it cannot parse.
    let font = '10px sans-serif';
    const ctx = {
      get font() {
        return font;
      },
      set font(value: string) {
        if (/^\d+px /.test(value)) font = value;
      },
      measureText: () => ({ width: 10 }),
    };
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const measurer = new CharMeasurer({ canvas });

    expect(() => measurer.measure('-16px serif', 0x3042)).toThrow(
      expect.objectContaining({ name: 'MejiroError', code: 'font-unavailable' }),
    );
    expect(() => measurer.measureAll('NaNpx serif', new Uint32Array([0x3042]))).toThrow(
      expect.objectContaining({ code: 'font-unavailable' }),
    );
  });
});
