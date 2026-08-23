/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontLoader } from '../../src/browser/font-loader.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FontLoader', () => {
  it('marks the font as loaded when document.fonts.check returns true upfront', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const loader = new FontLoader();
    await loader.ensureLoaded('16px serif');
    expect(loader.isLoaded('16px serif')).toBe(true);
  });

  it('throws "Font load failed" when document.fonts.check still returns false after load', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(false);
    vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const loader = new FontLoader();
    await expect(loader.ensureLoaded('16px "NoSuchFont"')).rejects.toThrow(
      'Font load failed: 16px "NoSuchFont"',
    );
    expect(loader.isLoaded('16px "NoSuchFont"')).toBe(false);
  });

  it('does not wait for unrelated document.fonts.ready work after the target font loads', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const originalReady = Object.getOwnPropertyDescriptor(document.fonts, 'ready');
    Object.defineProperty(document.fonts, 'ready', {
      configurable: true,
      value: new Promise<FontFaceSet>(() => {}),
    });

    try {
      const loader = new FontLoader();
      await expect(loader.ensureLoaded('16px serif')).resolves.toBeUndefined();
      expect(loader.isLoaded('16px serif')).toBe(true);
    } finally {
      if (originalReady) {
        Object.defineProperty(document.fonts, 'ready', originalReady);
      } else {
        delete (document.fonts as FontFaceSet & { ready?: Promise<FontFaceSet> }).ready;
      }
    }
  });

  it('treats a locally installed family with no FontFace as available', async () => {
    // A font installed on the OS has no FontFace entry, yet the host can render
    // it — check() is the authority.
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const load = vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    Object.defineProperty(document.fonts, Symbol.iterator, {
      configurable: true,
      value: function* () {},
    });

    const loader = new FontLoader();
    await expect(loader.ensureLoaded('16px "ヒラギノ明朝 ProN"')).resolves.toBeUndefined();
    expect(loader.isLoaded('16px "ヒラギノ明朝 ProN"')).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('asks about the ranges of the text that will be measured', async () => {
    // Models a webfont whose Latin subset has arrived but whose CJK subset has not.
    const fetched = new Set(['latin']);
    vi.spyOn(document.fonts, 'check').mockImplementation((_spec: string, text?: string) => {
      const sample = text ?? '';
      return ![...sample].some((ch) => ch > '　') || fetched.has('cjk');
    });
    const load = vi.spyOn(document.fonts, 'load').mockImplementation(async () => {
      fetched.add('cjk');
      return [];
    });

    const loader = new FontLoader();
    // A Latin-only paragraph needs no CJK subset.
    await loader.ensureLoaded('16px "Noto Serif JP"', 'Hello');
    expect(load).not.toHaveBeenCalled();

    // Japanese text must wait for the subset that actually covers it.
    await loader.ensureLoaded('16px "Noto Serif JP"', 'こんにちは');
    expect(load).toHaveBeenCalledTimes(1);
    expect(fetched.has('cjk')).toBe(true);
  });

  it('keeps readiness per coverage, not per font spec', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const loader = new FontLoader();

    await loader.ensureLoaded('16px "Noto Serif JP"', 'Hello');

    expect(loader.isLoaded('16px "Noto Serif JP"', 'Hello')).toBe(true);
    expect(loader.isLoaded('16px "Noto Serif JP"', 'こんにちは')).toBe(false);
  });

  /**
   * Installs the `loadingdone` listener plumbing a real FontFaceSet has and
   * returns both a way to fire the event and a way to undo the installation.
   */
  function withLoadingDoneSupport(): { fire: () => void; restore: () => void } {
    const handlers: EventListener[] = [];
    const target = document.fonts as FontFaceSet & {
      addEventListener?: FontFaceSet['addEventListener'];
    };
    const original = Object.getOwnPropertyDescriptor(target, 'addEventListener');
    Object.defineProperty(target, 'addEventListener', {
      configurable: true,
      writable: true,
      value: (type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (type === 'loadingdone' && typeof listener === 'function') handlers.push(listener);
      },
    });

    return {
      fire: () => {
        expect(handlers).toHaveLength(1);
        handlers[0](new Event('loadingdone'));
      },
      restore: () => {
        if (original) Object.defineProperty(target, 'addEventListener', original);
        else delete target.addEventListener;
      },
    };
  }

  it('invalidates readiness and notifies the caller on loadingdone', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const { fire, restore } = withLoadingDoneSupport();
    try {
      const onFontsLoaded = vi.fn();
      const loader = new FontLoader({ onFontsLoaded });

      await loader.ensureLoaded('16px serif');
      expect(loader.isLoaded('16px serif')).toBe(true);
      expect(onFontsLoaded).not.toHaveBeenCalled();

      fire();

      expect(onFontsLoaded).toHaveBeenCalledTimes(1);
      // A font that arrives later can change metrics, so the cached answer for
      // every spec is dropped rather than kept.
      expect(loader.isLoaded('16px serif')).toBe(false);
    } finally {
      restore();
    }
  });

  it('drops cached readiness on loadingdone even without a callback', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const { fire, restore } = withLoadingDoneSupport();
    try {
      const loader = new FontLoader();

      await loader.ensureLoaded('16px serif');
      expect(() => fire()).not.toThrow();

      expect(loader.isLoaded('16px serif')).toBe(false);
    } finally {
      restore();
    }
  });

  it('constructs without listener plumbing when the host has none', async () => {
    // happy-dom's FontFaceSet has no addEventListener, which is the shape the
    // loader has to tolerate on a partial host.
    vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const onFontsLoaded = vi.fn();

    const loader = new FontLoader({ onFontsLoaded });
    await loader.ensureLoaded('16px serif');

    expect(loader.isLoaded('16px serif')).toBe(true);
    expect(onFontsLoaded).not.toHaveBeenCalled();
  });

  it('resolves concurrent ensureLoaded calls for the same spec', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValueOnce(false).mockReturnValue(true);
    const load = vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const loader = new FontLoader();

    await Promise.all([
      loader.ensureLoaded('16px "Noto Serif JP"'),
      loader.ensureLoaded('16px "Noto Serif JP"'),
      loader.ensureLoaded('16px "Noto Serif JP"'),
    ]);

    expect(loader.isLoaded('16px "Noto Serif JP"')).toBe(true);
    // Every caller starts before any of them records readiness, so only the
    // shared in-flight request keeps them down to a single load.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('issues one load for concurrent callers and one per distinct spec', async () => {
    // Only the requested spec becomes available, so a shared request must not
    // be reused across specs.
    const availableSpecs = new Set<string>();
    vi.spyOn(document.fonts, 'check').mockImplementation((spec: string) =>
      availableSpecs.has(spec),
    );
    const load = vi.spyOn(document.fonts, 'load').mockImplementation(async (spec: string) => {
      // The font only arrives a turn later, so every concurrent caller reaches
      // the loader while it is still missing.
      await Promise.resolve();
      availableSpecs.add(spec);
      return [];
    });
    const loader = new FontLoader();

    await Promise.all([
      loader.ensureLoaded('16px "Noto Serif JP"'),
      loader.ensureLoaded('16px "Noto Serif JP"'),
      loader.ensureLoaded('16px "Noto Serif JP"'),
      loader.ensureLoaded('16px "Noto Serif JP"'),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toBe('16px "Noto Serif JP"');

    await loader.ensureLoaded('16px "Noto Sans JP"');

    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1][0]).toBe('16px "Noto Sans JP"');
  });

  it('retries the load after a failed one instead of caching the failure', async () => {
    let available = false;
    vi.spyOn(document.fonts, 'check').mockImplementation(() => available);
    const load = vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const loader = new FontLoader();

    const failures = await Promise.allSettled([
      loader.ensureLoaded('16px "Noto Serif JP"'),
      loader.ensureLoaded('16px "Noto Serif JP"'),
    ]);

    expect(failures.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(load).toHaveBeenCalledTimes(1);

    // A later call re-requests the font instead of replaying the rejection.
    await expect(loader.ensureLoaded('16px "Noto Serif JP"')).rejects.toThrow('Font load failed');
    expect(load).toHaveBeenCalledTimes(2);

    // Once the font is really there, the loader reports success again.
    available = true;
    await expect(loader.ensureLoaded('16px "Noto Serif JP"')).resolves.toBeUndefined();
    expect(loader.isLoaded('16px "Noto Serif JP"')).toBe(true);
  });

  it('reloads after loadingdone invalidates a spec it already loaded', async () => {
    let available = false;
    vi.spyOn(document.fonts, 'check').mockImplementation(() => available);
    const load = vi.spyOn(document.fonts, 'load').mockImplementation(async () => {
      available = true;
      return [];
    });
    const { fire, restore } = withLoadingDoneSupport();
    try {
      const loader = new FontLoader();
      await loader.ensureLoaded('16px "Noto Serif JP"');
      expect(load).toHaveBeenCalledTimes(1);

      // New faces arrived, so the previous answer is no longer trustworthy.
      fire();
      available = false;

      await loader.ensureLoaded('16px "Noto Serif JP"');
      expect(load).toHaveBeenCalledTimes(2);
      expect(loader.isLoaded('16px "Noto Serif JP"')).toBe(true);
    } finally {
      restore();
    }
  });

  it('does not reuse or record a load that loadingdone invalidated mid-flight', async () => {
    let available = false;
    vi.spyOn(document.fonts, 'check').mockImplementation(() => available);
    const releases: Array<(nextAvailability: boolean) => void> = [];
    const load = vi.spyOn(document.fonts, 'load').mockImplementation(
      () =>
        new Promise<FontFace[]>((resolve) => {
          releases.push((nextAvailability) => {
            available = nextAvailability;
            resolve([]);
          });
        }),
    );
    const { fire, restore } = withLoadingDoneSupport();
    try {
      const loader = new FontLoader();
      const stale = loader.ensureLoaded('16px "Noto Serif JP"');

      fire();
      const fresh = loader.ensureLoaded('16px "Noto Serif JP"');
      expect(load).toHaveBeenCalledTimes(2);

      releases[0](true);
      await expect(stale).resolves.toBeUndefined();

      releases[1](false);
      await expect(fresh).rejects.toThrow('Font load failed');

      // The invalidated attempt saw the font arrive, but its answer predates the
      // new faces and must not be written back into the cache.
      expect(loader.isLoaded('16px "Noto Serif JP"')).toBe(false);
    } finally {
      restore();
    }
  });

  it('rejects every concurrent caller when the font never becomes available', async () => {
    vi.spyOn(document.fonts, 'check').mockReturnValue(false);
    vi.spyOn(document.fonts, 'load').mockResolvedValue([]);
    const loader = new FontLoader();

    const results = await Promise.allSettled([
      loader.ensureLoaded('16px "NoSuchFont"'),
      loader.ensureLoaded('16px "NoSuchFont"'),
    ]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(loader.isLoaded('16px "NoSuchFont"')).toBe(false);
  });

  it('skips re-loading once a font is cached as loaded', async () => {
    const checkSpy = vi.spyOn(document.fonts, 'check').mockReturnValue(true);
    const loader = new FontLoader();
    await loader.ensureLoaded('16px serif');
    const callsAfterFirst = checkSpy.mock.calls.length;
    await loader.ensureLoaded('16px serif');
    expect(checkSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});
