import { MejiroError } from '../errors.js';
import type { AnalyzerIdentity, MorphemeLike, TextAnalysis, TextAnalyzer } from '../types.js';
import { alignMorphemeOffsets } from './align.js';

/** Name reported in {@link TextAnalysis.analyzer}, and part of every cache key. */
const ANALYZER_NAME = 'suzume';

/** Options for {@link createSuzumeAnalyzer}. */
export interface SuzumeAnalyzerOptions {
  /**
   * Pre-created Suzume instance to adopt instead of creating one. The caller
   * keeps ownership: disposing the analyzer does not destroy it.
   * @defaultValue a new instance, destroyed when the analyzer is disposed
   */
  instance?: SuzumeInstance;
  /**
   * Override for the WebAssembly binary location, forwarded to Suzume.create().
   * Ignored when `instance` is set.
   * @defaultValue the location `@libraz/suzume` resolves itself
   */
  wasmPath?: string;
}

/** A morpheme as suzume reports it; offsets are code points in the normalized text. */
export interface SuzumeMorpheme {
  /** Surface form, as normalized by suzume. */
  surface: string;
  /** Coarse part-of-speech code. */
  pos: string;
  /** Fine-grained part-of-speech code. */
  extendedPos: string;
  /** Inclusive start offset in code points of the normalized text. */
  start: number;
  /** Exclusive end offset in code points of the normalized text. */
  end: number;
}

/** What a suzume instance returns for one text: its normalized form and the morphemes of that form. */
export interface SuzumeAnalysis {
  /** The text suzume tokenized, after its own normalization. */
  normalizedText: string;
  /** Morphemes in document order, indexed against `normalizedText`. */
  morphemes: readonly SuzumeMorpheme[];
}

/**
 * The part of a suzume instance this analyzer drives.
 *
 * Declared structurally rather than imported: `@libraz/suzume` is an optional
 * peer dependency, so its types must not appear in this package's own type
 * surface either. An instance from `Suzume.create()` satisfies it.
 */
export interface SuzumeInstance {
  /** Version of suzume, reported in the analyzer's identity. */
  readonly version: string;
  /** Tokenizes `text` and returns the normalized text the offsets address. */
  analyzeWithNormalizedText(text: string): SuzumeAnalysis;
  /** Releases the instance's WebAssembly resources. */
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
 * Takes no `AbortSignal`: instantiating the WebAssembly module cannot be
 * interrupted once started.
 *
 * The returned analyzer is terminal once disposed: `dispose()` frees its
 * WebAssembly instance (unless adopted), and `analyze()` then throws
 * `analyzer-disposed`. Create a new analyzer to continue.
 *
 * @param options - Instance adoption and WebAssembly location overrides.
 * @returns An analyzer ready to use, which the caller disposes when done.
 * @throws TypeError if `options.instance` is set but lacks a string `version`
 *   or an `analyzeWithNormalizedText` or `destroy` method.
 * @throws MejiroError with code `analyzer-unavailable` when `@libraz/suzume` is
 *   not installed or its WebAssembly module fails to load; the underlying error
 *   is the `cause`.
 */
export async function createSuzumeAnalyzer(
  options: SuzumeAnalyzerOptions = {},
): Promise<TextAnalyzer> {
  const adopted = options.instance !== undefined;
  if (adopted) assertSuzumeInstance(options.instance);
  const instance = options.instance ?? (await createInstance(options.wasmPath));
  let disposed = false;
  // One object, handed out as both the analyzer's identity and the provenance
  // of every analysis, so the two cannot drift apart.
  const identity: AnalyzerIdentity = { name: ANALYZER_NAME, version: instance.version };

  return {
    identity,
    analyze(text: string): TextAnalysis {
      if (disposed) {
        throw new MejiroError(
          'analyzer-disposed',
          'This suzume analyzer has been disposed and can no longer analyse text.',
        );
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
            {
              code: 'alignment-failed',
              message:
                'Morpheme offsets could not be aligned to the input text; morphemes were dropped.',
            },
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

/** Throws a `TypeError` unless `instance` has the members this analyzer calls. */
function assertSuzumeInstance(instance: unknown): asserts instance is SuzumeInstance {
  const candidate = instance as Partial<Record<keyof SuzumeInstance, unknown>> | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.version !== 'string' ||
    typeof candidate.analyzeWithNormalizedText !== 'function' ||
    typeof candidate.destroy !== 'function'
  ) {
    throw new TypeError(
      'createSuzumeAnalyzer: instance must have a string version and analyzeWithNormalizedText() and destroy() methods; pass the result of Suzume.create()',
    );
  }
}

/**
 * Loads suzume and creates an instance configured to normalize as little as it
 * can, so the aligner has less to reconcile.
 */
async function createInstance(wasmPath: string | undefined): Promise<SuzumeInstance> {
  const { Suzume } = await loadSuzume();
  try {
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
  } catch (cause) {
    throw new MejiroError('analyzer-unavailable', 'The suzume WebAssembly module failed to load.', {
      cause,
    });
  }
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
    throw new MejiroError(
      'analyzer-unavailable',
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
    startIndex: morpheme.start,
    endIndex: morpheme.end,
    pos: morpheme.pos,
    extendedPos: morpheme.extendedPos,
  };
}
