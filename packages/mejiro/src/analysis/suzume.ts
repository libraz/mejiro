import type { AnalyzerIdentity, MorphemeLike, TextAnalysis, TextAnalyzer } from '../types.js';
import { alignMorphemeOffsets } from './align.js';

/** Name reported in {@link TextAnalysis.analyzer}, and part of every cache key. */
const ANALYZER_NAME = 'suzume';

/** Options for {@link createSuzumeAnalyzer}. */
export interface SuzumeAnalyzerOptions {
  /** Pre-created Suzume instance to adopt instead of creating one. */
  instance?: unknown;
  /** Override for the WebAssembly binary location, forwarded to Suzume.create(). */
  wasmPath?: string;
}

/** The part of a suzume morpheme this analyzer reads. */
interface SuzumeMorpheme {
  surface: string;
  pos: string;
  extendedPos: string;
  start: number;
  end: number;
}

/**
 * The part of a suzume instance this analyzer drives.
 *
 * Declared structurally rather than imported: `@libraz/suzume` is an optional
 * peer dependency, so its types must not appear in this package's own type
 * surface either.
 */
interface SuzumeInstance {
  readonly version: string;
  analyzeWithNormalizedText(text: string): {
    normalizedText: string;
    morphemes: readonly SuzumeMorpheme[];
  };
  destroy(): void;
}

/**
 * Creates a {@link TextAnalyzer} backed by the suzume WebAssembly tokenizer.
 *
 * The WebAssembly module and its dictionaries load here, once, because
 * {@link TextAnalyzer.analyze} is synchronous: line breaking runs synchronously,
 * so every asynchronous step has to happen before the analyzer exists.
 *
 * Failure to load `@libraz/suzume` throws. Calling this factory is an explicit
 * request for that analyzer, so a caller that would rather fall back to
 * character-class-only line breaking catches the rejection and does so itself.
 *
 * @param options - Instance adoption and WebAssembly location overrides.
 * @returns An analyzer ready to use, which the caller disposes when done.
 * @throws When `@libraz/suzume` is not installed or its module fails to load.
 */
export async function createSuzumeAnalyzer(
  options: SuzumeAnalyzerOptions = {},
): Promise<TextAnalyzer> {
  const adopted = options.instance !== undefined;
  const instance = adopted
    ? (options.instance as SuzumeInstance)
    : await createInstance(options.wasmPath);
  let disposed = false;
  // One object, handed out as both the analyzer's identity and the provenance
  // of every analysis, so the two cannot drift apart.
  const identity: AnalyzerIdentity = { name: ANALYZER_NAME, version: instance.version };

  return {
    identity,
    analyze(text: string): TextAnalysis {
      if (disposed) {
        throw new Error('This suzume analyzer has been disposed and can no longer analyse text.');
      }
      const result = instance.analyzeWithNormalizedText(text);
      const raw = result.morphemes.map(toMorphemeLike);
      const aligned = alignMorphemeOffsets(text, result.normalizedText, raw);
      if (aligned === null) {
        // Offsets that cannot be moved onto the caller's text are worse than no
        // offsets at all, so the analysis comes back empty and the caller falls
        // back to character-class-only line breaking for this text.
        return {
          text,
          morphemes: [],
          analyzer: identity,
          warnings: [
            'Morpheme offsets could not be aligned to the input text; morphemes were dropped.',
          ],
        };
      }
      return { text, morphemes: aligned.morphemes, analyzer: identity, warnings: aligned.warnings };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // An adopted instance belongs to whoever created it, including its
      // lifetime; disposing this analyzer only closes this analyzer.
      if (!adopted) instance.destroy();
    },
  };
}

/**
 * Loads suzume and creates an instance configured to normalize as little as it
 * can, so the aligner has less to reconcile.
 */
async function createInstance(wasmPath: string | undefined): Promise<SuzumeInstance> {
  const { Suzume } = await loadSuzume();
  return await Suzume.create({
    // Keeping ヴ, ASCII case and symbols leaves suzume's normalized text as
    // close to the input as suzume can make it, which keeps the offset
    // alignment on its identity fast path for ordinary prose.
    preserveVu: true,
    preserveCase: true,
    preserveSymbols: true,
    mode: 'normal',
    ...(wasmPath === undefined ? {} : { wasmPath }),
  });
}

/**
 * Imports `@libraz/suzume` dynamically.
 *
 * The import stays dynamic on purpose. The package is an optional peer
 * dependency, and a static import would make every bundler try to resolve it
 * for users who never installed it, breaking builds that do not use this
 * analyzer at all.
 */
async function loadSuzume(): Promise<typeof import('@libraz/suzume')> {
  try {
    return await import('@libraz/suzume');
  } catch (cause) {
    throw new Error(
      "The suzume analyzer requires the optional peer dependency '@libraz/suzume'. " +
        'Install it to use createSuzumeAnalyzer().',
      { cause },
    );
  }
}

/** Narrows a suzume morpheme to the fields the layout engine consumes. */
function toMorphemeLike(morpheme: SuzumeMorpheme): MorphemeLike {
  return {
    surface: morpheme.surface,
    start: morpheme.start,
    end: morpheme.end,
    pos: morpheme.pos,
    extendedPos: morpheme.extendedPos,
  };
}
