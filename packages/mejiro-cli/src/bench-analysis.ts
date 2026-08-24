import { computeBreaks, deriveTypographyHints, toCodepoints } from '@libraz/mejiro';
import { createSuzumeAnalyzer, type TextAnalyzer } from '@libraz/mejiro/analysis';
import { parseFlag, parsePositiveNumber } from './args.js';
import { buildCorpusParagraphs } from './corpus.js';

/** Where the benchmark writes its report. */
interface BenchIO {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
}

/** Advance width of a full-width character, and therefore one em. */
const EM_SIZE = 16;
/** Advance width of a half-width character. */
const HALF_WIDTH_ADVANCE = 8;
/** Below this code point the corpus holds only half-width characters. */
const HALF_WIDTH_LIMIT = 0x2e80;
/** Line feed, which the layout engine takes as a hard break. */
const LINE_FEED = 0x0a;

/** Line widths in em the re-break comparison runs at. */
const WIDTH_SWEEP_EM: readonly number[] = [24, 32, 40, 48, 56];
/** Backtrack window sizes the cost search is swept over. */
const WINDOW_SWEEP: readonly number[] = [1, 2, 4, 6, 8, 12, 16, 24, 32];
/** The window the weight sweep runs at, which is the engine's default. */
const DEFAULT_MAX_BACKTRACK_CHARS = 8;
/** Penalty and shortfall weight pairs the search is swept over. */
const WEIGHT_SWEEP: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, 1.5],
  [1, 2],
  [1, 3],
  [1, 4],
  [0.5, 1],
  [2, 1],
];

/** The text and the measured advances every section of the benchmark shares. */
interface Corpus {
  /** Paragraphs, in document order, as the analyzer receives them. */
  paragraphs: readonly string[];
  /** The whole corpus as code points, paragraphs joined by a line feed. */
  codepoints: Uint32Array;
  /** Advance width of every code point, in pixels. */
  advances: Float32Array;
}

/** Hints covering the whole corpus, plus what producing them cost. */
interface PreparedHints {
  /** Indivisible units, spliced from the per-paragraph hints. */
  clusterIds: Uint32Array;
  /** Per-position break penalties, spliced from the per-paragraph hints. */
  breakPenalties: Uint8Array;
  /** Wall-clock time spent inside the analyzer, in ms. */
  analyzeMs: number;
  /** Wall-clock time spent deriving hints from the analyses, in ms. */
  deriveMs: number;
}

/** The layout arguments that vary between the benchmark's break calls. */
interface BreakVariant {
  /** Line width in pixels. */
  lineWidth: number;
  /** Cluster IDs, when the variant carries them. */
  clusterIds?: Uint32Array;
  /** Break penalties, when the variant carries them. */
  breakPenalties?: Uint8Array;
  /** Backtrack window override, when the variant sweeps it. */
  maxBacktrackChars?: number;
}

/** One line's worth of text, sliced out of the corpus with its hints. */
interface Slice {
  /** Code points from the line start onwards. */
  text: Uint32Array;
  /** Their advances. */
  advances: Float32Array;
  /** Their cluster IDs. */
  clusterIds: Uint32Array;
  /** Their break penalties. */
  breakPenalties: Uint8Array;
}

/**
 * Runs the analysis-driven line breaking benchmark and writes its report.
 *
 * The report answers four questions in order: what analysis costs, how that
 * compares to the line breaking it feeds, what the hints add to every later
 * re-break, and how far the layout they produce moves.
 *
 * @param args - Command arguments, after the command name.
 * @param io - Where the report is written.
 * @returns The process exit code.
 */
export async function runBenchAnalysis(args: string[], io: BenchIO): Promise<number> {
  const chars = parsePositiveNumber(parseFlag(args, '--chars'), 20000, '--chars');
  const iterations = parsePositiveNumber(parseFlag(args, '--iterations'), 20, '--iterations');
  const lineWidthEm = parsePositiveNumber(
    parseFlag(args, '--line-width-em'),
    40,
    '--line-width-em',
  );
  const lineWidth = lineWidthEm * EM_SIZE;

  const corpus = buildCorpus(chars);
  const analyzer = await createSuzumeAnalyzer();
  try {
    const hints = prepareHints(corpus, analyzer);

    io.stdout.write('mejiro analysis benchmark\n');
    writeSetup(io, corpus, analyzer, lineWidthEm, iterations);
    writeThroughput(io, corpus, hints, lineWidth, iterations);
    writeRebreakCost(io, corpus, hints, iterations);
    writeDivergence(io, corpus, hints, lineWidth);
    const lines = collectContestedLines(corpus, hints, lineWidth);
    writeWindowSweep(io, corpus, hints, lines, lineWidth, iterations);
    writeWeightSweep(io, corpus, hints, lines, lineWidth);
  } finally {
    analyzer.dispose();
  }
  return 0;
}

/** Builds the corpus and measures it, half-width characters at half an em. */
function buildCorpus(minChars: number): Corpus {
  const paragraphs = buildCorpusParagraphs(minChars).map((p) => p.normalize('NFC'));
  const codepoints = toCodepoints(paragraphs.join('\n'));
  const advances = new Float32Array(codepoints.length);
  for (let i = 0; i < codepoints.length; i++) {
    advances[i] = codepoints[i] < HALF_WIDTH_LIMIT ? HALF_WIDTH_ADVANCE : EM_SIZE;
  }
  return { paragraphs, codepoints, advances };
}

/**
 * Analyses every paragraph and splices the per-paragraph hints into arrays
 * covering the whole corpus, timing the two stages separately.
 *
 * Analysis runs per paragraph because morpheme offsets are relative to the
 * string the analyzer was given. The line feeds separating them belong to no
 * paragraph and keep their identity cluster and an unpenalised break position,
 * which costs nothing: the engine breaks at a line feed before it ever consults
 * either hint.
 */
function prepareHints(corpus: Corpus, analyzer: TextAnalyzer): PreparedHints {
  const length = corpus.codepoints.length;
  const clusterIds = new Uint32Array(length);
  for (let i = 0; i < length; i++) clusterIds[i] = i;
  const breakPenalties = new Uint8Array(length);

  let analyzeMs = 0;
  let deriveMs = 0;
  let offset = 0;

  for (const paragraph of corpus.paragraphs) {
    const analyzeStart = performance.now();
    const analysis = analyzer.analyze(paragraph);
    analyzeMs += performance.now() - analyzeStart;

    const deriveStart = performance.now();
    const hints = deriveTypographyHints(paragraph, analysis, { clusters: true, penalties: true });
    deriveMs += performance.now() - deriveStart;

    const paragraphLength = toCodepoints(paragraph).length;
    if (hints.clusterIds) {
      for (let i = 0; i < paragraphLength; i++) {
        clusterIds[offset + i] = offset + hints.clusterIds[i];
      }
    }
    if (hints.breakPenalties) {
      for (let i = 0; i < paragraphLength; i++) {
        breakPenalties[offset + i] = hints.breakPenalties[i];
      }
    }
    offset += paragraphLength + 1;
  }

  return { clusterIds, breakPenalties, analyzeMs, deriveMs };
}

/** Writes what the numbers below were measured on. */
function writeSetup(
  io: BenchIO,
  corpus: Corpus,
  analyzer: TextAnalyzer,
  lineWidthEm: number,
  iterations: number,
): void {
  io.stdout.write(
    `Corpus: ${corpus.codepoints.length} chars in ${corpus.paragraphs.length} paragraphs ` +
      '(narrative, numerals with counters, prefixed words, Latin runs, dialogue)\n',
  );
  io.stdout.write(
    `Analyzer: ${analyzer.identity.name} ${analyzer.identity.version}; ` +
      `${EM_SIZE}px em, ${HALF_WIDTH_ADVANCE}px half-width, line width ${lineWidthEm}em, ` +
      `${iterations} iterations per timing\n\n`,
  );
}

/** Writes analysis throughput, and what it costs next to one break pass. */
function writeThroughput(
  io: BenchIO,
  corpus: Corpus,
  hints: PreparedHints,
  lineWidth: number,
  iterations: number,
): void {
  const perThousand = (ms: number): string =>
    `${(ms / (corpus.codepoints.length / 1000)).toFixed(3)}ms per 1000 chars`;
  const prepareMs = hints.analyzeMs + hints.deriveMs;
  const breakPassMs = timeBreaks(corpus, iterations, { lineWidth });

  io.stdout.write('1. Analysis throughput, one pass over the corpus\n');
  io.stdout.write(
    `  ${pad('morphological analysis', 24)}${pad(`${hints.analyzeMs.toFixed(2)}ms`, 12)}` +
      `${perThousand(hints.analyzeMs)}\n`,
  );
  io.stdout.write(
    `  ${pad('hint derivation', 24)}${pad(`${hints.deriveMs.toFixed(2)}ms`, 12)}` +
      `${perThousand(hints.deriveMs)}\n`,
  );
  io.stdout.write(
    `  ${pad('total', 24)}${pad(`${prepareMs.toFixed(2)}ms`, 12)}${perThousand(prepareMs)}\n\n`,
  );

  io.stdout.write('2. Analysis versus layout\n');
  io.stdout.write(`  ${pad('unhinted break pass', 24)}${breakPassMs.toFixed(3)}ms\n`);
  io.stdout.write(
    `  ${pad('analysis costs', 24)}${(prepareMs / breakPassMs).toFixed(1)}x one break pass\n\n`,
  );
}

/** Writes the per-pass cost of re-breaking with and without hints. */
function writeRebreakCost(
  io: BenchIO,
  corpus: Corpus,
  hints: PreparedHints,
  iterations: number,
): void {
  io.stdout.write(
    '3. Re-break cost, ms per pass over the corpus ' +
      '(a negative delta is faster: the bounded cost search replaces an unbounded backward walk)\n',
  );
  io.stdout.write(
    `  ${pad('width', 8)}${pad('none', 10)}${pad('clusters', 10)}${pad('full', 10)}full vs none\n`,
  );

  for (const widthEm of WIDTH_SWEEP_EM) {
    const lineWidth = widthEm * EM_SIZE;
    const none = timeBreaks(corpus, iterations, { lineWidth });
    const clusters = timeBreaks(corpus, iterations, { lineWidth, clusterIds: hints.clusterIds });
    const full = timeBreaks(corpus, iterations, {
      lineWidth,
      clusterIds: hints.clusterIds,
      breakPenalties: hints.breakPenalties,
    });
    io.stdout.write(
      `  ${pad(`${widthEm}em`, 8)}${pad(none.toFixed(3), 10)}${pad(clusters.toFixed(3), 10)}` +
        `${pad(full.toFixed(3), 10)}${formatDelta(full / none - 1)}\n`,
    );
  }
  io.stdout.write('\n');
}

/** Writes how far each hint stage moves the break positions. */
function writeDivergence(
  io: BenchIO,
  corpus: Corpus,
  hints: PreparedHints,
  lineWidth: number,
): void {
  const base = breaksOf(corpus, { lineWidth });
  const clusters = breaksOf(corpus, { lineWidth, clusterIds: hints.clusterIds });
  const full = breaksOf(corpus, {
    lineWidth,
    clusterIds: hints.clusterIds,
    breakPenalties: hints.breakPenalties,
  });

  io.stdout.write('4. Break positions that differ from the unhinted layout\n');
  io.stdout.write(`  ${pad('unhinted', 10)}${base.length} breaks\n`);
  writeDivergenceRow(io, 'clusters', clusters, base);
  writeDivergenceRow(io, 'full', full, base);
  io.stdout.write('\n');
}

/** Writes one stage's divergence, counted as breaks the unhinted layout lacks. */
function writeDivergenceRow(
  io: BenchIO,
  label: string,
  breaks: Uint32Array,
  base: Uint32Array,
): void {
  const baseSet = new Set(base);
  let differing = 0;
  for (const bp of breaks) {
    if (!baseSet.has(bp)) differing++;
  }
  const share = breaks.length > 0 ? (differing / breaks.length) * 100 : 0;
  io.stdout.write(
    `  ${pad(label, 10)}${breaks.length} breaks, ${differing} differ (${share.toFixed(1)}%)\n`,
  );
}

/**
 * The set of lines the cost search is judged on, with the position the search
 * is being compared against.
 */
interface ContestedLines {
  /** Index each judged line starts at. */
  starts: number[];
  /** The nearest valid break position on each, relative to its line start. */
  nearest: number[];
  /** How many lines the layout had in total, judged or not. */
  totalLines: number;
  /** Code points to slice per line, enough to hold one line and the widest window. */
  sliceLength: number;
}

/** What one search setting did, measured over the contested lines. */
interface ChoiceStats {
  /** Share of lines whose break moved off the nearest valid position, in percent. */
  movedPercent: number;
  /** Mean penalty of the chosen positions. */
  penalty: number;
  /** Mean shortfall of the resulting lines, in em. */
  shortfall: number;
  /** Mean number of characters given up against the nearest position. */
  gaveUp: number;
  /** Share of lines left visibly loose, in percent. */
  loosePercent: number;
  /** The largest shortfall any one line was left with, in em. */
  maxShortfall: number;
}

/**
 * Shortfall in em past which a line reads as loose rather than as ordinary
 * kinsoku shori. Vertical Japanese is set on a character grid, so this is one
 * and a half empty cells at the end of a line.
 */
const LOOSE_LINE_EM = 1.5;

/**
 * Collects the lines the cost search has something to decide on.
 *
 * Line starts come from the clusters-only layout and stay fixed across every
 * setting measured below, and only the first break after each start is taken, so
 * a row describes that setting's own decisions rather than the cascade a
 * different decision on one line causes on the next.
 */
function collectContestedLines(
  corpus: Corpus,
  hints: PreparedHints,
  lineWidth: number,
): ContestedLines {
  const lineStarts = lineStartsOf(breaksOf(corpus, { lineWidth, clusterIds: hints.clusterIds }));
  // A line holds at most lineWidth / HALF_WIDTH_ADVANCE characters; the slack
  // covers the widest window plus the overflowing character itself.
  const sliceLength =
    Math.ceil(lineWidth / HALF_WIDTH_ADVANCE) + WINDOW_SWEEP[WINDOW_SWEEP.length - 1] + 4;

  const starts: number[] = [];
  const nearest: number[] = [];
  for (const start of lineStarts) {
    const pos = firstBreak(sliceAt(corpus, hints, start, sliceLength), lineWidth, null);
    // A line ending at a hard break, or one its slice never overflows, leaves
    // the cost search nothing to decide and would only dilute the rates below.
    if (pos < 0 || corpus.codepoints[start + pos] === LINE_FEED) continue;
    starts.push(start);
    nearest.push(pos);
  }
  return { starts, nearest, totalLines: lineStarts.length, sliceLength };
}

/**
 * Writes the backtrack window sweep.
 *
 * The `none` row is the same lines broken without penalties, which is the
 * nearest valid position and therefore the baseline every window is compared
 * against.
 */
function writeWindowSweep(
  io: BenchIO,
  corpus: Corpus,
  hints: PreparedHints,
  lines: ContestedLines,
  lineWidth: number,
  iterations: number,
): void {
  io.stdout.write(
    `5. Cost search per line, on the ${lines.starts.length} of ${lines.totalLines} lines ` +
      'that reach a contested break\n',
  );
  io.stdout.write(
    `  ${pad('window', 8)}${pad('moved', 9)}${pad('penalty', 10)}${pad('shortfall', 11)}` +
      `${pad('cost', 8)}${pad('gave up', 9)}ms/pass\n`,
  );
  writeWindowRow(io, 'none', measureChoices(corpus, hints, lines, lineWidth, lines.nearest), null);

  for (const window of WINDOW_SWEEP) {
    const chosen = chooseBreaks(corpus, hints, lines, lineWidth, { maxBacktrackChars: window });
    const ms = timeBreaks(corpus, iterations, {
      lineWidth,
      clusterIds: hints.clusterIds,
      breakPenalties: hints.breakPenalties,
      maxBacktrackChars: window,
    });
    writeWindowRow(io, String(window), measureChoices(corpus, hints, lines, lineWidth, chosen), ms);
  }
  io.stdout.write('\n');
}

/** Writes one window's row: how often it moved, and what the move bought. */
function writeWindowRow(io: BenchIO, label: string, stats: ChoiceStats, ms: number | null): void {
  io.stdout.write(
    `  ${pad(label, 8)}${pad(`${stats.movedPercent.toFixed(1)}%`, 9)}` +
      `${pad(stats.penalty.toFixed(3), 10)}${pad(stats.shortfall.toFixed(3), 11)}` +
      `${pad((stats.penalty + stats.shortfall).toFixed(3), 8)}${pad(stats.gaveUp.toFixed(2), 9)}` +
      `${ms === null ? '-' : ms.toFixed(3)}\n`,
  );
}

/**
 * Writes the weight sweep at the default window.
 *
 * The two right-hand columns are what decides whether a weight pair is too
 * permissive: they measure the lines the search left loose, in em, which is the
 * unit a reader sees them in.
 */
function writeWeightSweep(
  io: BenchIO,
  corpus: Corpus,
  hints: PreparedHints,
  lines: ContestedLines,
  lineWidth: number,
): void {
  io.stdout.write('6. Weights at the default window, same lines\n');
  io.stdout.write(
    `  ${pad('penaltyW', 10)}${pad('shortfallW', 12)}${pad('moved', 9)}${pad('penalty', 10)}` +
      `${pad('shortfall', 11)}${pad('gave up', 9)}${pad(`>=${LOOSE_LINE_EM}em`, 10)}max em\n`,
  );

  for (const [penaltyWeight, shortfallWeight] of WEIGHT_SWEEP) {
    const chosen = chooseBreaks(corpus, hints, lines, lineWidth, {
      maxBacktrackChars: DEFAULT_MAX_BACKTRACK_CHARS,
      penaltyWeight,
      shortfallWeight,
    });
    const stats = measureChoices(corpus, hints, lines, lineWidth, chosen);
    io.stdout.write(
      `  ${pad(penaltyWeight.toFixed(1), 10)}${pad(shortfallWeight.toFixed(1), 12)}` +
        `${pad(`${stats.movedPercent.toFixed(1)}%`, 9)}${pad(stats.penalty.toFixed(3), 10)}` +
        `${pad(stats.shortfall.toFixed(3), 11)}${pad(stats.gaveUp.toFixed(2), 9)}` +
        `${pad(`${stats.loosePercent.toFixed(1)}%`, 10)}${stats.maxShortfall.toFixed(2)}\n`,
    );
  }
  io.stdout.write('\n');
}

/** Runs the cost search on every contested line and returns the chosen positions. */
function chooseBreaks(
  corpus: Corpus,
  hints: PreparedHints,
  lines: ContestedLines,
  lineWidth: number,
  cost: CostSetting,
): number[] {
  return lines.starts.map((start, i) => {
    const pos = firstBreak(sliceAt(corpus, hints, start, lines.sliceLength), lineWidth, cost);
    // A window holding no valid position falls through to the unbounded search,
    // which lands on the nearest position — the same one the baseline picked.
    return pos < 0 ? lines.nearest[i] : pos;
  });
}

/** Summarises a set of chosen break positions against the nearest ones. */
function measureChoices(
  corpus: Corpus,
  hints: PreparedHints,
  lines: ContestedLines,
  lineWidth: number,
  chosen: readonly number[],
): ChoiceStats {
  let moved = 0;
  let penaltySum = 0;
  let shortfallSum = 0;
  let givenUpSum = 0;
  let loose = 0;
  let maxShortfall = 0;

  for (let i = 0; i < lines.starts.length; i++) {
    const start = lines.starts[i];
    const pos = chosen[i];
    const shortfall = (lineWidth - lineWidthOf(corpus, start, pos)) / EM_SIZE;
    if (pos !== lines.nearest[i]) moved++;
    if (shortfall >= LOOSE_LINE_EM) loose++;
    if (shortfall > maxShortfall) maxShortfall = shortfall;
    penaltySum += hints.breakPenalties[start + pos];
    shortfallSum += shortfall;
    givenUpSum += lines.nearest[i] - pos;
  }

  const count = Math.max(lines.starts.length, 1);
  return {
    movedPercent: (moved / count) * 100,
    penalty: penaltySum / count,
    shortfall: shortfallSum / count,
    gaveUp: givenUpSum / count,
    loosePercent: (loose / count) * 100,
    maxShortfall,
  };
}

/** Width in pixels of the line starting at `start` and ending `end` code points later. */
function lineWidthOf(corpus: Corpus, start: number, end: number): number {
  let width = 0;
  for (let i = start; i <= start + end; i++) width += corpus.advances[i];
  return width;
}

/** Cuts `sliceLength` code points out of the corpus, hints included. */
function sliceAt(corpus: Corpus, hints: PreparedHints, start: number, sliceLength: number): Slice {
  const end = Math.min(corpus.codepoints.length, start + sliceLength);
  return {
    text: corpus.codepoints.subarray(start, end),
    advances: corpus.advances.subarray(start, end),
    clusterIds: hints.clusterIds.subarray(start, end),
    breakPenalties: hints.breakPenalties.subarray(start, end),
  };
}

/** One setting of the cost search, as the per-line evaluation varies it. */
interface CostSetting {
  /** How far back the search may walk. */
  maxBacktrackChars: number;
  /** Multiplier on the penalty term. Left out to use the engine's default. */
  penaltyWeight?: number;
  /** Multiplier on the shortfall term. Left out to use the engine's default. */
  shortfallWeight?: number;
}

/**
 * Breaks one slice and returns its first break position relative to the slice,
 * or -1 when the slice fits on a single line.
 *
 * `emSize` is pinned rather than estimated: a Latin-heavy slice holds no
 * full-width character to estimate one em from, and a shortfall measured in half
 * an em would not be the shortfall the whole-corpus run computes.
 *
 * @param cost - The search setting, or `null` to break without penalties, which
 *   is what selects the nearest valid position.
 */
function firstBreak(slice: Slice, lineWidth: number, cost: CostSetting | null): number {
  const result = computeBreaks({
    text: slice.text,
    advances: slice.advances,
    lineWidth,
    clusterIds: slice.clusterIds,
    ...(cost === null
      ? {}
      : {
          breakPenalties: slice.breakPenalties,
          breakCost: { ...cost, emSize: EM_SIZE },
        }),
  });
  return result.breakPoints.length > 0 ? result.breakPoints[0] : -1;
}

/** Runs one break pass over the whole corpus and returns its break positions. */
function breaksOf(corpus: Corpus, variant: BreakVariant): Uint32Array {
  return computeBreaks({
    text: corpus.codepoints,
    advances: corpus.advances,
    lineWidth: variant.lineWidth,
    clusterIds: variant.clusterIds,
    breakPenalties: variant.breakPenalties,
    breakCost:
      variant.maxBacktrackChars === undefined
        ? undefined
        : { maxBacktrackChars: variant.maxBacktrackChars },
  }).breakPoints;
}

/**
 * Turns break positions into the index each line starts at.
 *
 * The line after the last break is left out: it ends with the text rather than
 * with a break decision, so there is nothing there to compare.
 */
function lineStartsOf(breaks: Uint32Array): number[] {
  const starts = [0];
  for (const bp of breaks) starts.push(bp + 1);
  starts.pop();
  return starts;
}

/** Mean duration of one break pass over the corpus, in ms, after a warm-up. */
function timeBreaks(corpus: Corpus, iterations: number, variant: BreakVariant): number {
  for (let i = 0; i < 3; i++) breaksOf(corpus, variant);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) breaksOf(corpus, variant);
  return (performance.now() - start) / iterations;
}

/** Pads a table cell to `width` columns. */
function pad(value: string, width: number): string {
  return value.padEnd(width);
}

/** Formats a ratio as a signed percentage. */
function formatDelta(ratio: number): string {
  const percent = ratio * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}
