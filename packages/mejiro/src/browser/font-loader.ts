/**
 * Representative character per Unicode range, asked about when the caller does
 * not name the text it is about to measure.
 *
 * Webfont services split Japanese families into subsets, so a family can
 * report itself loaded while only its Latin subset has arrived — measuring CJK
 * then silently falls back to another font.
 */
const FULL_COVERAGE_SAMPLE = 'A、あア漢Ａ';

/**
 * Reduces text to its distinct characters, in order of first appearance.
 *
 * Subsets are split by frequency, so one character per range proves nothing
 * about the slice holding another kanji or an ellipsis; every distinct
 * character the measurer will read is asked about, bounded by the size of the
 * character set rather than the text.
 */
function coverageSample(text?: string): string {
  if (text === undefined) return FULL_COVERAGE_SAMPLE;
  return [...new Set(text)].join('');
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

  private readonly onFontsLoaded?: () => void;
  /** The `loadingdone` subscription, or null while none is held. */
  private unsubscribe: (() => void) | null = null;
  /** Set by {@link dispose}: a `loadingdone` may have fired unheard since. */
  private missedEvents = false;

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
    this.onFontsLoaded = options.onFontsLoaded;
    this.subscribe();
  }

  /**
   * Removes the `loadingdone` subscription so the host's font set no longer
   * references this loader, and forgets every readiness answer that depended on
   * it. The loader stays usable: the next {@link ensureLoaded} subscribes again
   * and, since a font may have loaded unheard in between, runs the
   * `onFontsLoaded` hook once as if `loadingdone` had fired. Idempotent.
   */
  dispose(): void {
    if (this.unsubscribe) this.missedEvents = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.invalidate();
  }

  private subscribe(): void {
    if (this.unsubscribe || !hasFontSet()) return;
    const fonts = document.fonts as FontFaceSet & Partial<Pick<EventTarget, 'addEventListener'>>;
    if (!fonts.addEventListener) return;
    const handler = (): void => {
      this.invalidate();
      this.onFontsLoaded?.();
    };
    fonts.addEventListener('loadingdone', handler);
    this.unsubscribe = () => {
      (fonts as Partial<Pick<EventTarget, 'removeEventListener'>>).removeEventListener?.(
        'loadingdone',
        handler,
      );
    };
    if (this.missedEvents) {
      this.missedEvents = false;
      handler();
    }
  }

  private invalidate(): void {
    this.loaded.clear();
    this.inFlight.clear();
    this.generation++;
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
   * @param text - Text about to be measured with this spec; every distinct
   *   character in it must be renderable before this resolves. Defaults to a
   *   representative sample spanning every range mejiro measures.
   * @throws If the font fails to load. Resolves at once when the runtime has
   *   no `document.fonts`.
   */
  async ensureLoaded(fontSpec: string, text?: string): Promise<void> {
    // Without a font set there is nothing to wait on.
    if (!hasFontSet()) return;
    this.subscribe();
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
    if (!hasFontSet()) return false;
    return document.fonts.check(fontSpec, coverageSample(text));
  }
}

function hasFontSet(): boolean {
  return typeof document !== 'undefined' && !!document.fonts;
}

function loadedKey(fontSpec: string, sample: string): string {
  return `${fontSpec}\u0000${sample}`;
}
