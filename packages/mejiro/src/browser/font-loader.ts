/**
 * Representative character per Unicode range mejiro measures.
 *
 * Webfont services split Japanese families into subsets, so a family can
 * report itself loaded while only its Latin subset has arrived — measuring CJK
 * then silently falls back to another font. Probing one character per range
 * keeps the readiness answer honest without pushing whole paragraphs through
 * `document.fonts.check()`.
 */
const COVERAGE_PROBES: ReadonlyArray<{ sample: string; covers: (cp: number) => boolean }> = [
  { sample: 'A', covers: (cp) => cp < 0x0100 },
  { sample: '、', covers: (cp) => cp >= 0x3000 && cp <= 0x303f },
  { sample: 'あ', covers: (cp) => cp >= 0x3040 && cp <= 0x309f },
  { sample: 'ア', covers: (cp) => cp >= 0x30a0 && cp <= 0x30ff },
  {
    sample: '漢',
    covers: (cp) => (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff),
  },
  { sample: 'Ａ', covers: (cp) => cp >= 0xff00 && cp <= 0xffef },
];

/** Sample used when the caller does not name the text it is about to measure. */
const FULL_COVERAGE_SAMPLE = COVERAGE_PROBES.map((probe) => probe.sample).join('');

/**
 * Reduces text to one representative character per Unicode range it touches,
 * so readiness is asked about the ranges that will actually be measured while
 * the number of distinct answers stays bounded.
 */
function coverageSample(text?: string): string {
  if (text === undefined) return FULL_COVERAGE_SAMPLE;
  const hit = COVERAGE_PROBES.map(() => false);
  let remaining = COVERAGE_PROBES.length;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    for (let i = 0; i < COVERAGE_PROBES.length; i++) {
      if (hit[i] || !COVERAGE_PROBES[i].covers(cp)) continue;
      hit[i] = true;
      if (--remaining === 0) return FULL_COVERAGE_SAMPLE;
      break;
    }
  }
  const sample = COVERAGE_PROBES.filter((_, i) => hit[i])
    .map((probe) => probe.sample)
    .join('');
  // Text outside every known range still has to be covered by something.
  if (sample) return sample;
  return [...text][0] ?? '';
}

/**
 * Manages font loading via the CSS Font Loading API.
 * Ensures fonts are fully loaded before measurement begins.
 */
export class FontLoader {
  private loaded = new Set<string>();
  private inFlight = new Map<string, Promise<void>>();
  /**
   * Bumped whenever cached readiness is invalidated, so a load started before
   * the invalidation cannot record its now-stale answer afterwards.
   */
  private generation = 0;

  /**
   * Subscribes to the document's `loadingdone` event so the set of
   * already-loaded specs is discarded whenever new faces arrive — a family that
   * was only partially subsetted must be re-checked rather than trusted.
   *
   * Degrades to a no-op subscriber outside the browser (no `document` or no
   * `document.fonts`), which keeps SSR and Node test runs working; readiness
   * checks then resolve without waiting on anything.
   *
   * @param options - `onFontsLoaded` fires after each `loadingdone`, letting the
   *   host invalidate width caches measured against the previous faces.
   */
  constructor(options: { onFontsLoaded?: () => void } = {}) {
    if (typeof document === 'undefined' || !document.fonts) return;
    const fonts = document.fonts as FontFaceSet & {
      addEventListener?: FontFaceSet['addEventListener'];
    };
    fonts.addEventListener?.('loadingdone', () => {
      this.loaded.clear();
      this.inFlight.clear();
      this.generation++;
      options.onFontsLoaded?.();
    });
  }

  /**
   * Ensures the specified font is loaded and available for rendering.
   *
   * Readiness is asked about the Unicode ranges that will be measured, not
   * about the family in the abstract, so a family whose CJK subset is still in
   * flight is not reported as ready.
   *
   * Concurrent calls for the same spec and coverage share a single
   * `document.fonts.load()`: laying out a spread asks for the same font once
   * per column, and issuing one request per caller would multiply the webfont
   * traffic. A failed load is not cached, so the next call retries.
   *
   * @param fontSpec - CSS font specification (e.g. '16px "Noto Serif JP"').
   * @param text - Text about to be measured with this spec. Defaults to a
   *   representative sample spanning every range mejiro measures.
   * @throws If the font fails to load.
   */
  async ensureLoaded(fontSpec: string, text?: string): Promise<void> {
    // Everything up to the shared request runs synchronously, so callers made
    // in the same turn see each other's in-flight entry.
    const sample = coverageSample(text);
    const key = loadedKey(fontSpec, sample);
    if (this.loaded.has(key)) return;

    const started = this.inFlight.get(key);
    if (started) return started;

    if (this.isAvailable(fontSpec, text)) {
      this.loaded.add(key);
      return;
    }

    const generation = this.generation;
    const pending = this.load(fontSpec, text, sample).then(
      () => {
        // A `loadingdone` in the meantime already dropped this entry and may
        // have started a newer one, so the stale answer is discarded.
        if (generation !== this.generation) return;
        this.inFlight.delete(key);
        this.loaded.add(key);
      },
      (error: unknown) => {
        if (generation === this.generation) this.inFlight.delete(key);
        throw error;
      },
    );
    this.inFlight.set(key, pending);
    return pending;
  }

  /** Requests the font from the host and verifies it really became usable. */
  private async load(fontSpec: string, text: string | undefined, sample: string): Promise<void> {
    await document.fonts.load(fontSpec, sample);
    if (!this.isAvailable(fontSpec, text)) {
      throw new Error(`Font load failed: ${fontSpec}`);
    }
  }

  /**
   * Returns whether the specified font has been successfully loaded for the
   * ranges covered by `text`.
   *
   * @param fontSpec - CSS font specification to check.
   * @param text - Text whose ranges the answer applies to. Defaults to the
   *   representative sample used by {@link ensureLoaded}.
   */
  isLoaded(fontSpec: string, text?: string): boolean {
    return this.loaded.has(loadedKey(fontSpec, coverageSample(text)));
  }

  /**
   * Returns whether the host can render `fontSpec` for the ranges covered by
   * `text`.
   *
   * A family with no registered `FontFace` counts as available when the host
   * says it can render the sample — that is how locally installed fonts and
   * generic CSS families present themselves. Detecting a silent fallback to
   * another font is a separate, metric-based question; see the browser
   * integration's `strictFontCheck`.
   *
   * @param fontSpec - CSS font specification to check.
   * @param text - Text whose ranges the answer applies to.
   */
  isAvailable(fontSpec: string, text?: string): boolean {
    if (typeof document === 'undefined' || !document.fonts) return false;
    return document.fonts.check(fontSpec, coverageSample(text));
  }
}

function loadedKey(fontSpec: string, sample: string): string {
  return `${fontSpec}\u0000${sample}`;
}
