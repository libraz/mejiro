# API Reference

> **Note:** This document covers every export of the `@libraz/mejiro` subpaths, plus the components, hooks and composables of the framework packages. Individual component props are summarized rather than listed exhaustively — see [React & Vue](./08-react-and-vue.md) for the prop tables and the bundled TypeScript definitions for exact parameter types and defaults.

---

## `@libraz/mejiro` — Core

### Line Breaking

| Export | Signature |
|---|---|
| `computeBreaks` | `(input: LayoutInput) => BreakResult` |

Computes line break positions. Greedy O(n) algorithm with kinsoku backtracking and optional hanging punctuation. Throws `RangeError` when `advances`, `clusterIds` or `breakPenalties` do not have one entry per code point, when `lineWidth` or a `lineWidths` entry is not a positive finite number, when an advance is negative or not finite, when a `breakCost` field is out of range, when `kinsoku` names an unknown mode, and when `preprocessRuby` rejects a ruby annotation; `TypeError` when `kinsoku` is neither a mode string nor custom rules.

| Export | Signature |
|---|---|
| `canBreakAt` | `(text: Uint32Array, pos: number, options?: CanBreakAtOptions) => boolean` |

Tests whether a line break is allowed after the given position. `options` carries `kinsoku` and `clusterIds`.

| Export | Signature |
|---|---|
| `toCodepoints` | `(str: string) => Uint32Array` |

Converts a string to a `Uint32Array` of Unicode codepoints for use with `computeBreaks()`.

### Kinsoku (Line Break Prohibition)

| Export | Signature |
|---|---|
| `isLineStartProhibited` | `(cp: number, options?: KinsokuCheckOptions) => boolean` |

Tests if a codepoint is prohibited at the start of a line under `options.kinsoku`: a built-in mode (default `'strict'`) or custom rules.

| Export | Signature |
|---|---|
| `isLineEndProhibited` | `(cp: number, options?: KinsokuCheckOptions) => boolean` |

Tests if a codepoint is prohibited at the end of a line.

| Export | Signature |
|---|---|
| `getDefaultKinsokuRules` | `() => KinsokuRules` |

Returns a copy of the default strict kinsoku rule set. Pass it to `extendKinsokuRules` to add to the defaults.

| Export | Signature |
|---|---|
| `buildKinsokuRules` | `(source: KinsokuRuleSource) => KinsokuRules` |
| `extendKinsokuRules` | `(base: KinsokuRules, additions: Partial<KinsokuRuleSource>) => KinsokuRules` |
| `isUnbreakablePair` | `(left: number, right: number, options?: KinsokuCheckOptions) => boolean` |

`buildKinsokuRules` creates a `KinsokuRules` object from raw codepoint lists; the lists are copied and frozen. `extendKinsokuRules` returns rules prohibiting everything `base` does plus `additions`, leaving `base` unchanged. `isUnbreakablePair` tests whether a break between two adjacent codepoints is forbidden by the pair rules (`‥‥`, `……`, `——`, `――` by default).

### Hanging Punctuation

| Export | Signature |
|---|---|
| `isHangingTarget` | `(cp: number) => boolean` |

Tests if a codepoint is eligible for hanging (U+3002, U+3001, U+FF0C, U+FF0E, U+FF61, U+FF64).

| Export | Signature |
|---|---|
| `computeHangingAdjustment` | `(cp: number, advance: number) => number` |

Computes the hanging protrusion amount. Returns the advance if the character is a hanging target, 0 otherwise.

### Ruby (Furigana) Preprocessing

| Export | Signature |
|---|---|
| `preprocessRuby` | `(text: Uint32Array, advances: Float32Array, annotations: readonly RubyAnnotation[], existingClusterIds?: Uint32Array) => RubyPreprocessResult` |

Distributes ruby text widths across base characters and generates cluster IDs. An annotated span reserves the larger of its base width and its ruby width; ruby is never charged to a neighbouring character's advance. Throws `RangeError` on input it cannot honour: `advances` of the wrong length, a negative or non-finite advance, an empty, non-integral or out-of-range span, annotations that overlap other than as a jukugo aggregate, `rubyAdvances` whose length differs from `rubyText`, or a `mono` annotation over more than one character. Tate-chu-yoko skips a malformed span instead, as described below.

| Export | Signature |
|---|---|
| `isKana` | `(cp: number) => boolean` |

Tests if a codepoint is hiragana (U+3040--U+309F) or katakana (U+30A0--U+30FF).

### Tate-chu-yoko Preprocessing

| Export | Signature |
|---|---|
| `buildTcyAnnotations` | `(source: readonly InlineAnnotation[] \| readonly TcyCandidate[] \| undefined, emSize: number) => TcyAnnotation[] \| undefined` |
| `preprocessTcy` | `(text: Uint32Array, advances: Float32Array, annotations: readonly TcyAnnotation[], existingClusterIds?: Uint32Array) => TcyPreprocessResult` |

`buildTcyAnnotations` picks the `tcy` entries out of a mixed inline-annotation list (or takes `TcyCandidate` spans from `deriveTypographyHints()` as they are) and charges each one a single em, which is what `text-combine-upright: all` renders. `preprocessTcy` then collapses each span to that width and gives it a cluster ID of its own, so the line breaker cannot split it across a column boundary. The em is distributed over the span's characters in proportion to their measured advances, keeping anchor rectangles and hit tests monotonic inside the span.

Tate-chu-yoko is preprocessed *before* ruby, so a ruby span covering a combined box distributes its excess over the collapsed width rather than over the measured widths the box has already replaced. Unlike ruby, a malformed span is skipped rather than rejected — empty, reversed, out of range, non-integral, carrying a non-finite advance, or overlapping a span already applied (earlier start wins, then the longer one). These spans come from arbitrary EPUB markup, and one broken span must not stop a chapter from being laid out.

### Cluster Support

| Export | Signature |
|---|---|
| `resolveClusterNoBreakFlags` | `(text: Uint32Array, clusterIds?: Uint32Array) => Uint8Array` |

Returns one byte per position, `1` where a break after that position is not allowed.

| Export | Signature |
|---|---|
| `isClusterBreakAllowed` | `(clusterIds: Uint32Array \| undefined, pos: number) => boolean` |

Tests if a break after `pos` keeps every cluster whole. The text ends at `clusterIds.length`.

### Pagination

| Export | Signature |
|---|---|
| `paginate` | `(pageBlockSize: number, paragraphs: readonly ParagraphMeasure[]) => PageSlice[][]` |

Distributes paragraph lines across fixed-size pages, splitting at page boundaries. Always returns at least one page, even for empty input.

| Export | Signature |
|---|---|
| `getLineRanges` | `(breakPoints: Uint32Array, charCount: number) => [number, number][]` |

Converts break points into `[start, end)` character index pairs per line.

### Token Boundaries

| Export | Signature |
|---|---|
| `tokenLengthsToBoundaries` | `(tokenLengths: readonly number[]) => Uint32Array` |

Converts morphological analyzer token lengths to boundary indices for `LayoutInput.tokenBoundaries`.

### Typography Hints

| Export | Signature |
|---|---|
| `deriveTypographyHints` | `(analysis: TextAnalysis, options?: TypographyHintOptions) => TypographyHints` |

Turns one paragraph's morphological analysis into line breaking hints. `clusterIds` is emitted by default and everything else is opt-in, so the default output only removes break opportunities that splitting an indivisible unit would have used. A cluster rule fires only when the character class of a morpheme's surface confirms it, which keeps the units it makes indivisible stable across dictionary versions and across analyzers; the penalty rules are free to consult the part of speech, because a penalty the dictionary never earns leaves the position at the value it would have had anyway. The hints address `analysis.text`. Fields whose rules never fired are omitted, so a caller keeps its "no hints, no preprocessing" fast path. See [Line breaking](./03-line-breaking.md) for the rules and the two opt-in stages.

| Export | Value |
|---|---|
| `DEFAULT_KEEP_WHOLE_POS` | `['ADV', 'CONJ', 'DET', 'INTJ', 'PRON']` |

The parts of speech `deriveTypographyHints()` keeps whole by default, as `TypographyHintOptions.keepWholePos`: the closed-class independent words — adverbs, conjunctions, adnominals, interjections and pronouns. Spread it to extend the default rather than replace it.

| Export | Signature |
|---|---|
| `mergeClusterIds` | `(length: number, a?: Uint32Array, b?: Uint32Array) => Uint32Array \| undefined` |

Combines two cluster ID arrays over the same text into their transitive closure, which is what lets typography hints ride alongside ruby or tate-chu-yoko clustering without either side knowing about the other. Returns a fresh array, never one of the inputs. An input whose length does not match `length` describes different text and is ignored rather than rejected: dropping a hint costs a suboptimal break, throwing costs the whole paragraph.

### Text Helpers

| Export | Signature |
|---|---|
| `formatDialogueLineBreaks` | `(text: string) => string` |
| `parseManuscript` | `(text: string, options?: ParseManuscriptOptions) => ParsedManuscript` |
| `tokenizeManuscriptSource` | `(text: string, dialect?: ManuscriptDialect) => ManuscriptToken[]` |

`formatDialogueLineBreaks` normalizes manuscript line breaks around Japanese dialogue quotes without creating extra blank lines. Existing line feeds and indentation are preserved; whitespace is trimmed only beside the breaks it inserts. It never inserts a break that would violate kinsoku: no break leaves a line-start-prohibited character (`、`, `）`, …) at the start of a line or a line-end-prohibited one (`（`, …) at the end of one.

`parseManuscript` turns manuscript notation (ruby, emphasis, TCY, em, strong, link, footnote) into plain text plus `inlineAnnotations` positioned in that text. `ParseManuscriptOptions.dialect` (`ManuscriptDialect`: `'mejiro'` (default), `'narou'` or `'kakuyomu'`) picks the notation; `ParsedManuscript` is `{ text, inlineAnnotations }`.

`tokenizeManuscriptSource` reports notation token ranges (ruby, emphasis, TCY, em, strong, link, footnote) in **source positions**, unlike `parseManuscript` whose annotation positions are in the rendered plain text. Powers the bundled `MejiroNotationHighlighter`.

### Image Exclusion

**`ExclusionEngine`** — Manages image exclusion zones for text layout:

- `constructor(geometry: ExclusionPageGeometry)`
- `setGeometry(geometry: ExclusionPageGeometry): void` — Update page geometry
- `getGeometry(): Readonly<ExclusionPageGeometry>` — Get current geometry
- `addImage(rect: ImageRect): void` — Add an image. The engine keeps the object it is given
- `removeImage(rect: ImageRect): boolean` — Remove by reference: pass the object that was added
- `clearImages(): void` — Remove all images
- `getImages(): readonly ImageRect[]` — Get current images
- `imageCount: number` — Number of images (getter)
- `compute(): ExclusionResult` — Compute per-column slots and line widths. Throws `RangeError` when the geometry or an image rectangle holds a non-finite or out-of-range value (for example a `linePitch` of 0)

**`SpreadExclusionEngine`** — Manages image exclusion across a two-page spread:

- `constructor(geometry: SpreadGeometry)`
- `setGeometry(geometry: SpreadGeometry): void` — Update spread geometry
- `getGeometry(): Readonly<SpreadGeometry>` — Get current geometry
- `addImage(rect: SpreadImageRect): void` — Add an image (position relative to the right page's top-left; negative `x` = left page)
- `removeImage(rect: SpreadImageRect): boolean` — Remove by reference
- `clearImages(): void` — Remove all images
- `getImages(): readonly SpreadImageRect[]` — Get current images
- `imageCount: number` — Number of images (getter)
- `compute(): SpreadExclusionResult` — Compute slots and lineWidths for both pages

Handles gutter (page padding) coordinate conversion automatically. Text flows continuously from right page to left page.

| Export | Signature |
|---|---|
| `computeExclusionSlots` | `(options: ComputeExclusionSlotsInput) => ExclusionResult` |

Convenience function. Equivalent to creating an `ExclusionEngine`, adding all images, and calling `compute()`. `ComputeExclusionSlotsInput` is `ExclusionPageGeometry` plus `images: readonly ImageRect[]`.

| Export | Signature |
|---|---|
| `computeLineWidths` | `(baseLineWidth: number, lineCount: number, exclusions: readonly ExclusionZone[]) => Float32Array` |

Low-level API. Computes per-line widths by subtracting exclusion zones from the base width; every width is finite and at least 1px. Throws `RangeError` when `baseLineWidth` is not finite or is below 1px, when a zone's `blockStart` or `blockEnd` is `NaN`, or when a zone's `inlineSize` is not finite or is negative.

### Overlay Helpers

| Export | Signature |
|---|---|
| `moveImageOverlayRect` | `(rect: ImageOverlayRect, deltaX: number, deltaY: number) => ImageOverlayRect` |
| `resizeImageOverlayRect` | `(rect: ImageOverlayRect, deltaX: number, deltaY: number, minSize?: number) => ImageOverlayRect` |

Pure helpers used by image overlay UIs to move and resize overlay rectangles without mutating the input.

Only the rectangle arithmetic lives here: it is DOM-free, so it belongs in core. The gesture that drives it — `createOverlayDragSession` — touches `document`, `requestAnimationFrame` and `setPointerCapture`, so it ships from `@libraz/mejiro/browser` instead.

### Persistence

| Export | Signature |
|---|---|
| `serializeReadingPosition` | `(value: ReadingAnchor) => string` |
| `parseReadingPosition` | `(raw: string \| null) => ReadingAnchor \| null` |
| `serializeAnnotations` | `(annotations: readonly Annotation[]) => string` |
| `parseAnnotations` | `(raw: string \| null) => Annotation[] \| null` |
| `toSortedAnnotations` | `(annotations: readonly Annotation[]) => Annotation[]` |
| `createAnnotationId` | `() => string` |

Versioned payload helpers shared by the framework persistence hooks. The serializers write version 3: `{ version: 3, chapterIndex, paragraphIndex, charIndex }` for a reading position and `{ version: 3, annotations: [...] }` for annotations. The parsers also read the earlier formats — an unversioned or version 2 reading position, version 1 annotations — and return them in the current shape. `parseReadingPosition` returns `null` for no data, for an unknown version and unless `chapterIndex` / `paragraphIndex` / `charIndex` are non-negative safe integers. `parseAnnotations` returns `[]` for no data and `null` for data it cannot read, so a caller can tell an empty list from a corrupt one; well-formed payloads drop only the entries that are malformed. `toSortedAnnotations` returns a sorted copy (by chapter, then start anchor) and leaves the input as it is.

When forwarding state to a server through the `onPositionChange` callback of `useReadingPosition` or the `onAnnotationsChange` callback of `useAnnotations`, send the string produced by `serializeReadingPosition` / `serializeAnnotations` so the matching parser accepts it on the next visit.

### Internationalization

| Export | Signature |
|---|---|
| `enMessages` / `jaMessages` | `MejiroMessages` |
| `messageCatalogs` | `Record<MejiroLocale, MejiroMessages>` |
| `resolveMessages` | `(locale: MejiroLocale \| undefined, overrides: Partial<MejiroMessages> \| undefined, fallback?: MejiroMessages) => MejiroMessages` |
| `formatMessage` | `(template: string, vars: Record<string, string \| number>) => string` |

UI string catalogs for the bundled components. The catalogs are frozen. `resolveMessages` merges partial overrides on top of a built-in catalog and returns a frozen result; `formatMessage` substitutes `{name}` placeholders. The reader / editor components take the same values through their `locale` and `messages` props, so a host rarely calls these directly. An override key whose value is `undefined` keeps the catalog string. `@libraz/mejiro-react` and `@libraz/mejiro-vue` re-export both functions under the same names.

### Text and URL Helpers

| Export | Signature |
|---|---|
| `normalizeText` | `(str: string) => string` |
| `sanitizeUrl` | `(raw: string) => string \| null` |

`normalizeText` applies the NFC normalization the layout pipeline expects. `sanitizeUrl`
returns `null` for URLs that must not become an `href`; the render layer uses it to drop the
anchor of an unsafe link while keeping its content, nested ruby and emphasis included.

### Types

**`LayoutInput`** -- Input for `computeBreaks()`:

- `text: Uint32Array` -- Unicode codepoints
- `advances: Float32Array` -- Per-character advance widths (px)
- `lineWidth: number` -- Available line width (px)
- `lineWidths?: Float32Array` -- Per-line widths overriding `lineWidth`
- `kinsoku?: KinsokuMode | KinsokuRules` -- `'strict'` (default), `'loose'`, or custom rules from `buildKinsokuRules()` / `extendKinsokuRules()`, which replace the built-in ones entirely
- `enableHanging?: boolean` -- Enable hanging punctuation (default: `true`)
- `clusterIds?: Uint32Array` -- Indivisible character groups
- `rubyAnnotations?: readonly RubyAnnotation[]` -- Core-level ruby annotations used by the line breaker
- `tcyAnnotations?: readonly TcyAnnotation[]` -- Tate-chu-yoko spans, each collapsed to one indivisible box of its own width before breaking
- `tokenBoundaries?: Uint32Array | readonly number[]` -- Preferred break positions
- `breakPenalties?: Uint8Array` -- Cost of breaking *after* each index, one entry per code point. `0` is unpenalised, larger values are avoided more strongly. When present, the backward search picks the lowest-cost position within `breakCost.maxBacktrackChars` instead of the nearest valid one, and supersedes both `tokenBoundaries` and the word preference
- `breakCost?: BreakCostOptions` -- Weights for the penalty search. Ignored unless `breakPenalties` is given

**`BreakResult`** -- Output of `computeBreaks()`:

- `breakPoints: Uint32Array` -- Index of last character before each break
- `hangingAdjustments: Float32Array` -- Hanging overhang per line (px), one entry per line; all zeros when `enableHanging` is false
- `effectiveAdvances?: Float32Array` -- Per-char advances after tate-chu-yoko collapsing and ruby width distribution, the widths the breaks were computed from. Present when `tcyAnnotations` or `rubyAnnotations` is non-empty
- `lineWidths?: Float32Array` -- Actual width used per line (present when `lineWidths` input was provided)

**`BreakCostOptions`** -- Weights trading a penalised break position against the line it leaves behind. The cost of breaking after position `p` is `penaltyWeight * breakPenalties[p] + shortfallWeight * shortfall(p)`, where `shortfall(p)` is how far short of the line width the line ends, measured in em. Only the ratio of the two weights affects which position wins, so `{ penaltyWeight: 0.5, shortfallWeight: 1 }` and `{ penaltyWeight: 1, shortfallWeight: 2 }` break identically:

- `penaltyWeight?: number` -- Multiplier on the penalty value (default: `1`)
- `shortfallWeight?: number` -- Multiplier on the em-measured shortfall (default: `1.5`). This caps the worst trade the search can make: escaping a position carrying penalty `P` buys at most `P / shortfallWeight` em of empty line, and `deriveTypographyHints()` emits at most `TypographyHintOptions.keepWholePenalty`, 4 by default, so the default weight caps that trade at 2.67 em
- `maxBacktrackChars?: number` -- How many positions the cost search may walk back from the overflowing character; bounding it keeps line breaking linear (default: `6`). A position `k` steps further back gives up at least `0.5k` em, so it can win only while `k < 2 * penaltyWeight * P / shortfallWeight` for the largest penalty `P` in the array — `k < 5.33` at the default weights and the penalties `deriveTypographyHints()` emits, which is why six covers the search completely and a wider window costs search time without changing the outcome
- `emSize?: number` -- Pixel size of one em (default: the largest measured advance in the paragraph, which is one em for any text containing a full-width character)

**`KinsokuMode`** -- `'strict' | 'loose'`

**`KinsokuRules`** -- Custom prohibition rules, built by `buildKinsokuRules()` and read-only once built:

- `lineStartProhibited: readonly number[]` / `lineEndProhibited: readonly number[]`
- `unbreakablePairs: readonly (readonly [number, number])[]`

**`KinsokuRuleSource`** -- Input for `buildKinsokuRules()`: `lineStartProhibited: readonly number[]` / `lineEndProhibited: readonly number[]` / `unbreakablePairs?: readonly (readonly [number, number])[]`.

**`KinsokuCheckOptions`** -- Options of the kinsoku predicates: `kinsoku?: KinsokuMode | KinsokuRules` (default `'strict'`).

**`CanBreakAtOptions`** -- `KinsokuCheckOptions` plus `clusterIds?: Uint32Array`, for `canBreakAt()`.

**`RubyAnnotation`** -- Core-level ruby annotation:

- `startIndex: number` / `endIndex: number` -- Range in base text
- `rubyText: Uint32Array` / `rubyAdvances: Float32Array`
- `rubyType?: RubyType`
- `jukugoSplitPoints?: readonly number[]`

**`RubyType`** -- `'mono' | 'group' | 'jukugo'`. Distribution policy for a ruby span.

**`RubyPreprocessResult`** -- Output of `preprocessRuby()`: `effectiveAdvances: Float32Array` / `clusterIds: Uint32Array`.

**`TcyAnnotation`** -- Core-level tate-chu-yoko annotation:

- `startIndex: number` / `endIndex: number` -- Range in base text
- `advance: number` -- Inline extent of the combined box (px); one em of the font the span is drawn with

**`TcyPreprocessResult`** -- Output of `preprocessTcy()`: `effectiveAdvances: Float32Array` / `clusterIds: Uint32Array`.

**`TypographyHints`** -- Output of `deriveTypographyHints()`. The fields are independent, so a caller can take the indivisible units and leave the penalties off:

- `clusterIds?: Uint32Array` -- Indivisible units, to be merged into `LayoutInput.clusterIds`
- `breakPenalties?: Uint8Array` -- Per-position break penalties for `LayoutInput.breakPenalties`
- `tokenBoundaries?: Uint32Array` -- Morpheme end positions, for `LayoutInput.tokenBoundaries`. Emitted only on request: passing token boundaries alone makes the engine break at word edges, which is not how Japanese body text is set
- `tcyCandidates?: readonly TcyCandidate[]` -- Automatic tate-chu-yoko candidates (free-standing two-digit numbers). Whether to set them is the caller's call

**`TypographyHintOptions`** -- Which hints `deriveTypographyHints()` emits, and how far its rules reach:

- `clusters?: boolean` -- Emit `clusterIds` (default: `true`)
- `penalties?: boolean` -- Emit `breakPenalties` (default: `false`)
- `tokenBoundaries?: boolean` -- Emit `tokenBoundaries` (default: `false`)
- `tcy?: boolean` -- Emit `tcyCandidates` (default: `false`)
- `maxHardClusterChars?: number` -- Longest run a single hard cluster may cover; a longer unit is left breakable, because a cluster that cannot fit a line is split by the forced-break rule, which disregards kinsoku (default: `6`)
- `keepWholePos?: readonly string[]` -- Parts of speech whose morphemes a break should avoid landing inside (default: `DEFAULT_KEEP_WHOLE_POS`). A code matches a morpheme when it equals either its `extendedPos` or its `pos`, so `'VERB'` selects every verb while `'VERB_連用'` selects one conjugation. Pass `[]` to switch the rule off, or spread `DEFAULT_KEEP_WHOLE_POS` to extend it. Unlike the cluster rules this one does consult the part of speech, which is safe because a word the dictionary does not know keeps the penalty it would have had anyway: a gap costs an improvement, never a different layout
- `keepWholePenalty?: number` -- Penalty given to a break strictly inside one of those morphemes, in place of the ordinary inside-a-morpheme penalty of 2 (default: `4`). A preference, not a prohibition: the cost search gives up at most `keepWholePenalty / shortfallWeight` em of line to escape the morpheme. In full-width text the scale moves in effective steps of two, since one point buys 0.67 em at the default weight and a full-width character is a whole em, so 4 is the first value that behaves differently from the 2 it replaces. Raising it much further needs `BreakCostOptions.maxBacktrackChars` widened to match, or the search cannot reach the position that would win. There is deliberately no length cap of the kind `maxHardClusterChars` puts on clusters, because an escape the search cannot afford is simply not taken

**`TcyCandidate`** -- A run a renderer may set as tate-chu-yoko: `startIndex: number` (inclusive) / `endIndex: number` (exclusive).

**`MorphemeLike`** -- A morpheme as the layout engine consumes it, independent of which analyzer produced it. Offsets are code point indices into the same NFC text the layout engine is given:

- `surface: string` -- Surface form. Used to verify character classes, not to re-locate the span
- `startIndex: number` / `endIndex: number` -- Inclusive start and exclusive end, in code points
- `pos: string` -- Coarse part-of-speech code
- `extendedPos: string` -- Fine-grained part-of-speech code, the main input to the hint rules

**`AnalyzerIdentity`** -- `{ name: string; version: string }`. Identifies one analyzer for cache keys and snapshot validation; two identities equal field by field stand for analyzers whose findings are interchangeable.

**`TextAnalysis`** -- One paragraph's analysis, already aligned to the text: `text: string` (the exact NFC text the offsets address) / `morphemes: readonly MorphemeLike[]` (document order, non-overlapping) / `analyzer: AnalyzerIdentity` / `warnings: readonly MejiroWarning[]` (empty when clean; `alignment-failed` or `morphemes-dropped` when the analyzer output did not line up with the text).

**`TextAnalyzer`** -- Produces a `TextAnalysis` for a paragraph:

- `identity: AnalyzerIdentity` -- Who this analyzer is; equal to the `analyzer` of every analysis it returns, so hints of unknown provenance can be attributed without analysing anything
- `analyze(text: string): TextAnalysis` -- Analyses one paragraph of NFC text
- `dispose(): void` -- Releases any native resources held by the analyzer. Terminal: an analyzer cannot be used after it is disposed

Implementations are synchronous by design: line breaking runs synchronously, so asynchronous setup belongs in the factory that returns the analyzer. The `@libraz/mejiro/analysis` chapter below has the bundled implementation.

**`ParagraphMeasure`** -- Pagination input:

- `lineCount: number` / `linePitch: number` / `gapBefore: number`

**`PageSlice`** -- Pagination output:

- `paragraphIndex: number` / `lineStart: number` / `lineEnd: number`

**`ExclusionPageGeometry`** — Page geometry for exclusion computation:

- `lineWidth: number` — Base line width (px)
- `lineCount: number` — Number of columns
- `linePitch: number` — Column pitch (fontSize × lineHeight) (px)
- `contentWidth: number` — Content width in block direction (px)
- `minGapHeight?: number` — Smallest gap usable for text (px). Defaults to `linePitch`

**`ImageRect`** — Image rectangle in content-area coordinates:

- `x: number` / `y: number` — Position from content area origin (px)
- `width: number` / `height: number` — Size (px)
- `inlineMargin?: number` — Margin in the inline direction (top/bottom in vertical-rl), applied to both sides (px). Defaults to `0`
- `blockMargin?: number` — Margin in the block direction (left/right in vertical-rl), applied to both sides (px). Defaults to `0`

**`SpreadImageRect`** — Image rectangle for `SpreadExclusionEngine`, positioned from the right page's top-left corner with the page padding included (unlike `ImageRect`, whose origin is the content area). A negative `x` places the image on the left page:

- `x: number` / `y: number` — Position from the right page's top-left corner (px)
- `width: number` / `height: number` — Size (px)
- `inlineMargin?: number` / `blockMargin?: number` — Margins applied to both sides (px). Default to `0`

**`ImageOverlayRect`** — UI overlay rectangle:

- `x: number` / `y: number` — Overlay position (px), relative to the right page's top-left corner — the frame `useImageOverlay` and `ChapterLayout.setImages` apply. A negative `x` reaches the left page
- `width: number` / `height: number` — Overlay size (px)

`ImageOverlayRect` is the only overlay-rectangle type in the package family; `@libraz/mejiro-react` and `@libraz/mejiro-vue` re-export it. The layout-side `ImageRect` above is a different type — it carries margins.

**`ColumnSlot`** — Rendering slot for one laid-out line:

- `xPos: number` — Offset from right edge of content area (px)
- `yStart: number` — Vertical offset from content top (px)
- `height: number` — Available text height (px)
- `columnIndex?: number` — Physical column the slot belongs to (0 = nearest the right content edge). Several slots share a `columnIndex` when an image splits a column into multiple gaps. Every slot produced by this package carries it; it is optional only so hand-built slot arrays stay assignable

Slots come out in reading order, and a column may contribute several slots or none, so a slot's array index is a line index — not a column index. Use `columnIndex` to identify the physical column, not `xPos`.

**`ExclusionResult`** — Output of `ExclusionEngine.compute()` and `computeExclusionSlots()`:

- `slots: readonly ColumnSlot[]` — Text placements in reading order
- `lineWidths: Float32Array` — Inline size of each slot, entry for entry, as the `lineWidths` input of `computeBreaks()`
- `affected: boolean` — Whether any column's slot coverage differs from the unobstructed layout (one full-height slot per column), including a column blocked entirely

**`ComputeExclusionSlotsInput`** — `ExclusionPageGeometry` plus `images: readonly ImageRect[]`.

**`ExclusionZone`** — Low-level exclusion zone:

- `blockStart: number` / `blockEnd: number` — Affected line range
- `inlineSize: number` — Space consumed (px)

**`SpreadGeometry`** — Two-page spread geometry:

- `pageWidth: number` — Width of each page (px)
- `paddingX: number` — Horizontal padding per side (px)
- `paddingY: number` — Vertical padding at top (px)
- `lineWidth: number` — Base line width (px)
- `linePitch: number` — Column pitch (px)

**`SpreadExclusionResult`** — Result of spread exclusion computation:

- `rightSlots: readonly ColumnSlot[]` — Slots for right page
- `leftSlots: readonly ColumnSlot[]` — Slots for left page
- `lineWidths: Float32Array` — Combined line widths for `computeBreaks()`: one entry per right-page slot, then one per left-page slot, so the first `rightSlots.length` lines belong to the right page
- `rightAffected: boolean` — Whether any right-page column's slot coverage differs from the unobstructed layout, including a column blocked entirely
- `leftAffected: boolean` — Same as `rightAffected`, for the left page

**`MejiroStorage`** — Storage interface accepted by the persistence hooks, a subset of the Web Storage API, so `localStorage` and `sessionStorage` satisfy it. An implementation may throw; the framework hooks catch the failure and report it through `onError`:

- `getItem(key: string): string | null` / `setItem(key: string, value: string): void` / `removeItem(key: string): void`

**`Annotation`** — Persisted user annotation:

- `id: string` / `chapterIndex: number`
- `start: InChapterAnchor` / `end: InChapterAnchor`
- `color?: string` / `note?: string` / `createdAt?: number`

**`MejiroLocale`** — `'en' | 'ja'`. **`MejiroMessages`** — UI string catalog shape.

**`FontChoice`** — `{ value: string; label: string }` entry for settings-panel font pickers.

**`EditableSettings`** — The typography the bundled settings panels edit: `fontFamily: string | readonly string[]` / `fontSize: number` / `lineSpacing?: number` / `kinsoku?: KinsokuMode` / `enableHanging?: boolean`.

**`PageHeaderData`** — `{ title?: string; pageNumber?: number | null }` for running headers.

**`ManuscriptToken` / `ManuscriptTokenKind`** — Source-position notation ranges returned by `tokenizeManuscriptSource()`. Each token spans `startOffset` (inclusive) to `endOffset` (exclusive) in UTF-16 offsets of the source.

**`BinaryInput`** — `ArrayBuffer | Uint8Array`, the byte input of every entry point that reads bytes. A `Uint8Array` is read within its own view (`byteOffset`, `byteLength`), so a Node `Buffer` slice works as it is; the input is neither kept nor modified. Byte output is always a `Uint8Array`.

**`HeadingLevel`** — `1 | 2 | 3 | 4 | 5 | 6`.

**`ParagraphKind`** — `'body' | 'heading' | 'blockquote' | 'sceneBreak' | 'pre' | 'figure'`.

**`BookParagraph`** — One paragraph of a chapter, as `MejiroBook.layoutChapter()` and the renderers take it: `text: string` / `kind?: ParagraphKind` / `inlineAnnotations?: readonly InlineAnnotation[]` / `headingLevel?: HeadingLevel` / `hints?: TypographyHints`. A paragraph is a heading when it has a `headingLevel` or its `kind` is `'heading'`.

**`ChapterSource`** — `{ paragraphs: readonly BookParagraph[] }`, the chapter shape `layoutChapter()`, `estimateReadingTime()` and `renderEpubStatic()` accept. An `EpubChapter` is one.

**`ManuscriptChapter`** — One chapter of a plain-text manuscript: `id?: string` / `title: string` / `body: string`. Shared by `MejiroBook.layoutManuscript()`, `manuscriptToEpubBook()`, `EpubProject` and the manuscript components and hooks.

**`InChapterAnchor`** — A reading position inside one chapter that survives reflow: `paragraphIndex: number` / `charIndex: number` (code point offset in the paragraph's NFC text).

**`ReadingAnchor`** — `InChapterAnchor` plus `chapterIndex: number`; the shape `serializeReadingPosition()` stores.

**`InlineAnnotation`** — Discriminated union of the seven inline annotation kinds, keyed by `type`. Every member carries `startIndex` (inclusive) and `endIndex` (exclusive) in NFC code point offsets, plus the fields below. The `ruby` and `tcy` variants reach the line breaker; the rest are render-only:

| Type | `type` | Extra fields |
|---|---|---|
| `InlineRubyAnnotation` | `'ruby'` | `rubyText: string`, `rubyType?: RubyType`, `jukugoSplitPoints?: readonly number[]` |
| `InlineEmphasisAnnotation` | `'emphasis'` | `style?: 'sesame' \| 'dot' \| 'circle'` — emphasis-dot (傍点) mark |
| `InlineTcyAnnotation` | `'tcy'` | — tate-chu-yoko (縦中横): the span is drawn horizontally inside the vertical column, and reaches the line breaker as one indivisible 1 em cluster |
| `InlineEmAnnotation` | `'em'` | — italic emphasis, rendered as `<em>` |
| `InlineStrongAnnotation` | `'strong'` | — strong emphasis, rendered as `<strong>` |
| `InlineLinkAnnotation` | `'link'` | `href: string`, `title?: string` |
| `InlineFootnoteAnnotation` | `'footnote-ref'` | `noteId: string` |

**`DEFAULT_LINE_SPACING`** — `1.8`, the line spacing every layer defaults to (`MeasureOptions.lineSpacing`, `BookOptions.lineSpacing`, the framework components). Re-exported from `@libraz/mejiro/render` and `@libraz/mejiro/book`.

### Errors

| Export | Signature |
|---|---|
| `MejiroError` | `class extends Error { readonly code: MejiroErrorCode }`, `constructor(code: MejiroErrorCode, message: string, options?: ErrorOptions)` |

The one error class every package throws for a failure that is not a programming error. Branch on `code`, not on `message`. Invalid arguments throw `TypeError` or `RangeError`, and an aborted operation rejects with its `signal.reason`. Every subpath and both framework packages re-export `MejiroError`, `MejiroErrorCode`, `MejiroWarning` and `MejiroWarningCode`, so an `instanceof` check works whichever entry point the error came from. See [Core concepts](./02-core-concepts.md#6-api-conventions) for the full table of codes.

**`MejiroErrorCode`** — The union of failure codes: `'epub-invalid-archive' | 'epub-invalid-package' | 'epub-limit-exceeded' | 'epub-unsupported-content' | 'dom-unavailable' | 'environment-unsupported' | 'font-unavailable' | 'font-load-failed' | 'page-size-unset' | 'fetch-failed' | 'asset-fetch-failed' | 'analyzer-unavailable' | 'analyzer-disposed' | 'analyzer-failed' | 'image-decode-failed' | 'image-encode-failed' | 'storage-read-failed' | 'storage-write-failed' | 'storage-corrupt' | 'snapshot-invalid' | 'regex-unsafe'`. The union grows in minor releases; a `switch` over it keeps a `default` branch.

**`MejiroWarning`** — A non-fatal degradation: `code: MejiroWarningCode` / `message: string`.

**`MejiroWarningCode`** — `'alignment-failed' | 'morphemes-dropped' | 'max-bytes-exceeded'`.

---

## `@libraz/mejiro/browser` — Browser Integration

`MejiroError`, `MejiroErrorCode`, `MejiroWarning` and `MejiroWarningCode` are re-exported from `@libraz/mejiro`.

### High-Level API

**`MejiroBrowser`** -- Main class:

- `constructor(options?: MejiroBrowserOptions)` -- Throws `TypeError` for an empty `fontFamily` and `RangeError` for a `fontSize` that is not a positive finite number
- `layout(options: LayoutOptions): Promise<BreakResult>` -- Layout single paragraph. Rejects with `TypeError` when no font family or size is given here or on the instance, with `MejiroError` `font-unavailable` under `strictFontCheck` when the font falls back, and with `environment-unsupported` when no canvas is available
- `layoutParagraphs(options: ChapterLayoutOptions): Promise<ParagraphsLayoutResult>` -- Layout multiple paragraphs
- `preloadFont(fontFamily?: FontFamily, fontSize?: number): Promise<void>` -- Preload font
- `verticalLineWidth(containerHeight: number, fontSize?: number): number` -- Compute effective line width
- `clearCache(fontSpec?: string): void` -- Clear the width cache, for one CSS font specification or entirely
- `cacheStats(): WidthCacheStats` -- Current width cache size
- `dispose(): void` -- Release the `document.fonts` subscription so an unused instance can be collected with its width cache. The instance stays usable and subscribes again on its next layout, refreshing its widths once on that reuse, since a font may have loaded while it was not listening. Idempotent

| Export | Signature |
|---|---|
| `layoutText` | `(options: LayoutTextOptions) => Promise<BreakResult>` |

`LayoutTextOptions` is `LayoutOptions` with `fontFamily` and `fontSize` required. Standalone one-shot layout function that does not require creating a `MejiroBrowser` instance. It creates its own measurer internally, so there is no caching across calls, then measures the text and computes breaks in a single call.

| Export | Signature |
|---|---|
| `verticalLineWidth` | `(containerHeight: number, fontSize: number) => number` |

Compute effective line width for vertical text. Formula: `containerHeight - fontSize * 0.5`.

### Font and Measurement

- `FontLoader` -- Font loading via FontFace API; see below
- `CharMeasurer` -- Character measurement via Canvas.measureText with codepoint caching
- `WidthCache` -- `Map<fontSpec, Map<codepoint, width>>`; see below
- `deriveRubyFont(fontFamily: FontFamily, fontSize: number, ratio?: number): string` -- Ruby font spec (half-size by default)
- `normalizeFontFamily(family: FontFamily): string` -- Normalize a string or family-name array to a CSS font-family string
- `toFontSpec(fontFamily: FontFamily, fontSize: number): string` -- CSS font spec

**`CharMeasurer`** -- Measures code points with `Canvas.measureText`:

- `constructor(options?: CharMeasurerOptions)` -- Throws `MejiroError` `environment-unsupported` when `options.canvas` has no 2D context
- `measure(fontSpec: string, codepoint: number): number` / `measureAll(fontSpec: string, text: Uint32Array): Float32Array`
- `getCache(): WidthCache`

**`CharMeasurerOptions`** -- `canvas?: HTMLCanvasElement` (validated at construction; created lazily otherwise) / `cache?: WidthCache` (a shared cache; a private unbounded one by default).

**`WidthCache`** -- Width cache keyed by CSS font specification and code point:

- `constructor(options?: WidthCacheOptions)`
- `get(fontSpec: string, codepoint: number): number | undefined` / `set(fontSpec: string, codepoint: number, width: number): void`
- `clear(fontSpec?: string): void` / `size(fontSpec?: string): number` -- For one font specification, or the whole cache
- `fontCount(): number` / `stats(): WidthCacheStats`

**`WidthCacheStats`** -- `fonts: number` (font specifications with entries) / `codepoints: number` (cached widths across them).

**`FontLoader`** -- Waits for web fonts before measurement:

- `constructor(options?: FontLoaderOptions)` -- Subscribes to the document's `loadingdone` event; `FontLoaderOptions.onFontsLoaded` fires after each one
- `ensureLoaded(fontSpec: string, text?: string): Promise<void>` -- Loads the font for the ranges `text` covers. Concurrent calls for the same spec share one request. Rejects with `MejiroError` `font-load-failed` when the font does not become usable; `MejiroBrowser` catches that and rejects only under `strictFontCheck`
- `isLoaded(fontSpec: string, text?: string): boolean` -- Whether `ensureLoaded` has confirmed the font for those ranges
- `isAvailable(fontSpec: string, text?: string): boolean` -- Whether the host can render the font for those ranges
- `dispose(): void` -- Removes the `loadingdone` subscription and forgets every readiness answer. The loader stays usable and subscribes again on its next `ensureLoaded`, running `onFontsLoaded` once on that reuse so the host refreshes widths measured while it was not listening. Idempotent

### Overlay Drag Sessions

| Export | Signature |
|---|---|
| `createOverlayDragSession` | `(options: OverlayDragSessionOptions) => OverlayDragSession` |
| `isPrimaryPointerPress` | `(event: Pick<PointerEvent, 'pointerType' \| 'button'>) => boolean` |

Drives an image-overlay drag or resize from a pointer-down handler: it listens for `pointermove` / `pointerup` on the document, coalesces updates into an animation frame where the runtime provides one, and re-derives each rectangle from the pointer-down rectangle plus the cumulative delta, so rounding never accumulates during a gesture.

Start a session only for a press `isPrimaryPointerPress` accepts: a touch or pen contact, or the primary mouse button. A secondary or auxiliary button opens a context menu or autoscroll, and the browser may never deliver its `pointerup`.

It lives in the browser layer rather than in core because it owns pointer capture and document-level listeners — `document`, `requestAnimationFrame` and `setPointerCapture`. The rectangle arithmetic it delegates to (`moveImageOverlayRect` / `resizeImageOverlayRect`, over `ImageOverlayRect`) is DOM-free and stays in `@libraz/mejiro`.

**`OverlayDragMode`** — `'move' | 'resize'`. `'move'` translates the captured rectangle; `'resize'` grows or shrinks it from the bottom-right corner.

**`OverlayDragSessionOptions`** — Input for `createOverlayDragSession()`:

- `mode: OverlayDragMode` — Gesture to apply to `rect`
- `rect: ImageOverlayRect` — Rectangle captured at pointer-down; never mutated
- `startX: number` / `startY: number` — Pointer position at pointer-down, in client coordinates (px)
- `pointerId?: number` — Pointer that owns the gesture. Together with `captureElement` the element captures it, so the gesture survives the pointer leaving the overlay
- `captureElement?: HTMLElement | null` — Element the pointer is captured on, usually the pointer-down target
- `activeElement?: HTMLElement | null` — Element carrying `dragClass` while the gesture runs, often the overlay itself even when the gesture started on a child handle
- `dragClass?: string` — Class toggled on `activeElement` for the duration of the gesture
- `minSize?: number` — Minimum width and height in `'resize'` mode (px, default `40`)
- `onRectChange: (rect: ImageOverlayRect) => void` — Receives a fresh rectangle per update
- `onEnd?: () => void` — Called exactly once when the gesture ends, however it ended
- `registry?: Set<() => void>` — Set the session registers its disposer in for the gesture's lifetime, so a host can end every in-flight gesture on unmount. The entry removes itself once the gesture ends

**`OverlayDragSession`** — Handle returned by `createOverlayDragSession()`:

- `active: boolean` — Whether the gesture is still running (readonly)
- `dispose(): void` — Ends the gesture for good and releases every listener, dropping any update not yet delivered. A session cannot be restarted; idempotent

### Types

**`FontFamily`** -- `string | readonly string[]`. A CSS-ready string (`'"Noto Serif JP", serif'`) or an array of family names, escaped and joined by `normalizeFontFamily()`. Every `fontFamily` option below takes this type.

**`MejiroBrowserOptions`**:

- `fontFamily?: FontFamily` -- Font family used when a layout call omits one
- `fontSize?: number` -- Font size used when a layout call omits one
- `strictFontCheck?: boolean` -- Reject with `font-unavailable` when the font measures like the fallback
- `onFontsLoaded?: () => void` -- Called after the host reports newly loaded fonts and the width cache has been cleared; lay out earlier results again here

**`LayoutOptions`**:

- `text: string`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `lineWidth: number`
- `kinsoku?: KinsokuMode`
- `enableHanging?: boolean`
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `tokenBoundaries?: Uint32Array | readonly number[]`
- `hints?: TypographyHints`
- `breakCost?: BreakCostOptions`

**`ChapterLayoutOptions`**:

- `paragraphs: readonly ParagraphInput[]`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `lineWidth: number`
- `kinsoku?: KinsokuMode`
- `enableHanging?: boolean`
- `breakCost?: BreakCostOptions`

**`LayoutTextOptions`** -- `LayoutOptions` with `fontFamily: FontFamily` and `fontSize: number` required, for `layoutText()`.

**`ParagraphsLayoutResult`**:

- `paragraphs: readonly ParagraphLayoutResult[]`

**`ParagraphLayoutResult`**:

- `breakResult: BreakResult`
- `chars: readonly string[]`

**`ParagraphInput`**:

- `text: string`
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `tokenBoundaries?: Uint32Array | readonly number[]`
- `hints?: TypographyHints`

**`InlineAnnotation`** and its variants `InlineRubyAnnotation`, `InlineEmphasisAnnotation`, `InlineTcyAnnotation`, `InlineEmAnnotation`, `InlineStrongAnnotation`, `InlineLinkAnnotation` and `InlineFootnoteAnnotation` — Re-exported from `@libraz/mejiro`, where the table of variants is.

**`WidthCacheOptions`** — Bounds for `WidthCache`:

- `maxFonts?: number` — Maximum number of cached font specifications
- `maxCodepointsPerFont?: number` — Maximum number of cached codepoints per font specification

Both default to `Infinity`, which switches LRU bookkeeping off entirely rather than merely never evicting — setting a finite value changes the read path as well.

---

## `@libraz/mejiro/epub` — EPUB Parsing and Authoring

| Export | Signature |
|---|---|
| `parseEpub` | `(data: BinaryInput, options?: EpubParseOptions) => Promise<EpubBook>` |
| `parseEditableEpub` | `(data: BinaryInput, options?: EpubParseOptions) => Promise<EditableEpub>` |
| `DEFAULT_EPUB_PARSE_LIMITS` | Default resource limits applied to untrusted archives |
| `assertEpubInputSize` | `(byteLength: number, limits?: Partial<EpubParseLimits>) => void`. Throws `MejiroError` `epub-limit-exceeded` when `byteLength` exceeds the resolved `maxInputBytes`, so a `File` can be rejected by its `size` before its bytes are read |
| `EditableEpub` | Editing session over a parsed EPUB: block-level edits, undo history and export |
| `editableEpubToEpubBook` | `(epub: EditableEpubBook) => EpubBook`. Projects an editable book into the `EpubBook` shape a reader lays out, for live preview: the paragraphs `parseEpub` would read from the exported book, chapters index-aligned with `epub.chapters` |
| `EpubProject` | Class for creating a new EPUB 3 package from manuscript chapters |
| `parseManuscript` | Re-exported from `@libraz/mejiro`. `ManuscriptDialect`, `ParseManuscriptOptions`, `ParsedManuscript` and `ManuscriptChapter` are re-exported with it |
| `manuscriptToEpubBook` | `(chapters: readonly ManuscriptChapter[], options?: ManuscriptToEpubBookOptions) => EpubBook`. Synthesizes an `EpubBook` from manuscript chapters without a ZIP round-trip — designed for live preview. A chapter's `id` does not appear in the result |

`MejiroError`, `MejiroErrorCode`, `MejiroWarning` and `MejiroWarningCode` are re-exported from `@libraz/mejiro`.

`parseEpub` parses an EPUB file into structured chapters with ruby annotations. Both parsers read a `Uint8Array` within its own view (a Node `Buffer` slice included) and neither keep nor modify the input. They throw `MejiroError` with `epub-invalid-archive` when the input is not a readable ZIP archive (an empty or one-byte input included), `epub-invalid-package` when the container, package document or a chapter is malformed or no chapter is readable, `epub-limit-exceeded` when the archive passes one of the limits, and `dom-unavailable` when the host has no DOM implementation. `TypeError` reports an input that is not an `ArrayBuffer` or `Uint8Array`, and `RangeError` a limit that is not a positive integer.

Both parsers need a DOM XML parser: they require global `DOMParser`, `XMLSerializer` and `Node`. Browsers provide them; on Node install a DOM implementation and expose it on `globalThis` before calling in.

`EpubParseOptions` takes `limits` and `signal`. `limits` overrides the archive resource limits applied to untrusted input (`DEFAULT_EPUB_PARSE_LIMITS`): `maxInputBytes` (100 MiB), `maxEntries` (10,000), `maxEntryBytes` (50 MiB), `maxTotalBytes` (200 MiB) and `maxCompressionRatio` (1,000). A key left out or set to `undefined` keeps its default. `signal` cancels the parse: the promise rejects with `signal.reason`, also when the signal is already aborted at the call.

| Export | Signature |
|---|---|
| `extractRubyContent` | `(xhtml: string) => AnnotatedParagraph[]` |

Extracts paragraphs and ruby annotations from an XHTML document string. Throws `MejiroError` `dom-unavailable` when the host has no DOM implementation.

| Export | Signature |
|---|---|
| `cloneEditableEpubBook` | `(epub: EditableEpubBook) => EditableEpubBook` |
| `clampEditableEpubSelection` | `(epub: EditableEpubBook \| null, selection: EditableEpubSelection) => EditableEpubSelection` |

`cloneEditableEpubBook` deep-copies an editable book so preview rendering and export-only transforms never reach the document the editor owns. `clampEditableEpubSelection` confines a `{ chapterIndex, blockId }` selection to the book: the chapter index is truncated and clamped, and a block id the chapter does not hold moves to the chapter's first block (`null` when it has none).

### EditableEpub

**`EditableEpub`** — Editing session over a parsed EPUB, with undo history. Created by `parseEditableEpub()`. Existing blocks are addressed by `(chapterIndex, blockId)`; an index appears only where a block is put. An unknown chapter index or block id, or the id of a block of the wrong kind, throws `RangeError`. An edit that throws changes and records nothing.

- `epub: EditableEpubBook` — The live document model (readonly). Changing it directly bypasses the undo history and the change notifications, so route edits through the session's methods
- `title: string` / `author: string | undefined` — Package metadata (getters)
- `chapters: readonly EditableEpubChapter[]` — Chapters in spine order (getter). The live array, not a copy
- `subscribe(listener: () => void): () => void` — Calls `listener` after every change: each edit, each completed transaction (once), each undo and redo. Returns the function that removes it. A listener that throws does not stop the others; its error is rethrown on a microtask
- `transaction<T>(fn: () => T): T` — Group a sequence of edits into one history entry and one change notification. Nested calls fold into the outermost transaction; a throw inside `fn` rewinds the edits made inside it. `fn` runs synchronously, and a callback returning a promise is rejected by the type
- `undo(): boolean` / `redo(): boolean` — Revert or re-apply one committed change (or transaction). `false` when the corresponding stack is empty
- `history: EditHistoryState` — Snapshot of the undo/redo state (getter)
- `insertParagraph(chapterIndex: number, index: number, paragraph: NewParagraph): EditableParagraphBlock` — Insert at `index` in `chapter.blocks` (clamped; pass `chapter.blocks.length` to append) and return the stored block with its generated `id`. Throws `RangeError` when `headingLevel` is not an integer from 1 to 6, and `TypeError` when a heading has no level, a non-heading has one, or a scene break carries text; annotations outside `text` are dropped
- `updateParagraph(chapterIndex: number, blockId: string, patch: ParagraphPatch): void` — Change text, annotations, heading level or kind. When `text` changes without new `inlineAnnotations`, existing annotations are re-anchored onto the new text: each one either keeps covering exactly the same base characters or is dropped
- `setInlineAnnotations(chapterIndex: number, blockId: string, inlineAnnotations: readonly InlineAnnotation[]): void` — Replace a paragraph's annotations; entries outside the current text are dropped
- `deleteBlock(chapterIndex: number, blockId: string): void` — Remove a paragraph or image block. An image's asset goes with it when no other block references it
- `splitParagraph(chapterIndex: number, blockId: string, charIndex: number): EditableParagraphBlock` — Split at a code point index; the block keeps its id and the text before the split, and the returned new block takes the rest. A fractional index is truncated, an out-of-range one is clamped and a non-finite one throws. Annotations straddling the cut are dropped
- `mergeParagraphs(chapterIndex: number, pair: MergeParagraphsInput): EditableParagraphBlock` — Join `pair.rightId` into `pair.leftId`, which must immediately precede it, and return the merged block
- `moveBlock(chapterIndex: number, blockId: string, toIndex: number): void` — Move a block to a new index in `chapter.blocks` (clamped)
- `addImage(chapterIndex: number, image: AddImageInput): EditableImageBlock` — Add an image asset and an image block referencing it, and return the block; `block.assetKey` names the asset. The bytes of a `data` input are copied
- `removeImageAsset(assetKey: string): void` — Remove an asset together with every image block that references it, as one history entry
- `updateImage(chapterIndex: number, blockId: string, patch: Partial<Omit<EditableImageBlock, 'kind' | 'id' | 'assetKey'>>): void` — Update alt text, caption or placement
- `setImageCaption(chapterIndex: number, blockId: string, caption: string | null): void` — Set the caption, or remove it with `null`
- `export(options?: EditableEpubExportOptions): Promise<Uint8Array>` — Serialize the edited EPUB. The document is captured synchronously on entry, so an edit made while the export is still awaiting asset bytes lands in the next export, never part-way through this one. Rejects with `MejiroError` `epub-unsupported-content` when an edited chapter holds content the block model cannot write back, `asset-fetch-failed` when the default fetch of a URL-only asset fails, and with `signal.reason` when `options.signal` aborts

### EpubProject

**`EpubProject`** — Builds a new EPUB 3 package from manuscript chapters. Its state is read-only from outside; every change goes through a method.

- `constructor(options: EpubProjectOptions)` — Applies the defaults, then registers `chapters` and `cover`, so an invalid cover throws here rather than at export time
- `static fromManuscript(options: EpubProjectOptions): EpubProject` — Named-constructor spelling of `new EpubProject(options)`
- `metadata: Readonly<EpubProjectMetadata>` — Package metadata with defaults applied (`language` falls back to `'ja'`, a blank `identifier` is replaced by a fresh `urn:uuid:` value, `modified` defaults to construction time)
- `chapters: readonly Readonly<ProjectChapter>[]` — Chapters in spine order, each with the manifest id assigned at insert time
- `assets: readonly Readonly<EpubProjectAsset>[]` — Manifest assets in insertion order, with resolved id / href / media type. A cover is always the last entry
- `includeTitlePage: boolean` / `includeTitleInFirstChapter: boolean` / `pageProgressionDirection: 'rtl' | 'ltr' | 'default'` / `dialect: ManuscriptDialect` — Settled from the constructor options
- `stylesheet: string` — CSS written to `OPS/Styles/style.css`
- `updateMetadata(patch: Partial<EpubProjectMetadata>): void` — Merge into the metadata. Fields left out or set to `undefined` keep their value
- `setStylesheet(css: string): void` — Replace the stylesheet
- `addChapter(chapter: ManuscriptChapter): Readonly<ProjectChapter>` — Append to the spine and return the stored chapter. The id is sanitized to an XML-safe manifest id and suffixed on collision, so the stored id may differ from `chapter.id`
- `updateChapter(index: number, patch: Partial<Omit<ManuscriptChapter, 'id'>>): void` — Omitted fields keep their previous value. Inline image assets the new body no longer references are dropped
- `removeChapter(index: number): void` — Remove by index, dropping the inline image assets only that chapter referenced
- `reorderChapters(from: number, to: number): void` — An out-of-range `from` is a no-op and `to` is clamped, because drag-and-drop reorder UIs routinely emit both
- `addImage(chapterIndex: number, image: EpubProjectImageInput): Readonly<EpubProjectAsset>` — Store the image under `OPS/Images/<filename>`, embed a reference to it in the chapter body at `atParagraphIndex` (rendered as a `<figure>` during export), and return the stored asset
- `setCover(cover: CoverInput): Readonly<EpubProjectAsset>` — Register the cover under `OPS/Images/<filename>` (`cover.jpg` by default), replacing any previous one, and return it as stored
- `addAsset(asset: EpubProjectAsset): Readonly<EpubProjectAsset>` — Add a manifest asset and return the stored copy. The href is renamed with a `-2`, `-3`, … suffix on collision, so link the returned `href` rather than the one passed in. Throws `TypeError` when the href is not a clean relative path inside the archive
- `export(options?: EpubExportOptions): Promise<Uint8Array>` — Serialize to an EPUB 3 ZIP: `mimetype` first and uncompressed, then the container, package, nav document, stylesheet, optional title page, one XHTML document per chapter, and every asset. Asset bytes come from `data`, or from `url` through `options.assetResolver` (the runtime `fetch` when no resolver is given). Rejects with `MejiroError` `epub-invalid-package` when the project has no chapters, `asset-fetch-failed` when the default fetch fails, and with `signal.reason` when `options.signal` aborts

Mutators that throw on a bad address — `updateChapter` and `removeChapter` on an unknown index, `addImage` on an unknown chapter or a non-integral `atParagraphIndex` — throw `RangeError`; an image or cover with neither `data` nor `url`, or a `filename` that is not a plain file name, throws `TypeError`.

### Types

**`EpubBook`** (read-only):

- `title: string`
- `author?: string` — Display string of the book's creators
- `chapters: readonly EpubChapter[]`
- `pageProgressionDirection?: 'rtl' | 'ltr' | 'default'`

**`EpubChapter`** (read-only):

- `title?: string`
- `paragraphs: readonly AnnotatedParagraph[]`

**`AnnotatedParagraph`**:

- `text: string`
- `inlineAnnotations: readonly InlineAnnotation[]`
- `headingLevel?: HeadingLevel`

**`ParagraphKind`** — Re-exported from `@libraz/mejiro`.

**`EditableBlock`** — Union of `EditableParagraphBlock` and `EditableImageBlock`, discriminated by `kind`:

- **`EditableParagraphBlock`**: `kind: 'paragraph'`, `id: string`, `text: string`, `inlineAnnotations: readonly InlineAnnotation[]`, `paragraphKind?: Exclude<ParagraphKind, 'figure'>`, `headingLevel?: HeadingLevel` (present exactly when `paragraphKind` is `'heading'`)
- **`EditableImageBlock`**: `kind: 'image'`, `id: string`, `assetKey: string`, `alt?: string`, `caption?: string`, `placement?: 'inline' | 'fullspread'`

**`NewParagraph`** — Input of `insertParagraph()`, a union keyed by `paragraphKind`: body text, a blockquote or preformatted text (`paragraphKind?: 'body' | 'blockquote' | 'pre'`, `text`, `inlineAnnotations?`), a heading (`paragraphKind: 'heading'`, `headingLevel: HeadingLevel`, `text`, `inlineAnnotations?`), or a scene break (`paragraphKind: 'sceneBreak'`, no text). `insertParagraph(0, 0, { text })` inserts a body paragraph.

**`ParagraphPatch`** — Input of `updateParagraph()`. Without `paragraphKind` the kind is kept, and `text`, `inlineAnnotations` and `headingLevel` (headings only) may change. With `paragraphKind`, the fields the new kind needs come along: `'heading'` requires `headingLevel`, and `'sceneBreak'` takes no text.

**`MergeParagraphsInput`** — `{ leftId: string; rightId: string }` for `mergeParagraphs()`: the surviving paragraph and the one immediately after it.

**`EditHistoryState`** — `canUndo: boolean` / `canRedo: boolean` / `depth: number` / `redoDepth: number`, read from `EditableEpub.history`.

**`EditableEpubBook`** — `EpubBook` whose `chapters` are `readonly EditableEpubChapter[]`.

**`EditableEpubChapter`** — Chapter with enough source metadata to be written back:

- `title?: string` — Chapter title, from heading elements or the table of contents
- `href: string` — ZIP path of the source chapter document
- `originalXhtml: string` — Source markup, reused for chapters that were never edited
- `blocks: readonly EditableBlock[]` — The editable content, in document order
- `imageAssets: ReadonlyMap<string, EditableImageAsset>` — Assets keyed by `assetKey`

**`EditableImageAsset`** — Image attached to an editable chapter, looked up by `assetKey` from one or more image blocks (several blocks may share one asset). A union of a bytes variant (`data: Uint8Array`) and a URL variant (`url: string`, fetched at export time through `EpubExportOptions.assetResolver`); both carry `filename: string`, `href?: string` (kept when the image came from the source EPUB) and `mediaType?: string`.

**`AddImageInput`** — Input for `EditableEpub.addImage()`. A union of `AddImageInputBytes` (`data: BinaryInput`, no `url`) and `AddImageInputUrl` (`url: string`, no `data`), both extending **`AddImageInputCommon`**: `filename: string`, `mediaType?: string`, `alt?: string`, `caption?: string`, `placement?: 'inline' | 'fullspread'`, `afterBlockId?: string`.

**`EditableEpubSelection`** — `{ chapterIndex: number; blockId: string | null }`, the block an editor UI currently targets, or `null` when no block is selected.

**`EpubExportOptions`** — Options both export paths honour:

- `onProgress?: (phase: 'serialize' | 'zip', ratio: number) => void` — `ratio` runs from 0 to 1 within each phase and starts again from 0 when the next phase begins. Not called once the export has been aborted
- `signal?: AbortSignal` — Cancels the export; the promise rejects with `signal.reason`
- `assetResolver?: AssetResolver` — Resolves URL-only assets; the runtime `fetch(url, { signal })` when omitted

**`EditableEpubExportOptions`** — `EpubExportOptions` plus `watermark?: string`: the text of a paragraph inserted at the top of every exported chapter. Only the exported copy carries it; the edited document is left as it is, and an empty string inserts nothing.

**`AssetResolver`** — `(request: AssetResolverRequest) => Promise<BinaryInput> | BinaryInput`. Called once per asset that declares a `url` and carries no inline `data`. Throw to abort the export.

**`AssetResolverRequest`**:

- `url: string` — URL declared on the asset
- `href: string` — ZIP path the resolved bytes are written to inside the exported EPUB. The same on both export paths, so one resolver serves both
- `mediaType?: string` — Media type declared on the asset, when it has one
- `signal?: AbortSignal` — The export's `AbortSignal`, when one was passed

**`EpubParseLimits`** — Resource limits applied while opening an untrusted archive: `maxInputBytes`, `maxEntries`, `maxEntryBytes`, `maxTotalBytes`, `maxCompressionRatio` (all required; `DEFAULT_EPUB_PARSE_LIMITS` supplies the values above).

**`EpubParseOptions`** — `limits?: Partial<EpubParseLimits>` / `signal?: AbortSignal`, for both parsers.

**`ManuscriptToEpubBookOptions`** — `dialect?: ManuscriptDialect` / `metadata?: Partial<EpubProjectMetadata>` for `manuscriptToEpubBook()`. `EpubBook.author` joins the `aut` creators with `', '`.

**`EpubProjectOptions`** — Constructor options for `EpubProject`:

- `metadata: EpubProjectMetadata` — Required
- `chapters?: readonly ManuscriptChapter[]` / `cover?: CoverInput` — Registered through `addChapter()` / `setCover()` during construction
- `dialect?: ManuscriptDialect` — Notation dialect chapter bodies are parsed with (default `'mejiro'`)
- `stylesheet?: string` — Replaces the bundled default stylesheet
- `pageProgressionDirection?: 'rtl' | 'ltr' | 'default'` — Default `'rtl'`
- `includeTitlePage?: boolean` — Default `true`
- `includeTitleInFirstChapter?: boolean` — Default `false`

**`ProjectChapter`** — A chapter as stored on a project: `id: string` (resolved and de-duplicated), `title: string`, `body: string`.

**`EpubProjectAsset`** — A binary file packaged alongside the chapters. A union of a bytes variant (`data: BinaryInput`, copied on add) and a URL variant (`url: string`, fetched at export time); both carry:

- `href: string` — ZIP path, relative and inside the archive. It is the literal file name: a `%` is part of the name, not an escape, and the path is percent-encoded when written to the manifest and to `src` attributes
- `id?: string` / `mediaType?: string` — Derived from `href` when omitted
- `properties?: string` — Manifest properties; the cover carries `'cover-image'`

**`CoverInput`** — Input of `setCover()` and `EpubProjectOptions.cover`: `data: BinaryInput` or `url: string` (never both), `mediaType: string`, `filename?: string` (default `'cover.jpg'`, inside `OPS/Images/`).

**`EpubProjectImageInput`** — Input of `EpubProject.addImage()`: `filename: string`, `data: BinaryInput` or `url: string` (never both), `mediaType?: string`, `alt?: string`, `atParagraphIndex: number` (counted in the blank-line separated blocks of the chapter body; values past the end append).

**`EpubProjectMetadata`** includes `title` (required), `subtitle`, `description`, `language`, `identifier`, `publisher`, `rights`, `date`, `modified`, `creators`, `contributors`, `subjects` and `collections`. **`EpubContributor`** is `{ name: string; role?: string; fileAs?: string }` and **`EpubCollection`** is `{ name: string; type?: 'series' | 'set'; index?: number }`.

---

## `@libraz/mejiro/render` — Render Data

| Export | Signature |
|---|---|
| `buildParagraphMeasures` | `(entries: readonly RenderEntry[], options: MeasureOptions) => ParagraphMeasure[]` |

Computes paragraph measures for pagination. A paragraph containing ruby or emphasis budgets at least `1.5` em per line, whatever `lineSpacing` is; `buildLineMetrics` applies the same rule.

| Export | Signature |
|---|---|
| `buildRenderPage` | `(slices: readonly PageSlice[], entries: readonly RenderEntry[]) => RenderPage` |
| `renderEpubStatic` | `(chapter: ChapterSource, options?: RenderEpubStaticOptions) => string` |
| `buildLineMetrics` | `(entries: readonly RenderEntry[], options: MeasureOptions) => LineMetricsResult` |
| `countPageLines` | `(metrics: readonly LineMetric[], startIndex: number, pageWidth: number) => number` |
| `buildColumnSlots` | `(input: BuildColumnSlotsInput) => ColumnSlot[]` |
| `adjustExclusionSlots` | `(input: AdjustExclusionSlotsInput) => ColumnSlot[]` |
| `getImageXOffset` | `(offsets: Float32Array, spreadStartLine: number, col: number) => number` |
| `findPhysicalColumn` | `(input: FindPhysicalColumnInput) => number` |
| `paragraphClassName` | `(kind: ParagraphKind \| undefined, headingLevel?: HeadingLevel) => string` |
| `pageNumberFor` | `(pageNumbers: PageNumberDisplay, pageIndex: number) => number \| null` |

Converts page slices + entries into a renderable page structure. `renderEpubStatic`
returns framework-agnostic HTML for a single chapter, suitable for SSR fallback
markup before the client reader hydrates. Its wrapper carries `mejiro-page--static`, under
which the bundled `mejiro.css` lets paragraphs wrap natively, and annotation offsets index
each paragraph's text as given, normalized to NFC together with it exactly as `MejiroBook`
does.
The metric/slot helpers are low-level utilities for slot-based rendering and image-exclusion layout. `countPageLines` returns how many lines from `startIndex` fit in `pageWidth`. The three object inputs are `BuildColumnSlotsInput` (`metrics`, `startIndex`, `count`, `columnHeight`), `AdjustExclusionSlotsInput` (`slots`, `metrics`, `startIndex`, `basePitch`, `contentWidth?`) and `FindPhysicalColumnInput` (`offsets`, `spreadStartLine`, `fromRight`, `basePitch`). Pass `contentWidth` to `adjustExclusionSlots`; without it a slot whose column is widened by a heading can overflow the page edge.
`paragraphClassName` builds the `mejiro-paragraph …` class string the bundled stylesheets
expect from a paragraph's `kind` and `headingLevel` — use it instead of assembling the
modifier names by hand.
`pageNumberFor` returns the one-based page number that the running head of the page at zero-based `pageIndex` prints, or `null` when `pageNumbers` (`PageNumberDisplay`: `'both' | 'right' | 'left' | 'none'`) hides it. Even indices are right-hand pages. Paginated and scroll readers share this rule.
`renderEpubStatic` takes a `ChapterSource` — `{ paragraphs: readonly BookParagraph[] }`, re-exported here from `@libraz/mejiro` — so an `EpubChapter` or a hand-built object both satisfy it.

`MejiroError`, `MejiroErrorCode`, `MejiroWarning`, `MejiroWarningCode` and `DEFAULT_LINE_SPACING` are re-exported from `@libraz/mejiro`.

### Inline Segment Rendering

| Export | Signature |
|---|---|
| `segmentToInlineNode` | `(segment: RenderSegment) => InlineRenderNode` |
| `buildInlineNodes` | `(chars: readonly string[], annotations: readonly InlineAnnotation[], start?: number, end?: number) => InlineNode[]` |

`segmentToInlineNode` resolves any of the eight `RenderSegment` variants — nested
`children` and unsafe link URLs included — into an `InlineRenderNode` tree
(`{ type: 'text' }` or `{ type: 'element', tag, className?, href?, title?, children }`),
so a third-party renderer reuses mejiro's annotation policy instead of re-deriving it:

```ts
import { segmentToInlineNode } from '@libraz/mejiro/render';
import type { InlineRenderNode } from '@libraz/mejiro/render';

function appendInlineNode(parent: Node, node: InlineRenderNode): void {
  if (node.type === 'text') {
    parent.appendChild(document.createTextNode(node.text));
    return;
  }
  const el = document.createElement(node.tag);
  if (node.className) el.className = node.className;
  if (node.href) el.setAttribute('href', node.href);
  if (node.title) el.title = node.title;
  for (const child of node.children) appendInlineNode(el, child);
  parent.appendChild(el);
}
```

`buildInlineNodes` is the layer below: it turns a character range plus its annotations
into the nested `InlineNode` tree that `buildRenderPage()` converts into segments. `InlineNode` keys its variants by `type` like `RenderSegment` does, with `children` always present. Which
annotations survive is decided on the whole paragraph, so a partially overlapping pair is
dropped identically however the paragraph is split into lines.

### CSS

```ts
import '@libraz/mejiro/render/mejiro.css';
import '@libraz/mejiro/render/mejiro-reader.css';
import '@libraz/mejiro/render/mejiro-editor.css';
import '@libraz/mejiro/render/mejiro-print.css';
import '@libraz/mejiro/render/mejiro-fonts.css';
```

The first four are the page, reader chrome, editor chrome and print stylesheets.
`mejiro-fonts.css` is optional: it pulls the demo webfonts from Google Fonts and rebinds
`--mejiro-font-body` / `--mejiro-font-ui` to them — skip it when self-hosting fonts or
avoiding external requests.

### Types

**`RenderEntry`**:

- `chars: readonly string[]`
- `breakPoints: Uint32Array`
- `inlineAnnotations: readonly InlineAnnotation[]`
- `headingLevel?: HeadingLevel` — Heading level; undefined for body text
- `kind?: ParagraphKind` — Structural classification of the source paragraph (default `'body'`)

**`RenderPage`**:

- `paragraphs: readonly RenderParagraph[]`

**`RenderParagraph`** (read-only) — a heading is a paragraph with a `headingLevel` or with `kind: 'heading'`:

- `lines: readonly RenderLine[]`
- `headingLevel?: HeadingLevel`
- `kind?: ParagraphKind` — Structural classification of the source paragraph, mapped to a `mejiro-paragraph--*` class by the page components
- `scale?: number` — Font scale a `ChapterLayout` measured this heading at. The page components set it as `--mejiro-paragraph-scale`, so the drawn size is the measured one. Absent on body paragraphs and on pages built directly with `buildRenderPage()`, where the stylesheet's per-level scale applies

**`RenderLine`**:

- `segments: readonly RenderSegment[]`

**`RenderSegment`** — every variant except `text` also accepts `children?: readonly RenderSegment[]` for nested annotations. `text` is the span's content flattened to a string, and `children` covers the same range with the annotations nested inside it: draw one of the two, never both, or the characters appear twice. `segmentToInlineNode()` makes that choice for you:

- `{ type: 'text'; text: string }`
- `{ type: 'ruby'; text: string; rubyText: string; children? }` — `text` is the base text
- `{ type: 'emphasis'; text: string; style: 'sesame' | 'dot' | 'circle'; children? }`
- `{ type: 'tcy'; text: string; children? }`
- `{ type: 'em'; text: string; children? }`
- `{ type: 'strong'; text: string; children? }`
- `{ type: 'link'; text: string; href: string; title?: string; children? }`
- `{ type: 'footnote-ref'; text: string; noteId: string; children? }`

**`InlineRenderNode`** — output of `segmentToInlineNode()`:

- `{ type: 'text'; text: string }`
- `{ type: 'element'; tag: InlineRenderTag; className?: string; href?: string; title?: string; children: InlineRenderNode[] }`

**`InlineRenderTag`** — `'ruby' | 'rt' | 'span' | 'em' | 'strong' | 'a'`

**`MeasureOptions`**:

- `fontSize: number`
- `lineSpacing?: number` — Line spacing multiplier (default: `DEFAULT_LINE_SPACING`, 1.8)
- `headingScale?: number` (default: 1.4) — A heading without a level takes it as is; levels 1–6 scale their `DEFAULT_HEADING_STYLES` size in proportion to it, unless `headingStyles` sets the level's `scale`
- `paragraphGapEm?: number` (default: 0.4)
- `headingGapEm?: number` — Gap after every heading level `headingStyles` does not override. Unset, each level takes its `DEFAULT_HEADING_STYLES` gap (`1.2` without a level)
- `headingStyles?: Record<number, HeadingStyle>` — Per-level overrides of `scale` / `gapAfterEm` for levels 1–6; a level left out keeps its default. `ChapterLayout` pages carry the measured scale to the page components; when rendering `buildRenderPage()` output yourself with non-default heading sizes, set `--mejiro-paragraph-scale` to the same scale, or measuring and rendering disagree on heading size

**`HeadingStyle`**:

- `scale?: number` / `gapAfterEm?: number`

---

## `@libraz/mejiro/book` — High-Level API

The recommended entry point for most applications. Orchestrates font loading, layout, pagination, and image exclusion in a simple class-based API.

`MejiroError`, `MejiroErrorCode`, `MejiroWarning`, `MejiroWarningCode`, `DEFAULT_LINE_SPACING`, `BookParagraph`, `ChapterSource`, `HeadingLevel`, `ParagraphKind`, `InlineAnnotation`, `ManuscriptChapter`, `InChapterAnchor` and `ReadingAnchor` are re-exported from `@libraz/mejiro`, and `WidthCacheStats` from `@libraz/mejiro/browser`.

### Constants

| Export | Description |
|---|---|
| `DEFAULT_HEADING_STYLES` | Default heading style for levels 1–6 (`{ 1: { scale: 1.6, gapAfterEm: 1.4 }, ... 6: { scale: 1.0, gapAfterEm: 0.6 } }`), matching the per-level sizes and gaps of the bundled stylesheets. Applied when `headingStyles` leaves a level out, with each `scale` proportional to `headingScale`, so a book needs no `headingStyles` to get them |
| `DEFAULT_BOOK_OPTIONS` | Default font, spacing and kinsoku options. Carries no `headingStyles`, so `headingScale` resizes every heading level |
| `DEFAULT_PAGE_GEOMETRY` | Defaults `fitPageSize()` fits pages with: the `aspect` ratio (height / width), `minWidth` / `minHeight` / `maxHeight`, and the container space reserved for the header (`headerOffset`) and spread gutter (`gutterOffset`); lengths in pixels |
| `DEFAULT_PAGE_PADDING` | Default page padding in pixels, under the `FitPageSizeOptions` keys: `{ paddingX: 52, paddingY: 56, paddingBottom: 40 }` |

### MejiroBook

**`MejiroBook`** — Main orchestrator class:

- `constructor(options: BookOptions)` — Record the typography and, when `options.pageSize` is given, the page geometry. Nothing is measured until the first layout. Throws `TypeError` when `fontFamily` is absent or empty or `fontSize` is absent, and `RangeError` when `fontSize` is not a positive finite number or `pageSize` fails the `setPageSize` checks
- `getOptions(): ResolvedBookOptions` — The options the book is using, every default resolved, construction-time keys included
- `updateOptions(patch: BookOptionsPatch): Promise<void>` — Merge `patch` into the options and propagate the change to live layouts. `lineSpacing` / `kinsoku` / `enableHanging` apply synchronously and the returned promise is already resolved. `fontFamily` / `fontSize` / `headingStyles` / `headingScale` need re-measurement: the values are staged and become visible to `getOptions()` only after the font has loaded, so every live layout always holds advances measured with the font recorded in its own config. Overlapping calls converge on the last one. A live layout re-breaks on its next read, so one replaced before it is read never re-breaks. With `strictFontCheck`, a staged font that measures as a fallback rejects with `font-unavailable` (or `font-load-failed`) and leaves the previous options in place; without it, a font that fails to load is committed and measured as the host resolves it
- `subscribe(listener: () => void): () => void` — Call `listener` whenever the book changes its live layouts: after an `updateOptions` takes effect and after newly loaded fonts re-measure them. Read what changed from the layouts. Returns the function that removes the listener. A listener that throws does not stop the others; its error is rethrown on a microtask
- `setPageSize(size: PageSize): void` — Set the page geometry without measuring anything. Throws `RangeError` when `pageWidth` or `lineWidth` is absent or not a positive finite number, a padding is negative or not finite, or `paddingX` is not below half of `pageWidth`; the previous size is kept
- `fitPageSize(container: HTMLElement, options?: FitPageSizeOptions): PageGeometry` — Measure `container`, save the result as this book's page size, and return it. Uses a 1.45 aspect ratio with min 280×400, max height 780, and overridable header/gutter reservations. Padding not passed in `options` follows the `--mejiro-page-pad-*` custom properties the container inherits from the reader stylesheet, so the layout matches the drawn page inset; without them it is `DEFAULT_PAGE_PADDING`. Throws `RangeError` when the container measures zero wide or high (not attached, or `display: none`); nothing is saved
- `layoutChapter(chapter: ChapterSource): Promise<ChapterLayout>` — Lay out a chapter (an `EpubChapter` is one). Rejects with `MejiroError` `page-size-unset` when no page size has been given, and `font-unavailable` / `font-load-failed` as `updateOptions` describes
- `layoutManuscript(options: LayoutManuscriptOptions): Promise<ChapterLayout[]>` — Lay out manuscript chapters directly, skipping the EPUB ZIP round-trip. Returns one layout per chapter, at the chapter's index in `options.chapters`. Each body is split into paragraphs on blank lines, the same way EPUB export splits it, and parsed with `parseManuscript()`. U+3000 indents and U+3000-only scene dividers are kept, and blocks that are inline-image markers are skipped, so paragraph indices match the exported EPUB
- `layoutFromSnapshot(snapshot: ChapterLayoutSnapshot): ChapterLayout` — Restore a layout snapshot without measuring again. The restored layout keeps the snapshot's config and page geometry, and its advances are taken to be measured in this book's font family, which the snapshot does not record. The next `updateOptions` re-measures it when the snapshot's font size or heading scales differ from the book's. Reads the current format and the previous one (version 2). Throws `MejiroError` `snapshot-invalid` on a non-object, an unknown format version or a malformed snapshot: an advance array whose length is not the paragraph's codepoint count, break points that are not strictly increasing inside the paragraph, an annotation span outside it, a missing or non-finite field, text that is not NFC-normalized, a `headingLevel` outside the integers 1 to 6, an unknown `kind`, or malformed `headingStyles` (`scale`, `gapAfterEm`), `breakCost` or `analyzer` in the config. A later font load re-measures the layout but keeps the snapshot's config
- `clearCache(fontSpec?: string): void` — Clear the character width cache, for one CSS font specification or entirely
- `cacheStats(): WidthCacheStats` — Current measurement cache size, for capacity monitoring across long reader sessions
- `dispose(): void` — Release the book's `document.fonts` subscription so the book, its width cache and its layouts can be collected once the host drops them. The book stays usable and subscribes again on its next layout or font change, re-measuring its widths once on that reuse. Idempotent; `useMejiroBook` calls it on unmount

**`LayoutManuscriptOptions`** — `chapters: readonly ManuscriptChapter[]` / `dialect?: ManuscriptDialect` (default `'mejiro'`).

### ChapterLayout

**`ChapterLayout`** — Manages pagination and image exclusion for a laid-out chapter. Exported as a type only: layouts come from `MejiroBook.layoutChapter()`, `layoutManuscript()` and `layoutFromSnapshot()`.

- `pageCount: number` — Page count (getter, triggers lazy computation)
- `hasImages: boolean` — Whether any spread has image exclusions
- `geometry: PageGeometry` — The page geometry the layout breaks and paginates for: the size it was last laid out or resized to (getter)
- `typography: ChapterTypography` — The font family, font size and line spacing the layout was last measured with (getter). `MejiroSpread`, `MejiroScrollView` and `MejiroPageView` default to it and to `geometry`
- `resize(size: Partial<PageGeometry> & Pick<BookOptionsPatch, 'lineSpacing'>): void` — Update geometry; re-breaks lines if `lineWidth` changes. A `PageGeometry` from `fitPageSize()` can be passed as it is. Applied as a unit: a size that fails the `setPageSize` checks throws `RangeError` and leaves the layout untouched
- `setImages(spreadIndex: number, images: readonly BookImage[]): SpreadResult` — Set the image exclusions of a spread, reflow from it, and return that spread. An empty array removes the spread's images. Each call reflows; restoring several spreads at once is what `layoutFromSnapshot()` does
- `clearImages(spreadIndex?: number): void` — Remove the image exclusions of one spread, or of every spread
- `getSpread(spreadIndex: number): SpreadResult` — Get layout data for a two-page spread
- `getPage(pageIndex: number): PageResult` — Get layout data for a single page
- `findText(query: string | RegExp, options?: FindTextOptions): SearchMatch[]` — A string is matched literally after the NFC normalization the layout text takes, so a decomposed `か\u3099` finds `が`; an empty string returns no matches. A `RegExp` is matched with its own flags; its `g` and `y` flags are ignored and its `lastIndex` is neither read nor written. `caseSensitive` applies to a string query only. `maxResults` caps the hits and must be at least `1` (`RangeError` otherwise). A `RegExp` goes through a safety guard that throws `MejiroError` `regex-unsafe` on catastrophic-backtracking shapes and on oversized patterns or text. **Scope is the current `ChapterLayout` only.** For cross-chapter or cross-book search (e.g. a novel-site search index), keep an external full-text index server-side (Meilisearch / Elasticsearch / pg_trgm / SQLite FTS5) and hand the resolved anchors to `MejiroReaderHandle.goToAnchor()` to navigate to the hit
- `locateAnchor(anchor: InChapterAnchor): AnchorLocation | null` — Resolve an anchor to the spread / page / line containing it; `null` when out of range
- `anchorAt(spreadIndex: number, options?: AnchorAtOptions): InChapterAnchor | null` — Anchor of the first character of a spread page (`options.side`, default `'right'`), for converting a spread index into a reflow-stable position
- `endAnchor(): InChapterAnchor | null` — Anchor just past the chapter's last character, counted in the NFC code points the layout works from; `null` for a chapter with no paragraphs
- `coordOfAnchor(anchor: InChapterAnchor): AnchorRect | null` — Convert a reading anchor to spread/page coordinates
- `anchorAtCoord(spreadIndex: number, point: SpreadPoint): InChapterAnchor | null` — Convert a spread-local point back to an anchor
- `selectionRects(range: AnchorRange): AnchorRect[]` — Build highlight rectangles for a text range
- `snapshot(): ChapterLayoutSnapshot` — Serialize layout data for SSR/build caches

### Reading Time

| Export | Signature |
|---|---|
| `estimateReadingTime` | `(chapter: ChapterSource, options?: ReadingTimeOptions) => number` |
| `formatReadingTime` | `(ms: number, options?: FormatReadingTimeOptions) => string` |

`estimateReadingTime` returns milliseconds. `ReadingTimeOptions` takes `charsPerMinute?: number` (default `600`) and `includeHeadings?: boolean`. `formatReadingTime` renders the duration with the reading-time templates of `FormatReadingTimeOptions.messages` (default `jaMessages`).

### Types

**`BookOptions`** — Configuration for `MejiroBook`. The typography keys in `BookOptionsPatch` can change later through `updateOptions()`; the rest are read once, at construction:

- `fontFamily: FontFamily` — CSS-ready string or array of family names
- `fontSize: number` — Base font size (px)
- `lineSpacing?: number` — Line spacing multiplier (default: `DEFAULT_LINE_SPACING`, 1.8)
- `kinsoku?: KinsokuMode` — Kinsoku mode (default: `'strict'`)
- `enableHanging?: boolean` — Hanging punctuation (default: `true`)
- `headingStyles?: Record<number, HeadingStyle>` — Per-level heading overrides; a level left out keeps its `DEFAULT_HEADING_STYLES` style, scaled by `headingScale`
- `headingScale?: number` — Heading scale (default: 1.4). Levels 1–6 scale their default size in proportion to it unless `headingStyles` sets the level's `scale`; a heading without a level takes it as is
- `analyzer?: TextAnalyzer` — Morphological analyzer used to derive line breaking hints. Consulted only when `wordAwareBreaking` asks for hints, and once per paragraph at layout time; a re-break (resize, font change, exclusion reflow) replays what the first pass produced. Construction-time
- `wordAwareBreaking?: 'off' | 'clusters' | 'full'` — How far the analyzer's findings reach into line breaking (default: `'off'`). `'clusters'` keeps break positions as the character-class rules would choose them, except where a break would have split a unit it is a typesetting error to split; `'full'` adds per-position penalties, which do move break positions. Construction-time
- `keepWholePos?: readonly string[]` — Parts of speech a break should avoid landing inside, forwarded to `deriveTypographyHints()` as `TypographyHintOptions.keepWholePos` (default: `DEFAULT_KEEP_WHOLE_POS`). Read only under `'full'`, the only stage that emits penalties. Construction-time
- `keepWholePenalty?: number` — Price of a break inside one of `keepWholePos`, forwarded to `deriveTypographyHints()` as `TypographyHintOptions.keepWholePenalty` (default: `4`). Construction-time
- `breakCost?: BreakCostOptions` — Weights for the penalty search. Forwarded to the line breaker, which ignores it unless break penalties are in play. Construction-time
- `strictFontCheck?: boolean` — Reject layout and font changes with `font-unavailable` when the font measures exactly like the host's default (default: `false`). Construction-time
- `pageSize?: PageSize` — Page geometry to lay out for, so no separate `setPageSize()` call is needed. Validated like `setPageSize`. Construction-time
- `onError?: (error: MejiroError) => void` — Receives the failures the book recovers from: an analyzer that throws while a chapter is laid out arrives as `analyzer-failed` with the analyzer's error as `cause`, and the paragraph is laid out on the character-class rules alone. Reported once per book; without it the failure goes to `console.warn`. Construction-time

**`BookOptionsPatch`** — The keys `updateOptions()` can change: `Partial<Pick<BookOptions, 'fontFamily' | 'fontSize' | 'lineSpacing' | 'kinsoku' | 'enableHanging' | 'headingStyles' | 'headingScale'>>`. A construction-time key in a patch is a type error.

**`ResolvedBookOptions`** — What `getOptions()` returns: the `BookOptions` typography and `wordAwareBreaking` with every default resolved, plus `headingStyles`, `analyzer`, `keepWholePos`, `keepWholePenalty` and `breakCost` as given.

**`PageSize`**:

- `pageWidth: number` — Page width (px)
- `lineWidth: number` — Line width / column height (px)
- `paddingX?: number` — Horizontal padding on each side (default: 0)
- `paddingY?: number` — Vertical padding at the top (default: 0)

**`PageGeometry`** — A `PageSize` with every padding resolved and the page's vertical extent, as `fitPageSize()` returns and `ChapterLayout.geometry` reports it. Pass it to `setPageSize()` or `ChapterLayout.resize()` as it is:

- `pageWidth: number` / `lineWidth: number`
- `paddingX: number` / `paddingY: number`
- `pageHeight: number` — Page height, padding included (px)
- `contentHeight: number` — Height of the content box: the page height less its vertical padding (px)

**`FitPageSizeOptions`** — Overrides for `fitPageSize()`: `paddingX?` / `paddingY?` / `paddingBottom?` (default: the drawn `--mejiro-page-pad-*` values, then `DEFAULT_PAGE_PADDING`), `aspect?` (1.45), `minWidth?` (280), `minHeight?` (400), `maxHeight?` (780), `headerOffset?` (56), `gutterOffset?` (48), `columns?: 1 | 2` (2; `1` derives the page width from the full container width for a single-page reader).

**`ChapterTypography`** — `fontFamily: FontFamily` / `fontSize: number` / `lineSpacing: number`, read from `ChapterLayout.typography`.

**`AnchorAtOptions`** — `side?: 'right' | 'left'` (default `'right'`, the first page in reading order), for `anchorAt()`.

**`SpreadPoint`** — `{ x: number; y: number }` in spread-local pixels relative to the right page's content top-left, as `AnchorRect` describes; `x` is negative on the left page.

**`BookImage`**:

- `x: number` / `y: number` — Position relative to right page top-left (px)
- `width: number` / `height: number` — Size (px)
- `margin?: number` — Inline margin (default: base fontSize)

**`SpreadResult`** (read-only):

- `right: PageResult` — Right page (first in vertical-rl reading order)
- `left: PageResult` — Left page
- `pageCount: number` — Page count of the layout

**`PageResult`** (read-only):

- `page: RenderPage` — Paragraph-structured data (for CSS `vertical-rl` rendering)
- `lines: readonly PageLine[]` — Flat line list (for slot-based absolute rendering)
- `slots: readonly ColumnSlot[]` — Per-line position and dimensions
- `hasImages: boolean` — Whether this page has image exclusions

**`PageLine`** (read-only):

- `segments: readonly RenderSegment[]` — Text and inline annotation segments
- `headingLevel?: HeadingLevel` — Heading level (undefined for body)
- `kind?: ParagraphKind` — The line's paragraph kind (`'heading'` for a heading without a kind of its own); slot-mode page components pass it to `paragraphClassName()`
- `fontSize: number` — Computed font size (px, accounts for heading scale)

**`HeadingStyle`** — `scale?: number` / `gapAfterEm?: number`, re-exported from `@libraz/mejiro/render`.

**`AnchorLocation`** — Where an anchor sits in the layout: `spreadIndex: number` / `pageIndex: number` / `lineIndex: number` / `side: 'right' | 'left'`.

**`AnchorRect`** — `spreadIndex: number` / `pageIndex: number` / `side: 'right' | 'left'` / `x: number` / `y: number` / `width: number` / `height: number`, in spread-local pixels relative to the right page's content top-left.

**`AnchorRange`** — `{ start: InChapterAnchor; end: InChapterAnchor }`, in either order.

**`FindTextOptions`** — `caseSensitive?: boolean` (string queries only, default `false`) / `maxResults?: number` (at least `1`).

**`SearchMatch`** — An `AnchorLocation` plus `paragraphIndex: number`, `startIndex: number` / `endIndex: number` (code point offsets, compatible with `InChapterAnchor.charIndex`) and `match: string`.

**`ReadingTimeOptions`** — `charsPerMinute?: number` / `includeHeadings?: boolean`. **`FormatReadingTimeOptions`** — `messages?: MejiroMessages`.

**`ChapterLayoutSnapshot`** — Serialized layout produced by `ChapterLayout.snapshot()` and consumed by `MejiroBook.layoutFromSnapshot()`: `version: 3`, `config`, `size`, `paragraphs`, `images?`. Its parts are exported so a host can store them:

- **`ChapterLayoutSnapshotConfig`** — Serializable subset of the layout config: `fontSize`, `lineSpacing`, `headingScale`, `kinsoku`, `enableHanging`, `headingStyles?`, `breakCost?`, `analyzer?`
- **`ParagraphSnapshot`** — Per-paragraph entry: `text`, `advances: readonly number[]`, `breakPoints: readonly number[]`, `inlineAnnotations`, `headingLevel?`, `kind?`, `layoutRubyAnnotations?`, `layoutTcyAnnotations?`, `hintClusterIds?`, `hintBreakPenalties?`
- **`LayoutRubySnapshot`** — `RubyAnnotation` with the typed arrays widened to plain `number[]` so the snapshot survives `JSON.stringify`
- **`SpreadImagesSnapshot`** — `{ spreadIndex: number; images: readonly BookImage[] }`, the image exclusions of one spread

---

## `@libraz/mejiro/image` — Image Helpers

| Export | Signature |
|---|---|
| `prepareImage` | `(file: Blob \| File, options?: PrepareImageOptions) => Promise<PrepareImageResult>` |

Decodes a browser image file, optionally downscales it, re-encodes it, and returns binary data plus dimensions for EPUB embedding. Browser-only: it uses `createImageBitmap`, `OffscreenCanvas` and `HTMLCanvasElement`. Rejects with `MejiroError` `environment-unsupported` when those APIs are missing, `image-decode-failed` (the platform's error as `cause`) when the file cannot be decoded, and `image-encode-failed` when the canvas cannot encode it; `RangeError` for a bound that is not a positive number. `MejiroError`, `MejiroErrorCode`, `MejiroWarning` and `MejiroWarningCode` are re-exported here; `MejiroError` is the one thing this subpath imports from the core.

**`PrepareImageOptions`** — All fields optional, so `prepareImage(file)` is safe:

- `maxBytes?: number` — Target size after re-encoding (default 2 MiB). When the encoded image still exceeds it, JPEG/WebP quality keeps dropping (down to `0.4`) before a warning is emitted
- `maxWidth?: number` / `maxHeight?: number` — Pixel bounds after downscale (default `2048` each)
- `convertTo?: 'auto' | 'webp' | 'jpeg' | 'png'` — Output format (default `'auto'`, which keeps JPEG / PNG / WebP sources, re-encodes GIF as `image/png` with animation flattened, and falls back to `image/jpeg` for anything else). The request is not a guarantee: a platform that cannot encode the requested format silently produces another one
- `quality?: number` — Initial JPEG/WebP quality (default `0.85`)
- `signal?: AbortSignal` — Cancels the work; the promise rejects with `signal.reason`, also when the signal is already aborted at the call

**`PrepareImageResult`**:

- `data: Uint8Array` — Re-encoded payload, ready to drop into an EPUB
- `mediaType: string` — MIME type of `data`, taken from the encoder's output rather than from the requested format
- `width: number` / `height: number` — Decoded pixel size after any downscale
- `warnings: readonly MejiroWarning[]` — `max-bytes-exceeded` when the image could not be brought under `maxBytes`; `data` is then the smallest encoding produced. Downscaling, quality drops and format fallbacks are not warnings: they show in `width`, `height` and `mediaType`

---

## `@libraz/mejiro/analysis` — Morphological Analysis

Supplies a `TextAnalyzer` for `deriveTypographyHints()` and `BookOptions.analyzer`. The subpath is always present, but the analyzer it builds is backed by `@libraz/suzume`, an **optional peer dependency**: install it only if you want analysis-driven line breaking.

```bash
npm install @libraz/suzume
```

Nothing else in the package imports it. Without it, layout runs on the character-class rules alone and every other subpath behaves exactly as before.

| Export | Signature |
|---|---|
| `createSuzumeAnalyzer` | `(options?: SuzumeAnalyzerOptions) => Promise<TextAnalyzer>` |

Creates an analyzer backed by the suzume WebAssembly tokenizer. The module and its dictionaries load here, once, because `TextAnalyzer.analyze()` is synchronous — every asynchronous step has to happen before the analyzer exists. The returned promise **rejects** with `MejiroError` `analyzer-unavailable` when `@libraz/suzume` is not installed or its module fails to load: calling this factory is an explicit request for that analyzer, so a caller that would rather fall back to character-class-only breaking catches the rejection and does so itself. Dispose the analyzer when you are done with it; an adopted `instance` is left alone, because its lifetime belongs to whoever created it.

**`SuzumeAnalyzerOptions`**:

- `instance?: SuzumeInstance` — Pre-created Suzume instance to adopt instead of creating one. Checked at creation: an object without a string `version` or an `analyzeWithNormalizedText` or `destroy` method throws `TypeError`
- `wasmPath?: string` — Override for the WebAssembly binary location, forwarded to the instance factory

| Export | Signature |
|---|---|
| `alignMorphemeOffsets` | `(text: string, normalizedText: string, morphemes: readonly MorphemeLike[]) => Pick<TextAnalysis, 'morphemes' \| 'warnings'> \| null` |

Maps morpheme offsets from an analyzer's normalized text back onto the text the layout engine will break. An analyzer indexes its output against the text its own normalizer produced, and that normalizer can only shorten its input, so the mapping is either the identity — the fast path ordinary prose takes — or a single monotone walk. It succeeds completely or not at all: a partial mapping would move hints onto the wrong characters, so `null` comes back instead. Morphemes whose mapped span falls outside the text or fails to describe its own surface are dropped and reported in `warnings`. Use it when adapting an analyzer of your own to the `TextAnalyzer` interface.

**`SuzumeInstance`** — The part of a suzume instance the analyzer uses: `version: string`, `analyzeWithNormalizedText(text: string): SuzumeAnalysis`, `destroy(): void`. **`SuzumeAnalysis`** — `normalizedText: string` / `morphemes: readonly SuzumeMorpheme[]`. **`SuzumeMorpheme`** — `surface`, `pos`, `extendedPos`, and `start` / `end` as suzume reports them, indexed into `normalizedText`.

The analyzer reports `alignment-failed` and `morphemes-dropped` in `TextAnalysis.warnings`. `analyze()` after `dispose()` throws `MejiroError` `analyzer-disposed`; disposing is terminal, because it releases the WebAssembly instance.

This subpath also re-exports `AnalyzerIdentity`, `MorphemeLike`, `TextAnalysis`, `TextAnalyzer`, `MejiroError`, `MejiroErrorCode`, `MejiroWarning` and `MejiroWarningCode`, so an analyzer implementation does not have to reach into the core subpath for them.

```ts
import { MejiroBook } from '@libraz/mejiro/book';
import { createSuzumeAnalyzer } from '@libraz/mejiro/analysis';

const analyzer = await createSuzumeAnalyzer();
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  analyzer,
  wordAwareBreaking: 'clusters',
});
```

---

## `@libraz/mejiro-react` — React Component

```bash
npm install @libraz/mejiro @libraz/mejiro-react react
npm install -D @types/react
```

Peer dependencies: `react >= 18`; TypeScript projects should install `@types/react >= 18` matching their React version.

`MejiroError`, `MejiroErrorCode`, `MejiroWarning`, `MejiroWarningCode`, `MejiroStorage`, `ManuscriptChapter` and `ReadingAnchor` are re-exported from `@libraz/mejiro`, so a React-only host imports them from one place. Errors reach `onError` and the hooks' `error` as the `MejiroError` the core threw, not wrapped.

### Components

Every component exports a matching props type; `MejiroSettingsPanel` additionally exports the value types its form edits. The low-level components (`MejiroPage`, `MejiroPageView`, `MejiroSpread`, `MejiroScrollView`, `MejiroSelectionLayer`, …) forward a `ref` to their root element and accept the `div` attributes of `ComponentPropsWithoutRef<'div'>`.

| Component | Props type | Purpose |
|---|---|---|
| `MejiroReader` | `MejiroReaderProps` | Full reader: chrome, navigation, settings, persistence hooks |
| `MejiroEditor` | `MejiroEditorProps` | Block editor over an `EditableEpub`, with an `ExportPolicy` |
| `MejiroManuscriptEditor` | `MejiroManuscriptEditorProps` | Manuscript authoring surface with live preview |
| `MejiroNotationHighlighter` | `MejiroNotationHighlighterProps` | Textarea with notation-token tinting |
| `MejiroShelf` | `MejiroShelfProps` | Multi-volume shelf, pairs with `useLibrary` |
| `MejiroToc` | `MejiroTocProps` | Table of contents |
| `MejiroScrollView` | `MejiroScrollViewProps` | Continuous-scroll page stack |
| `MejiroSelectionLayer` | `MejiroSelectionLayerProps` | Selection / highlight overlay |
| `MejiroPageView` | `MejiroPageViewProps` | Single page from a `PageResult` |
| `MejiroPage` | `MejiroPageProps` | Single page from a `RenderPage` |
| `MejiroSpread` | `MejiroSpreadProps` | Two-page spread; running heads use `PageHeaderData` |
| `MejiroSettingsPanel` | `MejiroSettingsPanelProps` | Font / size / kinsoku form over `EditableSettings` and `FontChoice` |
| `MejiroChapterNav` | `MejiroChapterNavProps` | Chapter picker (`chapterIndex` + `onChapterIndexChange`); `MejiroChapterNavVariant` is `'select' \| 'panel'` |
| `MejiroStats` | `MejiroStatsProps` | Layout statistics line (`chapter`, `pageCount`, `elapsedMs`, `charsPerMinute?`, `locale?`) |
| `MejiroPageIndicator` | `MejiroPageIndicatorProps` | "current / total" position: zero-based `index` and `count`, displayed one-based |
| `MejiroDropZone` | `MejiroDropZoneProps` | EPUB drop target / file picker; `onReject(file, reason)` with `reason` `'type'` or `'validation'` |
| `MejiroImagePlaceholder` | `MejiroImagePlaceholderProps` | Draggable, resizable image placeholder (CSS class `mejiro-image-overlay`) |
| `MejiroI18nProvider` | `MejiroI18nProviderProps` | Scopes a message catalog (`locale?`, `messages?`) to its descendants |

`MejiroSpread` also exports `ReaderAnnotation` — `Pick<Annotation, 'chapterIndex' | 'start' | 'end' | 'color'>`, the shape the `annotations` prop takes — and `SelectionRect`, an `AnchorRect` with an optional `color`.

### Hooks

| Hook | Options / return types | Other exported types |
|---|---|---|
| `useEpub` | `UseEpubOptions` / `UseEpubReturn` | `FetchEpubOptions` |
| `useEditableEpub` | `UseEditableEpubOptions` / `UseEditableEpubReturn` | `EditableEpubSelection` |
| `useEpubProject` | `UseEpubProjectOptions` / `UseEpubProjectReturn` | — |
| `useLibrary` | `UseLibraryOptions` / `UseLibraryReturn` | `VolumeInfo` |
| `useManuscriptDraft` | `UseManuscriptDraftOptions` / `UseManuscriptDraftReturn` | — |
| `useManuscriptLayout` | `UseManuscriptLayoutOptions` / `UseManuscriptLayoutReturn` | `ChapterLayoutRecomputeOptions` |
| `useAnnotations` | `UseAnnotationsOptions` / `UseAnnotationsReturn` | `Annotation` |
| `useMejiroBook` | `UseMejiroBookOptions` / `UseMejiroBookReturn` | — |
| `useChapterLayout` | `UseChapterLayoutOptions` / `UseChapterLayoutReturn` | `ChapterLayoutRecomputeOptions` |
| `useSpread` | `UseSpreadOptions` / `UseSpreadReturn` | `ResolvedSpreadMode`, `GoToOptions` |
| `useReadingPosition` | `UseReadingPositionOptions` / `UseReadingPositionReturn` | — |
| `useI18n` | `UseI18nOptions` | `MejiroLocale`, `MejiroMessages`; `enMessages`, `jaMessages`, `resolveMessages`, `formatMessage` |
| `useImageOverlay` | `UseImageOverlayOptions` / `UseImageOverlayReturn` | `ImageOverlayRect`, `MultiImageItem` |

`resolveMessages` and `formatMessage` are the core functions of the same names. `VolumeInfo` is `{ id, label, author?, cover?, meta? }` and `MultiImageItem` is `{ id, rect }`. `ChapterLayoutRecomputeOptions` is `{ blank?: boolean }`, taken by the `recompute` of both layout hooks.

- `useEpub({ url?, onLoad?, onError?, fetchOptions?, fetchEpub?, limits? })` returns `epub`, `loading`, `error`, `loadBuffer`, `loadFile`, `loadUrl` and `setEpub`. `url` is followed: a new value loads that book. `fetchEpub(url, { signal })` receives a `FetchEpubOptions` whose `signal` aborts when a newer load starts or the component unmounts. `loadFile` rejects a file larger than `limits.maxInputBytes` by its `size`, before reading it. A non-2xx response is reported as `MejiroError` `fetch-failed`.
- `useEditableEpub({ url?, onLoad?, onError?, onExport?, fetchOptions?, fetchEpub?, limits?, assetResolver? })` returns `editor`, `epub`, `previewEpub`, `loading`, `exporting`, `error`, `revision`, `history`, `selection`, `selectedParagraph`, `setSelection`, `loadBuffer`, `loadFile`, `loadUrl`, `updateParagraph`, `setInlineAnnotations`, `addImage`, `undo`, `redo` and `exportEpub(options?)`. The hook subscribes to `editor`, so an edit made on it directly advances `revision` like the hook's own. `previewEpub` is `editableEpubToEpubBook(epub)`, rebuilt on every change. `selection` is `{ chapterIndex, blockId }`; `updateParagraph(patch)` and `setInlineAnnotations` act on the selected paragraph, and `addImage(input)` returns the stored `EditableImageBlock` (`null` before a load). `exportEpub` resolves to a `Uint8Array`; a failure is stored in `error`, passed to `onError` and rejects. `assetResolver` is applied to every `exportEpub` call whose options carry none of their own.
- `useEpubProject({ initialMetadata?, initialChapters?, initialCover?, initialAssets?, assetResolver?, debounceMs?, onPreview?, onExport?, onError?, defaultChapterTitle?, defaultChapterBody? })` returns `metadata`, `chapters`, `selectedChapterIndex`, `currentChapter`, `cover`, `assets`, `previewEpub`, `previewError`, `previewing`, `exporting`, `error`, plus `updateMetadata`, `setChapters`, `setSelectedChapterIndex`, `setCover`, `setAssets`, `addChapter`, `removeChapter(index)`, `updateChapter`, `reorderChapters`, `buildProject` and `exportEpub`. `currentChapter` is the selected chapter (or `null`); `setCover(null)` drops the cover, and both the debounced preview and `exportEpub` reflect cover/asset changes, including ones made earlier in the same tick. The preview resolves URL-only assets through `assetResolver` too, and aborts that work through the request `signal` when a newer edit supersedes it or the component unmounts. A `metadata.identifier` is generated once when none is given, so every preview and export of one project shares it. An export failure is stored in `error`, passed to `onError` and rejects.
- `useManuscriptDraft({ initialChapters?, onAutosave?, autosavePayload?, autosaveDeps?, autosaveDebounceMs?, defaultChapterTitle?, defaultChapterBody? })` returns `chapters`, `selectedChapterIndex`, `setSelectedChapterIndex`, `setChapters`, `updateChapter`, `addChapter`, `removeChapter(index)`, `reorderChapters`, `autosaveError` and `flushAutosave`. The draft starts with one empty chapter unless `initialChapters` is given. `autosaveDeps` lists extra values whose change schedules an autosave; asynchronous persistence belongs in `onAutosave`.
- `useChapterLayout(book, { epub, chapterIndex, surface, enableResize?, resizeDebounceMs?, pageGeometry?, capturePosition?, restorePosition?, onError? })` lays out the selected chapter and lays it out again when the surface resizes; a resize observation reporting the box the current layout was measured with does not re-flow, and a surface that measures zero is not laid out until it reports a size. Returns `{ layout, pageWidth, pageHeight, contentHeight, elapsedMs, error, recompute, pendingRestore }`. A re-layout replays the line-breaking hints the book already derived, so it never re-runs the analyzer. For the reading position across a re-flow, see [Keeping the reading position across a re-flow](./08-react-and-vue.md#keeping-the-reading-position-across-a-re-flow). A failed layout of the current request is stored in `error` and passed to `onError` once, whichever path started it (source change, resize or `recompute`); a superseded layout reports nothing. With `onError`, `recompute` resolves; without it, an awaited `recompute` rejects and the hook's own triggers drop the failure.
- `useManuscriptLayout(book, { chapter, surface, dialect?, enableResize?, resizeDebounceMs?, capturePosition?, restorePosition?, onError? })` lays out a single manuscript chapter directly, with no EPUB ZIP round-trip. Returns the same shape as `useChapterLayout` and reports failures the same way. Designed for live preview surfaces.
- `useMejiroBook(options, hookOptions?)` owns one `MejiroBook` and returns `{ book, options, updateOptions }`. `hookOptions` is `UseMejiroBookOptions`: `{ debounceMs?, onError? }`. A later change to a key `updateOptions` accepts — compared by value, so an object literal recreated every render is fine — is applied to the book; a change to a construction-time key (`strictFontCheck`, `analyzer`, `pageSize`, …) is ignored and the book is not recreated. Give the component a new `key` to start over with a new book. `updateOptions(patch)` updates the `options` snapshot synchronously; once the latest change settles, the snapshot resets to the options the book applied, so a rejected change rolls back. With `onError`, a failed application is reported there and `updateOptions` resolves instead of rejecting.
- `useSpread(layout, { spreadMode?, enableKeyboard?, turnDurationMs?, preservePosition?, onIndexChange? })` navigates a layout. `index` / `count` are the navigation position — pages under `spreadMode: 'single'`, spreads otherwise — and `spreadIndex` / `spreadCount` the layout spread on screen; `pageCount`, `spread`, `firstPage`, `singleSide` and `turning` describe the page shown. `goTo(index, { animate? })` clamps to `0 … count − 1`, throws `RangeError` for a non-integer, is a no-op without a layout, and during a turn replaces that turn's target. `preservePosition: true` opens a replacement layout at the text the old one showed. `indexOfPage(pageIndex)`, `anchorAt(index)`, `next`, `prev` and `refresh` complete the set.
- `useImageOverlay(layout, { spreadIndex, defaultWidth?, defaultHeight?, defaultX?, defaultY?, margin?, onReflow? })` manages draggable, resizable image overlays per spread and re-flows the text around them through `ChapterLayout.setImages`. Returns `imagesBySpread`, `currentImages`, `hasOverlays`, `addOverlay(overrides?)`, `removeOverlay(id)`, `updateOverlay(id, rect)`, `clearOverlays(spreadIndex?)`, `onOverlayPointerDown(id, event)` and `onResizePointerDown(id, event)`. `onReflow(spread)` is called with every spread re-flowed after a change; pair it with `useSpread().refresh()`.
- `useAnnotations({ key, storage?, debounceMs?, onAnnotationsChange?, onError? })` persists highlights / bookmarks / comments. Returns `{ annotations, add, remove, update, clear }`. `onAnnotationsChange(next)` fires synchronously after `add` / `remove` / `update` / `clear` (skipped on initial hydration and `key` changes, and on no-ops such as `clear()` on an empty list) — handy for forwarding each mutation to a server. `debounceMs` (default 250) delays the write until that long after the last change; a pending write is flushed on page hide, `key` change and unmount. A storage that throws is reported to `onError` as `storage-read-failed` / `storage-write-failed`, unreadable data as `storage-corrupt` (left in place until the first change); without `onError` the failure goes to `console.warn`.
- `useReadingPosition({ key, storage?, debounceMs?, onPositionChange?, onError? })` returns `{ position, save, clear }` and fires `onPositionChange(next | null)` right after `save` / `clear`. `debounceMs` and `onError` behave as in `useAnnotations`.
- `useLibrary({ volumes, initialVolumeId?, onVolumeChange? })` returns `{ list, volume, volumeIndex, next, prev, selectVolume(id) }`. It prefers `initialVolumeId` whenever the current `volumes` list contains it, including a list that arrives after mount, until `next` / `prev` / `selectVolume` is called. A list change that drops the current volume falls back to the first entry and calls `onVolumeChange` with it. `MejiroShelf` also works outside `MejiroReader`: `mejiro-reader.css` declares the default palette on a standalone `.mejiro-shelf`.

### MejiroReader types

- **`MejiroReaderProps`** — Discriminated union of the four source modes, so TypeScript rejects passing more than one source at once: `MejiroReaderParsedProps` (`epub: EpubBook | null`), `MejiroReaderUrlProps` (`epubUrl: string`), `MejiroReaderPickerProps` (no source; the reader exposes its drop zone / file picker), and `MejiroReaderManuscriptProps` (`manuscript: readonly ManuscriptChapter[]`, `dialect?: ManuscriptDialect`). Each variant extends **`MejiroReaderCommonProps`**, which carries everything else. A source given by the host (`epub` or `manuscript`) owns the book, so the reader then hides its drop zone and its Open button, even with `enableDropZone`.
- **`MejiroReaderCommonProps.options`** — `Partial<BookOptions>`, the book options; unset fields take `DEFAULT_BOOK_OPTIONS`. Construction-time keys (`strictFontCheck`, `analyzer`, `wordAwareBreaking`, `keepWholePos`, `keepWholePenalty`, `breakCost`, `pageSize`, `onError`) are read once, when the reader mounts.
- **Position props** — `chapterIndex` / `onChapterIndexChange`, `spreadIndex` / `onSpreadIndexChange` and `anchor` / `onAnchorChange`. A value prop alone is the starting position; passing its `on…Change` handler makes the reader controlled for that value. `spreadIndex` always counts layout spreads, also in single-page mode; see [React & Vue](./08-react-and-vue.md#reading-position-props).
- **`MejiroReaderHandle`** — Imperative handle from `ref`: `goToSpread`, `next`, `prev`, `goToChapter`, `getSpreadPosition(): SpreadPosition`, `goToAnchor(): Promise<void>`, `getAnchor()`, `getVisibleRange(): ReadingAnchorRange | null`, `updateOptions(): Promise<void>`, `subscribe()`.
- **`MejiroReaderEventMap`** — Listeners for `subscribe`: `spreadIndexChange(event: MejiroReaderSpreadIndexChangeEvent)` (`{ chapterIndex, spreadIndex }`), `turnStart(event: MejiroReaderTurnStartEvent)` (`{ from }`), `turnEnd(event: MejiroReaderTurnEndEvent)` (`{ to }`), `chapterFinished(event: MejiroReaderChapterFinishedEvent)` (`{ chapterIndex }`). An event name is the matching prop name without `on`.
- **`SpreadPosition`** — `{ chapterIndex, spreadIndex, spreadCount, pageCount }` returned by `getSpreadPosition()`.
- **`ReadingAnchorRange`** — `{ start: ReadingAnchor; end: ReadingAnchor }` returned by `getVisibleRange()`.
- **`MejiroReaderSettingsSlot`** — Context for the `renderSettings` render prop: `{ settings: EditableSettings; update; open; toggle }`.
- **`MejiroTheme`** — `MejiroThemeName` or `{ name, override }` to layer custom CSS variables on a preset. **`MejiroThemeName`** is `'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto'`.
- **`MejiroReaderMode`** — `'paginated' | 'scroll'`. **`MejiroSpreadMode`** — `'double' | 'single' | 'auto'`; the reader resolves `'auto'` and hands `useSpread` / `MejiroSpread` a `ResolvedSpreadMode` (`'single' | 'double'`). **`MejiroReaderFit`** — `'fill' | 'width'`. **`PageNumberDisplay`** — `'both' | 'right' | 'left' | 'none'`. **`MejiroChapterNavMode`** — `'select' | 'panel' | 'both' | 'none'`.

**`MejiroReader` presentation props** -- `theme?: MejiroTheme` (reflected as `data-mejiro-theme` on the reader root, which the bundled CSS reads to swap palettes), `mode?: MejiroReaderMode` (`'paginated'` default / `'scroll'` stacks every page in a vertical scroller), `spreadMode?: MejiroSpreadMode` (`'double'` default / `'single'` / `'auto'`), `fit?: MejiroReaderFit` (`'fill'` default / `'width'`), `pageNumbers?: PageNumberDisplay`, `locale?: MejiroLocale` and `messages?: Partial<MejiroMessages>` for UI strings, `title?` / `subtitle?` / `logo?` for the header, which is drawn only when there is a title or a logo, and `renderSettings?: (slot: MejiroReaderSettingsSlot) => ReactNode` to replace the settings panel body with a custom form. The chrome switches are `showSettings` (default `true`), `showPageIndicator` (default `true`), `showStats` (default `false`), `showImageOverlayButton` (default `false`), `chapterNavMode` (`'none'` hides the chapter navigation), `enableDropZone`, `enableKeyboard` (arrow keys and Escape on the focused reader root) and `enableSurfaceTap`.

**`MejiroReader` manuscript source** -- A fourth source mode alongside `epub` / `epubUrl`. Pass `manuscript: ManuscriptChapter[]` plus `dialect?: ManuscriptDialect` and the Reader renders the chapters directly, skipping the EPUB ZIP entirely.

**`MejiroReader` `annotations` prop** -- Pass an array of `ReaderAnnotation` (`{ chapterIndex, start, end, color? }`) and the Reader converts entries on the current chapter into highlight rectangles via `ChapterLayout.selectionRects`, forwarding them to `MejiroSpread`. Typically paired with `useAnnotations`, whose `Annotation` satisfies it.

**`MejiroScrollView`** -- The page stack behind `mode="scroll"`. It draws highlights and image overlays like `MejiroSpread`: `selectionRects` are painted on the page each entry's `pageIndex` addresses, and `images` (the overlays of the spread at `spreadIndex`) each render on the page containing their centre, with `onImagePointerDown`, `onImageResizePointerDown` and `onImageClose` for the handles. A new `images` array is also what makes the view re-read reflowed pages; `useImageOverlay`'s `currentImages` provides one on every change. `onVisiblePageChange(pageIndex, source)` reports the page in view. `pageNumbers?: PageNumberDisplay` (default `'both'`) chooses which pages print their number, by the same rule as `pageNumberFor`.

**`MejiroSpread`** -- Draws a `SpreadResult` as two pages, or one under `spreadMode: 'single'` (`singleSide` picks the page). Given `layout`, it takes the page size and typography from `layout.geometry` / `layout.typography`; explicit props win. `anchorAtCoord?: (point: SpreadPoint) => InChapterAnchor | null` resolves text selection.

**`MejiroNotationHighlighter`** -- Textarea wrapped with an overlay that tints notation tokens (ruby, emphasis, TCY, em, strong, link, footnote). Props: `{ value, onValueChange, dialect?, wrapperClassName?, wrapperStyle? }` plus textarea attributes, which reach the textarea (a native `onChange` included). Override per-token colors via CSS on `.mejiro-notation-token[data-token="…"]`.

**`MejiroPageView`** -- Recommended lower-level page renderer. Renders a `PageResult` from `ChapterLayout`. Automatically switches between CSS vertical-rl and slot-based rendering.

Props:

- `result: PageResult` -- Required
- `layout?: ChapterLayout` -- Source of the default `fontFamily` and `lineSpacing`
- `fontFamily?: string` -- CSS font family (for slot-based mode)
- `lineSpacing?: number` -- Line spacing multiplier (for slot-based mode)
- `slotMode?: boolean` -- Force slot-based rendering (set when the page has images)
- `className?: string`
- `style?: CSSProperties`

**`MejiroPage`** -- Low-level. Renders a `RenderPage` using CSS `writing-mode: vertical-rl`.

Props:

- `page: RenderPage` -- Required
- `className?: string`
- `style?: CSSProperties`

Paragraph classes come from the shared `paragraphClassName(kind, headingLevel)` helper, so `blockquote` / `sceneBreak` / `pre` / `figure` paragraphs get the same `mejiro-paragraph--*` modifiers the static renderer emits.

### MejiroManuscriptEditor types

- **`ManuscriptAutosaveDraft`** — Autosave payload: `{ title, author, cover: File | null, chapters }`.
- **`ManuscriptPreviewProps`** — The subset of `MejiroReader` props forwarded to the live preview through `previewProps`.
- `chapters` / `onChaptersChange`, `title` / `onTitleChange`, `author` / `onAuthorChange` and `cover` / `onCoverChange` follow the same rule as the reader's position props: the value is the starting value, and the handler makes it controlled.

### MejiroEditor types

- **`ExportPolicy`** — `{ download?, transform?, watermark? }`, applied in order: `watermark` (passed to `EditableEpub.export()`, so only the exported copy carries it) → `transform` (`(bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>`, replaces the bytes) → `download` (skips the browser download when `false`). `showExportButton` shows the export button. `previewProps` passes `ManuscriptPreviewProps` to the preview reader, whose title defaults to the book's.

---

## `@libraz/mejiro-vue` — Vue Component

```bash
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

Peer dependency: `vue >= 3.3`.

The Vue package exports the same names as the React package, with the same shapes; the differences are listed below. `MejiroError`, `MejiroErrorCode`, `MejiroWarning`, `MejiroWarningCode`, `MejiroStorage`, `ManuscriptChapter` and `ReadingAnchor` are re-exported from `@libraz/mejiro`, and `enMessages`, `jaMessages`, `resolveMessages` and `formatMessage` alongside `useI18n`.

### Components and prop types

Each component exports a props alias declared as `InstanceType<typeof Component>['$props']`, so it always tracks the component's own `props` block — including the `default` values, which is why every field appears optional even when the runtime default is `undefined`.

| Component | Props alias |
|---|---|
| `MejiroReader` | `MejiroReaderProps` |
| `MejiroEditor` | `MejiroEditorProps` |
| `MejiroManuscriptEditor` | `MejiroManuscriptEditorProps` |
| `MejiroNotationHighlighter` | `MejiroNotationHighlighterProps` |
| `MejiroShelf` | `MejiroShelfProps` |
| `MejiroToc` | `MejiroTocProps` |
| `MejiroScrollView` | `MejiroScrollViewProps` |
| `MejiroSelectionLayer` | `MejiroSelectionLayerProps` |
| `MejiroPageView` | `MejiroPageViewProps` |
| `MejiroPage` | `MejiroPageProps` |
| `MejiroSpread` | `MejiroSpreadProps` |
| `MejiroSettingsPanel` | `MejiroSettingsPanelProps` |
| `MejiroChapterNav` | `MejiroChapterNavProps` |
| `MejiroStats` | `MejiroStatsProps` |
| `MejiroPageIndicator` | `MejiroPageIndicatorProps` |
| `MejiroDropZone` | `MejiroDropZoneProps` |
| `MejiroImagePlaceholder` | `MejiroImagePlaceholderProps` |
| `MejiroI18nProvider` | `MejiroI18nProviderProps` |
| `MejiroManuscriptEditor` (preview passthrough) | `ManuscriptPreviewProps` |

Props and events correspond to React by one rule: a React `onXxxChange` is the Vue `update:xxx` event, so `v-model:xxx` binds it (`v-model:chapter-index`, `v-model:spread-index`, `v-model:anchor` on `MejiroReader`, `v-model:value` on `MejiroNotationHighlighter`, `v-model:settings` on `MejiroSettingsPanel`, `v-model:chapters` on `MejiroManuscriptEditor`); any other React `onXxx` is the kebab-case event `xxx` (`chapter-select`, `volume-select`, `chapter-finished`, `page-read`, `image-pointer-down`, …), emitted with a typed payload. A component is controlled for a value when the parent listens to its `update:xxx` event. React `className` / `style` are the fallthrough `class` / `style` attributes, React `xxxClassName` is Vue `xxxClass`, `children` is the default slot, and a React node prop is a named slot: `MejiroSpread` `renderPageHeader` / `indicator` are the `pageHeader` / `indicator` slots, and `MejiroReader` `renderSettings`, `logo` and `fallback` are the `settings`, `logo` and `fallback` slots (put `renderEpubStatic()` output in `fallback` with `v-html`).

The reader's source type names exist in Vue too — `MejiroReaderCommonProps`, `MejiroReaderParsedProps`, `MejiroReaderUrlProps`, `MejiroReaderPickerProps`, `MejiroReaderManuscriptProps` — but `MejiroReaderProps` is a single object type rather than a discriminated union, so the source props are not mutually exclusive at the type level: `epub` wins over `epubUrl`, and `manuscript` cannot be combined with either.

The Vue `MejiroShelf` is not generic: `defineComponent` cannot carry a type parameter into `h()` or `.ts` render functions, so `volumes` is typed `readonly VolumeInfo[]` and the `volume-select` payload is `VolumeInfo<unknown>`. Narrow `meta` in the handler where the React `MejiroShelf<T>` would infer it.

`ReaderAnnotation` and `SelectionRect` are exported as in React. `MejiroNotationHighlighter` passes its attributes to the textarea (`inheritAttrs: false`) and takes `wrapperClass` / `wrapperStyle` for the wrapper.

### Composables

The Vue composables take the same arguments and return the same keys as the React hooks, under the same option / return type names: `useEpub`, `useEditableEpub`, `useEpubProject`, `useLibrary`, `useManuscriptDraft`, `useManuscriptLayout`, `useAnnotations`, `useMejiroBook`, `useChapterLayout`, `useSpread`, `useReadingPosition`, `useI18n` and `useImageOverlay`, with `UseEpubOptions` / `UseEpubReturn`, `FetchEpubOptions`, `UseEditableEpubOptions` / `UseEditableEpubReturn`, `EditableEpubSelection`, `UseEpubProjectOptions` / `UseEpubProjectReturn`, `UseLibraryOptions` / `UseLibraryReturn`, `VolumeInfo`, `UseManuscriptDraftOptions` / `UseManuscriptDraftReturn`, `UseManuscriptLayoutOptions` / `UseManuscriptLayoutReturn`, `ChapterLayoutRecomputeOptions`, `UseAnnotationsOptions` / `UseAnnotationsReturn`, `Annotation`, `UseMejiroBookOptions` / `UseMejiroBookReturn`, `UseChapterLayoutOptions` / `UseChapterLayoutReturn`, `UseSpreadOptions` / `UseSpreadReturn`, `ResolvedSpreadMode`, `GoToOptions`, `UseReadingPositionOptions` / `UseReadingPositionReturn`, `UseI18nOptions`, `MejiroLocale`, `MejiroMessages`, `UseImageOverlayOptions` / `UseImageOverlayReturn`, `ImageOverlayRect` and `MultiImageItem`.

Reactive inputs take `MaybeRefOrGetter<T>` — a plain value, a `Ref` or a getter — and are read with `toValue()`, so a change is followed. State a composable manages is returned as a readonly `Ref` / `ComputedRef`; `pendingRestore` is a writable `Ref<InChapterAnchor | null>`. `useMejiroBook(options, hookOptions?)` takes `MaybeRefOrGetter<BookOptions>` and applies changes to its runtime keys through `updateOptions`, ignoring construction-time keys as in React. `useLibrary` re-resolves the current volume on an in-place mutation of a reactive `volumes` array as well as on reassignment.

`MejiroBook`, `ChapterLayout`, `EditableEpub` and `EpubProject` keep internal state keyed on the raw instance. The Vue binding accepts them inside reactive state — a `reactive()` object, a deep `ref()`, a component prop — and unwraps them before calling the core, and the instances its composables create (`useMejiroBook`'s book, the layouts of `useChapterLayout` / `useManuscriptLayout`, `useEditableEpub`'s editor, `useEpubProject`'s `buildProject()` result) are `markRaw`ed. A host that calls a core API directly with an instance it holds in reactive state — a method on it, or a function taking it — goes through `toRaw(instance)`.

### `MejiroReader`

The props are the React `MejiroReaderCommonProps` and source props, declared as Vue props: `theme`, `mode`, `spreadMode`, `fit`, `pageNumbers`, `chapterNavMode`, `locale`, `messages`, `title`, `subtitle`, `showSettings`, `showPageIndicator`, `showStats`, `showImageOverlayButton`, `enableDropZone`, `enableKeyboard`, `enableSurfaceTap`, `fetchOptions`, `fetchEpub`, `limits`, `annotations`, `options`, `pageGeometry`, `fonts`, and the position props `chapterIndex`, `spreadIndex` and `anchor` with their `v-model` events. Non-finite position values read as `0` and fractions are truncated, silently, as in React.

Slots: `settings` (receives the `MejiroReaderSettingsSlot` context), `header`, `logo`, `dropZone`, `fallback` and `loading`.

Events: `load`, `error`, `update:chapterIndex`, `update:spreadIndex`, `update:anchor`, `page-read` and `chapter-finished`. `MejiroReaderEventMap` describes the payloads of the imperative `MejiroReaderHandle.subscribe()`, with the event types `MejiroReaderSpreadIndexChangeEvent`, `MejiroReaderTurnStartEvent`, `MejiroReaderTurnEndEvent` and `MejiroReaderChapterFinishedEvent`. `MejiroReaderHandle` exposes the same methods as in React (`goToSpread`, `next`, `prev`, `goToChapter`, `getSpreadPosition(): SpreadPosition`, `goToAnchor`, `getAnchor`, `getVisibleRange(): ReadingAnchorRange | null`, `updateOptions`, `subscribe`). The theme, mode and chapter-navigation types are the same: `MejiroTheme`, `MejiroThemeName`, `MejiroReaderMode`, `MejiroSpreadMode`, `MejiroReaderFit`, `PageNumberDisplay`, `MejiroChapterNavMode`, `MejiroReaderSettingsSlot`.

The Vue `MejiroScrollView` takes the same `selectionRects`, `spreadIndex` and `images` props as React, and emits `update:visiblePage`, `image-pointer-down`, `image-resize-pointer-down` and `image-close` where React takes callback props.

### `MejiroManuscriptEditor` and `MejiroEditor`

`ManuscriptAutosaveDraft`, `ManuscriptPreviewProps` and `ExportPolicy` have the same shapes as in the React package. `MejiroManuscriptEditor` binds `v-model:title`, `v-model:author`, `v-model:cover` and `v-model:chapters`.

### Supporting types

The Vue barrel exports these alongside the components, with the same shapes as their React counterparts, so a Vue-only host never has to import from the React package:

- `MejiroChapterNavVariant` — `'select' | 'panel'`, the layout `MejiroChapterNav` renders in
- `EditableSettings` and `FontChoice` — the value and option types `MejiroSettingsPanel` edits
- `PageHeaderData` — `{ title?, pageNumber? }` for the running heads `MejiroSpread` draws
- `SpreadPosition` — `{ chapterIndex, spreadIndex, spreadCount, pageCount }` from `MejiroReaderHandle.getSpreadPosition()`
- `ImageOverlayRect` — the core overlay rectangle, re-exported so `useImageOverlay` callers get it from one place

**`MejiroPageView`** -- Recommended lower-level page renderer. Renders a `PageResult` from `ChapterLayout`. Automatically switches between CSS vertical-rl and slot-based rendering.

Props:

- `result: PageResult` -- Required
- `layout?: ChapterLayout` -- Source of the default `fontFamily` and `lineSpacing`
- `fontFamily?: string` -- CSS font family (for slot-based mode)
- `lineSpacing?: number` -- Line spacing multiplier (for slot-based mode)
- `slotMode?: boolean` -- Force slot-based rendering (set when the page has images)

**`useImageOverlay(layout, options)`** -- Composable for draggable, resizable image overlays with automatic text reflow. `layout` is a `MaybeRefOrGetter<ChapterLayout | null>` and `options.spreadIndex` a `MaybeRefOrGetter<number>`; the other options are read once. Returns the same keys as the React hook, with `imagesBySpread`, `currentImages` and `hasOverlays` as refs.

**`MejiroPage`** -- Low-level. Renders a `RenderPage` using CSS `writing-mode: vertical-rl`.

Props:

- `page: RenderPage` -- Required

Paragraph classes come from the same shared `paragraphClassName(kind, headingLevel)` helper the React component uses, so `blockquote` / `sceneBreak` / `pre` / `figure` paragraphs get identical `mejiro-paragraph--*` modifiers in both frameworks and in `renderEpubStatic` output.

---

[Back to documentation index](./README.md)
