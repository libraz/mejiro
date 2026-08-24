# API Reference

> **Note:** This document covers every export of the `@libraz/mejiro` subpaths, plus the components, hooks and composables of the framework packages. Individual component props are summarized rather than listed exhaustively — see [React & Vue](./08-react-and-vue.md) for the prop tables and the bundled TypeScript definitions for exact parameter types and defaults.

---

## `@libraz/mejiro` — Core

### Line Breaking

| Export | Signature |
|---|---|
| `computeBreaks` | `(input: LayoutInput) => BreakResult` |

Computes line break positions. Greedy O(n) algorithm with kinsoku backtracking and optional hanging punctuation.

| Export | Signature |
|---|---|
| `canBreakAt` | `(text: Uint32Array, pos: number, clusterIds?: Uint32Array, mode?: KinsokuMode, rules?: KinsokuRules) => boolean` |

Tests whether a line break is allowed after the given position.

| Export | Signature |
|---|---|
| `toCodepoints` | `(str: string) => Uint32Array` |

Converts a string to a `Uint32Array` of Unicode codepoints for use with `computeBreaks()`.

### Kinsoku (Line Break Prohibition)

| Export | Signature |
|---|---|
| `isLineStartProhibited` | `(cp: number, mode?: KinsokuMode, rules?: KinsokuRules) => boolean` |

Tests if a codepoint is prohibited at the start of a line. Uses custom rules when provided; otherwise uses built-in rules with mode.

| Export | Signature |
|---|---|
| `isLineEndProhibited` | `(cp: number, rules?: KinsokuRules) => boolean` |

Tests if a codepoint is prohibited at the end of a line.

| Export | Signature |
|---|---|
| `getDefaultKinsokuRules` | `() => KinsokuRules` |

Returns a copy of the default strict kinsoku rule set with pre-computed lookup sets.

| Export | Signature |
|---|---|
| `buildKinsokuRules` | `(raw: { lineStartProhibited: number[]; lineEndProhibited: number[]; unbreakablePairs?: Array<readonly [number, number]> }) => KinsokuRules` |
| `isUnbreakablePair` | `(left: number, right: number, rules?: KinsokuRules) => boolean` |

`buildKinsokuRules` creates a `KinsokuRules` object from raw codepoint arrays with pre-computed lookup sets. `isUnbreakablePair` tests whether a break between two adjacent codepoints is forbidden by the pair rules (`‥‥`, `……`, `——`, `――` by default).

### Hanging Punctuation

| Export | Signature |
|---|---|
| `isHangingTarget` | `(cp: number) => boolean` |

Tests if a codepoint is eligible for hanging (U+3002, U+3001, U+FF0C, U+FF0E).

| Export | Signature |
|---|---|
| `computeHangingAdjustment` | `(cp: number, advance: number) => number` |

Computes the hanging protrusion amount. Returns the advance if the character is a hanging target, 0 otherwise.

### Ruby (Furigana) Preprocessing

| Export | Signature |
|---|---|
| `preprocessRuby` | `(text: Uint32Array, advances: Float32Array, annotations: RubyAnnotation[], clusterIds?: Uint32Array) => RubyPreprocessResult` |

Distributes ruby text widths across base characters and generates cluster IDs. An annotated span reserves the larger of its base width and its ruby width; ruby is never charged to a neighbouring character's advance.

| Export | Signature |
|---|---|
| `isKana` | `(cp: number) => boolean` |

Tests if a codepoint is hiragana (U+3040--U+309F) or katakana (U+30A0--U+30FF).

### Tate-chu-yoko Preprocessing

| Export | Signature |
|---|---|
| `buildTcyAnnotations` | `(annotations: readonly InlineAnnotation[] \| undefined, em: number) => TcyAnnotation[] \| undefined` |
| `preprocessTcy` | `(text: Uint32Array, advances: Float32Array, annotations: readonly TcyAnnotation[], existingClusterIds?: Uint32Array) => TcyPreprocessResult` |

`buildTcyAnnotations` picks the `tcy` entries out of a mixed inline-annotation list and charges each one a single em, which is what `text-combine-upright: all` renders. `preprocessTcy` then collapses each span to that width and gives it a cluster ID of its own, so the line breaker cannot split it across a column boundary. The em is distributed over the span's characters in proportion to their measured advances, keeping anchor rectangles and hit tests monotonic inside the span.

Tate-chu-yoko is preprocessed *before* ruby, so a ruby span covering a combined box distributes its excess over the collapsed width rather than over the measured widths the box has already replaced. Unlike ruby, a malformed span is skipped rather than rejected — empty, reversed, out of range, non-integral, carrying a non-finite advance, or overlapping a span already applied (earlier start wins, then the longer one). These spans come from arbitrary EPUB markup, and one broken span must not stop a chapter from being laid out.

### Cluster Support

| Export | Signature |
|---|---|
| `resolveClusterBoundaries` | `(text: Uint32Array, clusterIds?: Uint32Array) => Uint8Array` |

Returns a bitmask where 1 means a break is prohibited after that position.

| Export | Signature |
|---|---|
| `isClusterBreakAllowed` | `(clusterIds: Uint32Array | undefined, pos: number, textLength: number) => boolean` |

Tests if a break is allowed at the given position respecting cluster boundaries.

### Pagination

| Export | Signature |
|---|---|
| `paginate` | `(pageBlockSize: number, paragraphs: ParagraphMeasure[]) => PageSlice[][]` |

Distributes paragraph lines across fixed-size pages, splitting at page boundaries. Always returns at least one page, even for empty input.

| Export | Signature |
|---|---|
| `getLineRanges` | `(breakPoints: Uint32Array, charCount: number) => [number, number][]` |

Converts break points into `[start, end)` character index pairs per line.

### Token Boundaries

| Export | Signature |
|---|---|
| `tokenLengthsToBoundaries` | `(tokenLengths: number[]) => Uint32Array` |

Converts morphological analyzer token lengths to boundary indices for `LayoutInput.tokenBoundaries`.

### Typography Hints

| Export | Signature |
|---|---|
| `deriveTypographyHints` | `(text: string, analysis: TextAnalysis, options?: TypographyHintOptions) => TypographyHints` |

Turns one paragraph's morphological analysis into line breaking hints. `clusterIds` is emitted by default and everything else is opt-in, so the default output only removes break opportunities that splitting an indivisible unit would have used. A rule fires only when the character class of a morpheme's surface confirms it, which keeps the output stable across dictionary versions and across analyzers. An analysis whose `text` is not the paragraph it is applied to yields no hints at all rather than an error. Fields whose rules never fired are omitted, so a caller keeps its "no hints, no preprocessing" fast path. See [Line breaking](./03-line-breaking.md) for the rules and the two opt-in stages.

| Export | Signature |
|---|---|
| `mergeClusterIds` | `(length: number, a?: Uint32Array, b?: Uint32Array) => Uint32Array \| undefined` |

Combines two cluster ID arrays over the same text into their transitive closure, which is what lets typography hints ride alongside ruby or tate-chu-yoko clustering without either side knowing about the other. Returns a fresh array, never one of the inputs. An input whose length does not match `length` describes different text and is ignored rather than rejected: dropping a hint costs a suboptimal break, throwing costs the whole paragraph.

### Text Helpers

| Export | Signature |
|---|---|
| `formatDialogueLineBreaks` | `(text: string) => string` |
| `tokenizeManuscriptSource` | `(text: string, dialect?: ManuscriptDialect) => ManuscriptToken[]` |

`formatDialogueLineBreaks` normalizes manuscript line breaks around Japanese dialogue quotes without creating extra blank lines.

`tokenizeManuscriptSource` reports notation token ranges (ruby, emphasis, TCY, em, strong, link, footnote) in **source positions**, unlike `parseManuscript` whose annotation positions are in the rendered plain text. Powers the bundled `MejiroNotationHighlighter`.

### Image Exclusion

**`ExclusionEngine`** — Manages image exclusion zones for text layout:

- `constructor(geometry: ExclusionPageGeometry)`
- `setGeometry(geometry: ExclusionPageGeometry): void` — Update page geometry
- `getGeometry(): Readonly<ExclusionPageGeometry>` — Get current geometry
- `addImage(rect: ImageRect): this` — Add an image (chainable)
- `removeImage(rect: ImageRect): boolean` — Remove by reference
- `clearImages(): void` — Remove all images
- `getImages(): readonly ImageRect[]` — Get current images
- `imageCount: number` — Number of images (getter)
- `compute(): { slots: ColumnSlot[]; lineWidths: Float32Array }` — Compute per-column slots and line widths

**`SpreadExclusionEngine`** — Manages image exclusion across a two-page spread:

- `constructor(geometry: SpreadGeometry)`
- `setGeometry(geometry: SpreadGeometry): void` — Update spread geometry
- `getGeometry(): Readonly<SpreadGeometry>` — Get current geometry
- `addImage(rect: ImageRect): this` — Add image (position relative to right page's top-left; negative `x` = left page)
- `removeImage(rect: ImageRect): boolean` — Remove by reference
- `clearImages(): void` — Remove all images
- `getImages(): readonly ImageRect[]` — Get current images
- `imageCount: number` — Number of images (getter)
- `compute(): SpreadExclusionResult` — Compute slots and lineWidths for both pages

Handles gutter (page padding) coordinate conversion automatically. Text flows continuously from right page to left page.

| Export | Signature |
|---|---|
| `computeExclusionSlots` | `(options: ExclusionPageGeometry & { images: readonly ImageRect[] }) => { slots: ColumnSlot[]; lineWidths: Float32Array }` |

Convenience function. Equivalent to creating an `ExclusionEngine`, adding all images, and calling `compute()`.

| Export | Signature |
|---|---|
| `computeLineWidths` | `(baseLineWidth: number, lineCount: number, exclusions: readonly ExclusionZone[]) => Float32Array` |

Low-level API. Computes per-line widths by subtracting exclusion zones from the base width.

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
| `serializeReadingPosition` | `(value: ReadingPositionValue) => string` |
| `parseReadingPosition` | `(raw: string \| null) => ReadingPositionValue \| null` |
| `serializeAnnotations` | `(annotations: readonly Annotation[]) => string` |
| `parseAnnotations` | `(raw: string \| null) => Annotation[]` |
| `sortAnnotations` | `(annotations: readonly Annotation[]) => Annotation[]` |
| `createAnnotationId` | `() => string` |

Versioned payload helpers shared by the framework persistence hooks. Both parsers also
accept a bare (unversioned) payload and reject malformed entries — `parseReadingPosition`
returns `null` unless `chapter` / `paragraph` / `charIndex` are non-negative safe integers,
and `parseAnnotations` drops entries that are not well-formed.

When forwarding state to a server through the `onChange` callback of `useReadingPosition` /
`useAnnotations`, send the string produced by `serializeReadingPosition` /
`serializeAnnotations` so the matching parser accepts it on the next visit.

### Internationalization

| Export | Signature |
|---|---|
| `enMessages` / `jaMessages` | `MejiroMessages` |
| `messageCatalogs` | `Record<MejiroLocale, MejiroMessages>` |
| `resolveMessages` | `(locale: MejiroLocale \| undefined, overrides: Partial<MejiroMessages> \| undefined, fallback?: MejiroMessages) => MejiroMessages` |
| `formatMessage` | `(template: string, vars: Record<string, string \| number>) => string` |

UI string catalogs for the bundled components. `resolveMessages` merges partial overrides
on top of a built-in catalog; `formatMessage` substitutes `{name}` placeholders. The
reader / editor components take the same values through their `locale` and `messages`
props, so a host rarely calls these directly.

### Text and URL Helpers

| Export | Signature |
|---|---|
| `normalizeText` | `(str: string) => string` |
| `sanitizeUrl` | `(raw: string) => string \| null` |

`normalizeText` applies the NFC normalization the layout pipeline expects. `sanitizeUrl`
returns `null` for URLs that must not become an `href`; the render layer uses it to degrade
unsafe links to plain text.

### Types

**`LayoutInput`** -- Input for `computeBreaks()`:

- `text: Uint32Array` -- Unicode codepoints
- `advances: Float32Array` -- Per-character advance widths (px)
- `lineWidth: number` -- Available line width (px)
- `lineWidths?: Float32Array` -- Per-line widths overriding `lineWidth`
- `mode?: KinsokuMode` -- `'strict'` (default) or `'loose'`
- `enableHanging?: boolean` -- Enable hanging punctuation (default: `true`)
- `clusterIds?: Uint32Array` -- Indivisible character groups
- `rubyAnnotations?: RubyAnnotation[]` -- Core-level ruby annotations used by the line breaker
- `tokenBoundaries?: Uint32Array | readonly number[]` -- Preferred break positions
- `breakPenalties?: Uint8Array` -- Cost of breaking *after* each index, one entry per code point. `0` is unpenalised, larger values are avoided more strongly. When present, the backward search picks the lowest-cost position within `breakCost.maxBacktrackChars` instead of the nearest valid one, and supersedes both `tokenBoundaries` and the whitespace preference
- `breakCost?: BreakCostOptions` -- Weights for the penalty search. Ignored unless `breakPenalties` is given
- `kinsokuRules?: KinsokuRules` -- Custom prohibition rules

**`BreakResult`** -- Output of `computeBreaks()`:

- `breakPoints: Uint32Array` -- Index of last character before each break
- `hangingAdjustments?: Float32Array` -- Hanging overhang per line (px)
- `effectiveAdvances?: Float32Array` -- Per-char advances after ruby distribution
- `lineWidths?: Float32Array` -- Actual width used per line (present when `lineWidths` input was provided)

**`BreakCostOptions`** -- Weights trading a penalised break position against the line it leaves behind. The cost of breaking after position `p` is `penaltyWeight * breakPenalties[p] + shortfallWeight * shortfall(p)`, where `shortfall(p)` is how far short of the line width the line ends, measured in em. Only the ratio of the two weights affects which position wins, so `{ penaltyWeight: 0.5, shortfallWeight: 1 }` and `{ penaltyWeight: 1, shortfallWeight: 2 }` break identically:

- `penaltyWeight?: number` -- Multiplier on the penalty value (default: `1`)
- `shortfallWeight?: number` -- Multiplier on the em-measured shortfall (default: `1.5`). Penalties run 0..3, so this caps the worst trade the search can make at `3 / shortfallWeight` em of empty line — 2 em at the default, which is what a character grid tolerates
- `maxBacktrackChars?: number` -- How many positions the cost search may walk back from the overflowing character; bounding it keeps line breaking linear (default: `6`). A position `k` steps further back gives up at least `0.5k` em, so it can win only while `k < 6 * penaltyWeight / shortfallWeight`, and a wider window costs search time without changing the outcome
- `emSize?: number` -- Pixel size of one em (default: the largest measured advance in the paragraph, which is one em for any text containing a full-width character)

**`KinsokuMode`** -- `'strict' | 'loose'`

**`KinsokuRules`** -- Custom prohibition rules:

- `lineStartProhibited: number[]` / `lineEndProhibited: number[]`
- `lineStartProhibitedSet: Set<number>` / `lineEndProhibitedSet: Set<number>`
- `unbreakablePairs: Array<readonly [number, number]>` / `unbreakablePairSet: Set<string>`

**`RubyAnnotation`** -- Core-level ruby annotation:

- `startIndex: number` / `endIndex: number` -- Range in base text
- `rubyText: Uint32Array` / `rubyAdvances: Float32Array`
- `type?: RubyType`
- `jukugoSplitPoints?: number[]`

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

**`TcyCandidate`** -- A run a renderer may set as tate-chu-yoko: `startIndex: number` (inclusive) / `endIndex: number` (exclusive).

**`MorphemeLike`** -- A morpheme as the layout engine consumes it, independent of which analyzer produced it. Offsets are code point indices into the same NFC text the layout engine is given:

- `surface: string` -- Surface form. Used to verify character classes, not to re-locate the span
- `start: number` / `end: number` -- Inclusive start and exclusive end, in code points
- `pos: string` -- Coarse part-of-speech code
- `extendedPos: string` -- Fine-grained part-of-speech code, the main input to the hint rules

**`AnalyzerIdentity`** -- `{ name: string; version: string }`. Identifies one analyzer for cache keys and snapshot validation; two identities equal field by field stand for analyzers whose findings are interchangeable.

**`TextAnalysis`** -- One paragraph's analysis, already aligned to the text: `text: string` (the exact NFC text the offsets address) / `morphemes: readonly MorphemeLike[]` (document order, non-overlapping) / `analyzer: AnalyzerIdentity` / `warnings: readonly string[]` (empty when clean).

**`TextAnalyzer`** -- Produces a `TextAnalysis` for a paragraph:

- `identity: AnalyzerIdentity` -- Who this analyzer is; equal to the `analyzer` of every analysis it returns, so hints of unknown provenance can be attributed without analysing anything
- `analyze(text: string): TextAnalysis` -- Analyses one paragraph of NFC text
- `dispose(): void` -- Releases any native resources held by the analyzer

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
- `w: number` / `h: number` — Size (px)
- `inlineMargin?: number` — Margin in the inline direction (top/bottom in vertical-rl), applied to both sides (px). Defaults to `0`
- `blockMargin?: number` — Margin in the block direction (left/right in vertical-rl), applied to both sides (px). Defaults to `0`

**`SpreadImageRect`** — Alias of `ImageRect` used by `SpreadExclusionEngine`, where `x` is measured from the right page's top-left corner and a negative `x` places the image on the left page.

**`ImageOverlayRect`** — UI overlay rectangle:

- `x: number` / `y: number` — Overlay position (px)
- `w: number` / `h: number` — Overlay size (px)

`ImageOverlayRect` is the only overlay-rectangle type in the package family; `@libraz/mejiro-react` and `@libraz/mejiro-vue` re-export it (their `ImageRect` is a deprecated alias of it). The layout-side `ImageRect` above is a different type — it carries margins.

**`ColumnSlot`** — Rendering slot for one laid-out line:

- `xPos: number` — Offset from right edge of content area (px)
- `yStart: number` — Vertical offset from content top (px)
- `height: number` — Available text height (px)
- `columnIndex?: number` — Physical column the slot belongs to (0 = nearest the right content edge). Several slots share a `columnIndex` when an image splits a column into multiple gaps. Every slot produced by this package carries it; it is optional only so hand-built slot arrays stay assignable

Slots come out in reading order, and a column may contribute several slots or none, so a slot's array index is a line index — not a column index. Use `columnIndex` to identify the physical column, not `xPos`.

**`ExclusionZone`** — Low-level exclusion zone:

- `blockStart: number` / `blockEnd: number` — Affected line range
- `inlineSize: number` — Space consumed (px)

**`SpreadGeometry`** — Two-page spread geometry:

- `pageWidth: number` — Width of each page (px)
- `pagePaddingX: number` — Horizontal padding per side (px)
- `pagePaddingY: number` — Vertical padding at top (px)
- `lineWidth: number` — Base line width (px)
- `linePitch: number` — Column pitch (px)

**`SpreadExclusionResult`** — Result of spread exclusion computation:

- `rightSlots: ColumnSlot[]` — Slots for right page
- `leftSlots: ColumnSlot[]` — Slots for left page
- `lineWidths: Float32Array` — Combined line widths (right + left) for `computeBreaks()`
- `rightSlotCount: number` — Number of slots for right page

**`MejiroStorage`** — Storage interface accepted by the persistence hooks:

- `getItem(key: string): string | null` / `setItem(key: string, value: string): void` / `removeItem(key: string): void`

**`ReadingPositionValue`** — Alias of `ReadingAnchor` (`{ chapter, paragraph, charIndex }`).

**`Annotation`** — Persisted user annotation:

- `id: string` / `chapter: number`
- `start: InChapterAnchor` / `end: InChapterAnchor`
- `color?: string` / `note?: string` / `createdAt?: number`

**`MejiroLocale`** — `'en' | 'ja'`. **`MejiroMessages`** — UI string catalog shape.

**`FontChoice`** — `{ value: string; label: string }` entry for settings-panel font pickers.

**`EditableSettings`** — `Pick<BookOptions, 'fontFamily' | 'fontSize' | 'lineSpacing' | 'mode' | 'enableHanging'>`, the subset the bundled settings panels edit.

**`PageHeaderData`** — `{ title?: string; pageNumber?: number | null }` for running headers.

**`ManuscriptToken` / `ManuscriptTokenKind`** — Source-position notation ranges returned by `tokenizeManuscriptSource()`.

---

## `@libraz/mejiro/browser` — Browser Integration

### High-Level API

**`MejiroBrowser`** -- Main class:

- `constructor(options?: MejiroBrowserOptions)`
- `layout(options: LayoutOptions): Promise<BreakResult>` -- Layout single paragraph
- `layoutChapter(options: ChapterLayoutOptions): Promise<ChapterLayoutResult>` -- Layout multiple paragraphs
- `preloadFont(fontFamily?: string, fontSize?: number): Promise<void>` -- Preload font
- `verticalLineWidth(containerHeight: number, fontSize?: number): number` -- Compute effective line width
- `clearCache(fontKey?: string): void` -- Clear width cache

| Export | Signature |
|---|---|
| `layoutText` | `(options: { text, fontFamily, fontSize, lineWidth, mode?, enableHanging?, inlineAnnotations?, tokenBoundaries? }) => Promise<BreakResult>` |

Standalone one-shot layout function. Creates a temporary `MejiroBrowser` instance, measures the text, and computes breaks in a single call.

| Export | Signature |
|---|---|
| `verticalLineWidth` | `(containerHeight: number, fontSize: number) => number` |

Compute effective line width for vertical text. Formula: `containerHeight - fontSize * 0.5`.

### Font and Measurement

- `FontLoader` -- Font loading via FontFace API
- `CharMeasurer` -- Character measurement via Canvas.measureText with codepoint caching
- `WidthCache` -- `Map<fontKey, Map<codepoint, width>>`
- `deriveRubyFont(fontFamily: string, fontSize: number): string` -- Ruby font spec (half-size)
- `normalizeFontFamily(fontFamily: FontFamily): string` -- Normalize a string or family-name array to a CSS font-family string
- `toFontSpec(fontFamily: string, fontSize: number): string` -- CSS font spec

### Overlay Drag Sessions

| Export | Signature |
|---|---|
| `createOverlayDragSession` | `(options: OverlayDragSessionOptions) => OverlayDragSession` |

Drives an image-overlay drag or resize from a pointer-down handler: it listens for `pointermove` / `pointerup` on the document, coalesces updates into an animation frame where the runtime provides one, and re-derives each rectangle from the pointer-down rectangle plus the cumulative delta, so rounding never accumulates during a gesture.

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
- `onChange: (rect: ImageOverlayRect) => void` — Receives a fresh rectangle per update
- `onEnd?: () => void` — Called exactly once when the gesture ends, however it ended
- `registry?: Set<() => void>` — Set the session registers its disposer in for the gesture's lifetime, so a host can end every in-flight gesture on unmount. The entry removes itself once the gesture ends

**`OverlayDragSession`** — Handle returned by `createOverlayDragSession()`:

- `active: boolean` — Whether the gesture is still running (readonly)
- `cancel(): void` — Ends the gesture and releases every listener; idempotent

### Types

**`FontFamily`** -- `string | readonly string[]`. A CSS-ready string (`'"Noto Serif JP", serif'`) or an array of family names, escaped and joined by `normalizeFontFamily()`. Every `fontFamily` option below takes this type.

**`MejiroBrowserOptions`**:

- `fixedFontFamily?: FontFamily`
- `fixedFontSize?: number`
- `strictFontCheck?: boolean`

**`LayoutOptions`**:

- `text: string`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `lineWidth: number`
- `mode?: KinsokuMode`
- `enableHanging?: boolean`
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`ChapterLayoutOptions`**:

- `paragraphs: readonly ParagraphInput[]`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `lineWidth: number`
- `mode?: KinsokuMode`
- `enableHanging?: boolean`

**`ChapterLayoutResult`**:

- `paragraphs: ParagraphLayoutResult[]`

**`ParagraphLayoutResult`**:

- `breakResult: BreakResult`
- `chars: string[]`

**`ParagraphInput`**:

- `text: string`
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`InlineAnnotation`** — Discriminated union of the seven inline annotation kinds. Every member carries `startIndex` (inclusive) and `endIndex` (exclusive) in NFC code point offsets, plus the fields below:

| Type | `kind` | Extra fields |
|---|---|---|
| `InlineRubyAnnotation` | `'ruby'` | `rubyText: string`, `type?: RubyType`, `jukugoSplitPoints?: number[]` |
| `InlineEmphasisAnnotation` | `'emphasis'` | `style?: 'sesame' \| 'dot' \| 'circle'` — emphasis-dot (傍点) mark |
| `InlineTcyAnnotation` | `'tcy'` | — tate-chu-yoko (縦中横): the span is drawn horizontally inside the vertical column, and reaches the line breaker as one indivisible 1 em cluster |
| `InlineEmAnnotation` | `'em'` | — italic emphasis, rendered as `<em>` |
| `InlineStrongAnnotation` | `'strong'` | — strong emphasis, rendered as `<strong>` |
| `InlineLinkAnnotation` | `'link'` | `href: string`, `title?: string` |
| `InlineFootnoteAnnotation` | `'footnote'` | `noteId: string` |

`RubyInputAnnotation` remains as a deprecated alias of `InlineRubyAnnotation`.

**`WidthCacheOptions`** — Bounds for `WidthCache`:

- `maxFonts?: number` — Maximum number of cached font keys
- `maxCodepointsPerFont?: number` — Maximum number of cached codepoints per font key

Both default to `Infinity`, which switches LRU bookkeeping off entirely rather than merely never evicting — setting a finite value changes the read path as well.

---

## `@libraz/mejiro/epub` — EPUB Parsing and Authoring

| Export | Signature |
|---|---|
| `parseEpub` | `(buffer: ArrayBuffer, options?: EpubParseOptions) => Promise<EpubBook>` |
| `parseEditableEpub` | `(buffer: ArrayBuffer, options?: EpubParseOptions) => Promise<EditableEpub>` |
| `DEFAULT_EPUB_PARSE_LIMITS` | Default resource limits applied to untrusted archives |
| `EditableEpub` | Class for block-level paragraph/image editing and export |
| `exportEditableEpub` | `(book: EditableEpub \| EditableEpubBook, options?: EpubExportOptions) => Promise<ArrayBuffer>` |
| `updateEpubParagraph` | Update a paragraph block in an editable EPUB book |
| `setEpubInlineAnnotations` | Replace inline annotations for a paragraph block |
| `addEpubChapterImage` | Insert an image block and asset into an editable chapter. Accepts v0.5 `{ filename, data, ... }` and deprecated v0.4 `{ href, mediaType, afterParagraph }` inputs. |
| `EpubProject` | Class for creating a new EPUB 3 package from manuscript chapters |
| `parseManuscript` | Parse manuscript text into paragraphs and inline annotations |
| `parseManuscriptRuby` | Parse Aozora-style ruby notation in one text fragment |
| `manuscriptToEpubBook` | `(chapters, options?) => EpubBook`. Synthesizes an `EpubBook` from manuscript chapters without a ZIP round-trip — designed for live preview. |

Parses an EPUB file into structured chapters with ruby annotations.

Both import paths need a DOM XML parser: `parseEpub()`, `parseEditableEpub()` and
`EditableEpub.load()` require global `DOMParser`, `XMLSerializer` and `Node`. Browsers
provide them; on Node install a DOM implementation and expose it on `globalThis` before
calling in.

`EpubParseOptions.limits` overrides the archive resource limits applied to untrusted
input (`DEFAULT_EPUB_PARSE_LIMITS`): `maxInputBytes` (100 MiB), `maxEntries` (10,000),
`maxEntryBytes` (50 MiB), `maxTotalBytes` (200 MiB) and `maxCompressionRatio` (1,000).

| Export | Signature |
|---|---|
| `extractRubyContent` | `(xhtml: string) => AnnotatedParagraph[]` |

Extracts paragraphs and ruby annotations from an XHTML document string.

| Export | Signature |
|---|---|
| `cloneEditableEpubBook` | `(book: EditableEpubBook) => EditableEpubBook` |
| `clampEditableEpubSelection` | `(book: EditableEpubBook \| null, selection: EditableEpubSelection) => EditableEpubSelection` |

`cloneEditableEpubBook` deep-copies an editable book so preview rendering and export-only transforms (watermarking, for instance) never reach the document the editor owns. `clampEditableEpubSelection` confines a `{ chapter, paragraph }` selection to the paragraphs a book actually has.

### EditableEpub

**`EditableEpub`** — Editing session over a parsed EPUB, with undo history. Constructed through `EditableEpub.load()` (the constructor is private).

- `static load(data: ArrayBuffer, options?: EpubParseOptions): Promise<EditableEpub>` — Parse an EPUB and start a session. Requires the host DOM globals
- `book: EditableEpubBook` — The live document model, including the package data needed to write the EPUB back out. Mutating it directly bypasses the undo history
- `title: string` / `author: string | undefined` — Package metadata (getters)
- `chapters: EditableEpubChapter[]` — Chapters in spine order (getter). The live array, not a copy; splicing it directly skips the undo history
- `transaction<T>(fn: () => T): T` — Group a sequence of edits into one history entry. Nested calls fold into the outermost transaction; a throw inside `fn` rewinds the buffered changes
- `undo(): boolean` / `redo(): boolean` — Revert or re-apply one committed change (or transaction). `false` when the corresponding stack is empty
- `history: { canUndo: boolean; canRedo: boolean; depth: number; redoDepth: number }` — Snapshot of the undo/redo state (getter)
- `updateParagraph(chapterIndex: number, paragraphIndex: number, next: Partial<AnnotatedParagraph>): void` — `paragraphIndex` counts the paragraph projection, excluding image blocks. When `text` changes without new `inlineAnnotations`, existing annotations are re-anchored onto the new text: each one either keeps covering exactly the same base characters or is dropped
- `setInlineAnnotations(chapterIndex: number, paragraphIndex: number, inlineAnnotations: readonly InlineAnnotation[]): void` — Replace a paragraph's annotations; entries outside the current text are dropped
- `insertParagraph(chapterIndex: number, atIndex: number, paragraph: Omit<EditableParagraphBlock, 'kind' | 'id'>): string` — `atIndex` is a position in `chapter.blocks`; pass `chapter.blocks.length` to append. Returns the generated block id
- `deleteBlock(chapterIndex: number, blockId: string): void` — Remove a paragraph or image block. An image's asset goes with it when no other block references it
- `splitParagraph(chapterIndex: number, blockId: string, charIndex: number): [string, string]` — Split at a code point index; annotations straddling the cut are dropped. Returns the two block ids
- `mergeParagraphs(chapterIndex: number, leftId: string, rightId: string): string` — `leftId` must immediately precede `rightId`. Returns the surviving (left) block id
- `moveBlock(chapterIndex: number, blockId: string, toIndex: number): void` — Move a block to a new index in `chapter.blocks`
- `addImage(chapterIndex: number, image: AddImageInput | EditableEpubImage): string` — Add an image asset and an image block referencing it. Returns the generated `assetKey`
- `removeImage(chapterIndex: number, blockIdOrAssetKey: string): void` — Remove an image block, and its asset when nothing else references it
- `updateImage(chapterIndex: number, blockId: string, patch: Partial<Omit<EditableImageBlock, 'kind' | 'id' | 'assetKey'>>): void` — Update alt text, caption or placement
- `setImageCaption(chapterIndex: number, blockId: string, caption: string | undefined): void` — Shorthand for the caption-only `updateImage`
- `export(options?: EpubExportOptions): Promise<ArrayBuffer>` — Serialize the edited EPUB. Book state is captured synchronously on entry, so an edit made while the export is still awaiting asset bytes lands in the next export, never part-way through this one

### EpubProject

**`EpubProject`** — Builds a new EPUB 3 package from manuscript chapters.

- `constructor(options: EpubProjectOptions)` — Applies the defaults, then registers `chapters` and `cover`, so an invalid cover href throws here rather than at export time
- `static fromManuscript(options: EpubProjectOptions): EpubProject` — Named-constructor spelling of `new EpubProject(options)`
- `metadata: EpubProjectMetadata` — Package metadata with defaults applied (`language` falls back to `'ja'`, a blank `identifier` is replaced by a fresh `urn:uuid:` value, `modified` defaults to construction time). Mutable in place
- `chapters: readonly ProjectChapter[]` — Chapters in spine order, each with the manifest id assigned at insert time
- `assets: readonly EpubProjectAsset[]` — Manifest assets in insertion order, with resolved id / href / media type. A cover is always the last entry
- `includeTitlePage: boolean` / `includeTitleInFirstChapter: boolean` / `pageProgressionDirection: 'rtl' | 'ltr' | 'default'` / `dialect: ManuscriptDialect` — Settled from the constructor options
- `stylesheet: string` — CSS written to `OPS/Styles/style.css`; replaceable any time before export
- `addChapter(chapter: ManuscriptChapterInput): void` — Append to the spine. The id is sanitized to an XML-safe manifest id and suffixed on collision, so the stored id may differ from `chapter.id`
- `updateChapter(index: number, patch: Partial<Omit<ManuscriptChapterInput, 'id'>>): void` — Omitted fields keep their previous value. Inline image assets the new body no longer references are dropped
- `removeChapter(index: number): void` — Remove by index, dropping the inline image assets only that chapter referenced
- `reorderChapters(from: number, to: number): void` — An out-of-range `from` is a no-op and `to` is clamped, because drag-and-drop reorder UIs routinely emit both
- `addInlineImage(chapterIndex: number, atParagraphIndex: number, asset: EpubProjectAsset & { alt?: string }): void` — Register the asset and embed an image reference in the chapter body, rendered as a `<figure>` during export
- `setCover(asset: EpubProjectAsset): void` — Register the cover, replacing any previous one. The href defaults to `'OPS/Images/cover.jpg'` and is validated like every other asset href
- `addAsset(asset: EpubProjectAsset): EpubProjectAsset` — Add a manifest asset and return the stored copy. The href is renamed with a `-2`, `-3`, … suffix on collision, so link the returned `href` rather than the one passed in. Throws when the href is not a clean relative path inside the archive
- `export(options?: EpubExportOptions): Promise<ArrayBuffer>` — Serialize to an EPUB 3 ZIP: `mimetype` first and uncompressed, then the container, package, nav document, stylesheet, optional title page, one XHTML document per chapter, and every asset. Asset bytes come from `EpubProjectAsset.data`, or from `EpubProjectAsset.url` through `options.assetResolver` (the runtime `fetch` when no resolver is given). Throws when the project has no chapters, when an asset cannot be resolved, or with an `AbortError` when `options.signal` fires

### Types

**`EpubBook`**:

- `title: string`
- `author?: string`
- `chapters: EpubChapter[]`

**`EpubChapter`**:

- `title?: string`
- `paragraphs: AnnotatedParagraph[]`

**`AnnotatedParagraph`**:

- `text: string`
- `inlineAnnotations: readonly InlineAnnotation[]`
- `headingLevel?: number`

**`EditableBlock`** — Union of `EditableParagraphBlock` and `EditableImageBlock`:

- **`EditableParagraphBlock`**: `kind: 'paragraph'`, `id: string`, `text: string`, `inlineAnnotations: readonly InlineAnnotation[]`, `paragraphKind?: Exclude<ParagraphKind, 'figure'>`, `headingLevel?: number`
- **`EditableImageBlock`**: `kind: 'image'`, `id: string`, `assetKey: string`, `alt?: string`, `caption?: string`, `placement?: 'inline' | 'fullspread'`

**`EditableEpubChapter`** — Chapter with enough source metadata to be written back:

- `href: string` — ZIP path of the source chapter document
- `originalXhtml: string` — Source markup, reused for chapters that were never edited
- `isDirty?: boolean` — Whether the chapter has been edited since parsing
- `blocks: EditableBlock[]` — The editable content, in document order
- `imageAssets: Map<string, EditableImageAsset>` — Assets keyed by `assetKey`
- `paragraphs: AnnotatedParagraph[]` — Deprecated read-only projection of `blocks`, regenerated on every mutation
- `paragraphRefs?` / `images?` — Deprecated v0.4 fields

**`EditableImageAsset`** — Image attached to an editable chapter, looked up by `assetKey` from one or more image blocks (several blocks may share one asset):

- `filename: string` — Preferred file basename inside the EPUB ZIP
- `data?: Uint8Array | ArrayBuffer` — Inline bytes, or
- `url?: string` — Source resolved at export time through `EpubExportOptions.assetResolver`
- `mediaType?: string` / `href?: string` / `manifestId?: string` / `manifestHref?: string` — Resolved during export

**`AddImageInput`** — v0.5 input for `EditableEpub.addImage()`. A union of `AddImageInputBytes` (`data`, no `url`) and `AddImageInputUrl` (`url`, no `data`), both extending **`AddImageInputCommon`**: `filename: string`, `mediaType?: string`, `alt?: string`, `caption?: string`, `placement?: 'inline' | 'fullspread'`, `afterBlockId?: string`. **`EditableEpubImage`** is the deprecated v0.4 shape (`href`, `mediaType`, `data`, `alt?`, `afterParagraph?`), still accepted by `addImage`.

**`EditableEpubSelection`** — `{ chapter: number; paragraph: number }`, the paragraph an editor UI currently targets.

**`AssetResolver`** — `(request: AssetResolverRequest) => Promise<Uint8Array | ArrayBuffer> | Uint8Array | ArrayBuffer`. Called once per asset that declares a `url` and carries no inline `data`. Throw to abort the export.

**`AssetResolverRequest`**:

- `assetKey: string` — Identifier of the asset being resolved: the key inside the chapter's `imageAssets` map on the `EditableEpub` path, and the ZIP href on the `EpubProject` path
- `asset: AssetResolverAsset` — The asset to resolve
- `url: string` — External URL declared on the asset (mirrors `asset.url`)
- `signal?: AbortSignal` — Mirror of the export `AbortSignal`, when one was passed

**`AssetResolverAsset`** — `EditableImageAsset | EpubProjectAsset`, because both export paths share one resolver. The fields a resolver normally reads (`url`, `mediaType`, `data`) are common to both and need no narrowing. The naming fields differ, so narrow with `'filename' in asset` (an `EditableImageAsset`) versus `'href' in asset` (an `EpubProjectAsset`) when the source path matters.

**`EpubParseLimits`** — Resource limits applied while opening an untrusted archive: `maxInputBytes`, `maxEntries`, `maxEntryBytes`, `maxTotalBytes`, `maxCompressionRatio` (all required; `DEFAULT_EPUB_PARSE_LIMITS` supplies the values above).

**`ParseManuscriptOptions`** — `{ dialect?: ManuscriptDialect }` for `parseManuscript()`.

**`ManuscriptSourceChapter`** — Input for `manuscriptToEpubBook()`: `id?: string`, `title: string`, `body: string`. **`ManuscriptToEpubBookOptions`**: `dialect?: ManuscriptDialect`, `title?: string`, `author?: string`.

**`EpubProjectOptions`** — Constructor options for `EpubProject`:

- `metadata: EpubProjectMetadata` — Required
- `chapters?: ManuscriptChapterInput[]` / `cover?: EpubProjectAsset` — Registered through `addChapter()` / `setCover()` during construction
- `dialect?: ManuscriptDialect` — Notation dialect chapter bodies are parsed with (default `'mejiro'`)
- `stylesheet?: string` — Replaces the bundled default stylesheet
- `pageProgressionDirection?: 'rtl' | 'ltr' | 'default'` — Default `'rtl'`
- `includeTitlePage?: boolean` — Default `true`
- `includeTitleInFirstChapter?: boolean` — Default `false`

**`ManuscriptChapterInput`** — `{ id?: string; title: string; body: string }` accepted by `EpubProject.addChapter()`. **`ProjectChapter`** is its stored form, with `id` resolved and de-duplicated (all three fields required).

**`EpubProjectAsset`** — A binary file packaged alongside the chapters:

- `href: string` — ZIP path, relative and inside the archive
- `id?: string` / `mediaType?: string` — Derived from `href` when omitted
- `data?: Uint8Array | ArrayBuffer` / `url?: string` — Inline bytes, or a source fetched at export time
- `properties?: string` — Manifest properties; `setCover()` sets `'cover-image'`

**`EpubProjectMetadata`** includes `title`, `subtitle`, `description`, `language`, `identifier`, `publisher`, `rights`, `date`, `modified`, `creators`, `contributors`, `subjects`, `series`, `collections`, and legacy `author`. **`EpubContributor`** is `{ name: string; role?: string; fileAs?: string }` and **`EpubCollection`** is `{ name: string; type?: 'series' | 'set'; index?: number }`.

---

## `@libraz/mejiro/render` — Render Data

| Export | Signature |
|---|---|
| `buildParagraphMeasures` | `(entries: RenderEntry[], options: MeasureOptions) => ParagraphMeasure[]` |

Computes paragraph measures for pagination.

| Export | Signature |
|---|---|
| `buildRenderPage` | `(slices: PageSlice[], entries: RenderEntry[]) => RenderPage` |
| `renderEpubStatic` | `(chapter: StaticChapter, options?: RenderEpubStaticOptions) => string` |
| `buildLineMetrics` | `(entries: RenderEntry[], options: MeasureOptions) => LineMetricsResult` |
| `packPageLines` | `(metrics: LineMetric[], startIdx: number, pageWidth: number) => number` |
| `buildColumnSlots` | `(metrics: LineMetric[], startIdx: number, count: number, columnHeight: number) => ColumnSlot[]` |
| `adjustExclusionSlots` | `(slots: ColumnSlot[], metrics: LineMetric[], startIdx: number, basePitch: number, contentWidth?: number) => ColumnSlot[]` |
| `getImageXOffset` | `(offsets: Float32Array, spreadStartLine: number, col: number) => number` |
| `findPhysicalColumn` | `(offsets: Float32Array, spreadStartLine: number, fromRight: number, basePitch: number) => number` |
| `paragraphClassName` | `(kind: ParagraphKind \| undefined, headingLevel?: number) => string` |

Converts page slices + entries into a renderable page structure. `renderEpubStatic`
returns framework-agnostic HTML for a single chapter, suitable for SSR fallback
markup before the client reader hydrates.
The metric/slot helpers are low-level utilities for slot-based rendering and image-exclusion layout.
`adjustExclusionSlots` takes the content width as its fifth argument; without it a slot
whose column is widened by a heading can overflow the page edge.
`paragraphClassName` builds the `mejiro-paragraph …` class string the bundled stylesheets
expect from a paragraph's `kind` and `headingLevel` — use it instead of assembling the
modifier names by hand.
`StaticChapter` is the minimal chapter shape `renderEpubStatic` needs — `{ paragraphs: readonly BookParagraph[] }` — so an `EpubChapter` or a hand-built object both satisfy it.

### Inline Segment Rendering

| Export | Signature |
|---|---|
| `segmentToInlineNode` | `(segment: RenderSegment) => InlineRenderNode` |
| `buildInlineNodes` | `(chars: readonly string[], annotations: readonly InlineAnnotation[], start?: number, end?: number) => InlineNode[]` |
| `annotationNestingRank` | `(ann: InlineAnnotation) => number` |
| `partiallyOverlaps` | `(a: InlineAnnotation, b: InlineAnnotation) => boolean` |

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
into the nested `InlineNode` tree that `buildRenderPage()` converts into segments.

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

- `chars: string[]`
- `breakPoints: Uint32Array`
- `inlineAnnotations: readonly InlineAnnotation[]`
- `headingLevel?: number` — Heading level (1–6); undefined for body text
- `isHeading?: boolean` — Deprecated. Ignored when `headingLevel` is set
- `kind?: ParagraphKind` — Structural classification of the source paragraph (default `'body'`)

**`RenderPage`**:

- `paragraphs: RenderParagraph[]`

**`RenderParagraph`**:

- `lines: RenderLine[]`
- `isHeading: boolean`
- `headingLevel?: number`
- `kind?: ParagraphKind` — Structural classification of the source paragraph, mapped to a `mejiro-paragraph--*` class by the page components

**`RenderLine`**:

- `segments: RenderSegment[]`

**`RenderSegment`** — every variant except `text` also accepts `children?: readonly RenderSegment[]` for nested annotations:

- `{ type: 'text'; text: string }`
- `{ type: 'ruby'; base: string; rubyText: string; children? }`
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
- `lineSpacing?: number` — Line spacing multiplier
- `lineHeight?: number` — Deprecated alias of `lineSpacing`
- `headingScale?: number` (default: 1.4)
- `paragraphGapEm?: number` (default: 0.4)
- `headingGapEm?: number` (default: 1.2)
- `headingStyles?: Record<number, HeadingStyle>` — Per-level overrides of `scale` / `gapAfterEm` for levels 1–6. Pass the same value used for layout, otherwise measuring and rendering disagree on heading size

**`HeadingStyle`**:

- `scale?: number` / `gapAfterEm?: number`

---

## `@libraz/mejiro/book` — High-Level API

The recommended entry point for most applications. Orchestrates font loading, layout, pagination, and image exclusion in a simple class-based API.

### Constants

| Export | Description |
|---|---|
| `DEFAULT_HEADING_STYLES` | Default heading style overrides for levels 1–6 (`{ 1: { scale: 1.6, gapAfterEm: 1.4 }, ... 6: { scale: 1.0, gapAfterEm: 0.6 } }`) |
| `DEFAULT_BOOK_OPTIONS` | Default font, spacing, kinsoku, and heading options |
| `DEFAULT_PAGE_GEOMETRY` | Default page size/line width before container measurement |
| `DEFAULT_PAGE_PADDING` | Default page padding values in pixels (`{ x: 52, y: 56, bottom: 40 }`) |

### MejiroBook

**`MejiroBook`** — Main orchestrator class:

- `constructor(options: BookOptions)` — Create with font, spacing, and heading configuration
- `getOptions(): BookOptions` — Currently committed options
- `setOptions(options: Partial<BookOptions>): Promise<void>` — Update options and propagate changes to live layouts. `lineSpacing` / `mode` / `enableHanging` apply synchronously and the returned promise is already resolved. `fontFamily` / `fontSize` / `headingStyles` / `headingScale` need re-measurement: the values are staged and become visible to `getOptions()` only after the font has loaded, so every live layout always holds advances measured with the font recorded in its own config. Overlapping calls converge on the last one; a rejection (font load failure) leaves the previous options in place
- `setPageSize(size: PageSize): void` — Set page geometry (must be called before `layoutChapter`)
- `computePageSize(container: HTMLElement, options?: ComputePageSizeOptions): { pageWidth, pageHeight, contentHeight }` — Compute page dimensions from a container element and apply them via `setPageSize`. Uses a 1.45 aspect ratio with min 280×400, max height 780, default padding, and overridable header/gutter reservations.
- `layoutChapter(chapter: { paragraphs: BookParagraph[] }): Promise<ChapterLayout>` — Lay out a chapter (compatible with `EpubChapter`)
- `layoutManuscript(options: LayoutManuscriptOptions): Promise<Map<string, ChapterLayout>>` — Lay out manuscript chapters directly, skipping the EPUB ZIP round-trip. Each body is split into paragraphs on blank lines and parsed with `parseManuscript()`; the map is keyed by `chapter.id` (or `chapter-<n>` when missing)
- `layoutFromSnapshot(snapshot: ChapterLayoutSnapshot): ChapterLayout` — Restore a layout snapshot without measuring again
- `clearCache(fontKey?: string): void` — Clear the character width measurement cache
- `cacheStats(): { fonts: number; codepoints: number }` — Current measurement cache size, for capacity monitoring across long reader sessions

### ChapterLayout

**`ChapterLayout`** — Manages pagination and image exclusion for a laid-out chapter:

- `totalPages: number` — Total page count (getter, triggers lazy computation)
- `hasImages: boolean` — Whether any spread has image exclusions
- `resize(size: Partial<PageSize> & { lineSpacing?: number }): void` — Update geometry; re-breaks lines if `lineWidth` changes. Applied as a unit: a non-positive or non-finite dimension throws `RangeError` and leaves the layout untouched
- `setImages(spreadIndex: number, images: BookImage[]): void` — Set image exclusions for a spread (empty array removes)
- `clearImages(): void` — Remove all image exclusions
- `syncImages(spreadIndex: number, images?: BookImage[]): SpreadResult` — Set images for a spread, or clear that spread when `images` is empty/omitted, then return the updated spread
- `getSpread(spreadIndex: number): SpreadResult` — Get layout data for a two-page spread
- `getPage(pageIndex: number): PageResult` — Get layout data for a single page
- `findText(query: string | RegExp, options?: FindTextOptions): SearchMatch[]` — A string is matched literally unless `options.regex` is `true`, in which case it is a regex source string; a `RegExp` always takes the regex path and keeps its own `i` / `m` / `s` flags (`options.caseSensitive`, when given, wins over `i`). Regex patterns go through a safety guard that throws on catastrophic-backtracking shapes and on oversized patterns/input. **Scope is the current `ChapterLayout` only.** Walks the chapter's paragraphs and returns hits as `SearchMatch` (an `AnchorLocation` extended with the match length, etc.). For cross-chapter or cross-book search (e.g. a novel-site search index), keep an external full-text index server-side (Meilisearch / Elasticsearch / pg_trgm / SQLite FTS5) and hand the resolved anchors to `MejiroReaderHandle.goToAnchor()` to navigate to the hit.
- `locateAnchor(anchor: InChapterAnchor): AnchorLocation | null` — Resolve an anchor to the spread / page / line containing it; `null` when out of range
- `anchorAt(spreadIndex: number, side?: 'right' | 'left'): InChapterAnchor | null` — Anchor of the first character of a spread page (default `'right'`), for converting a spread index into a reflow-stable position
- `coordOfAnchor(anchor: InChapterAnchor): AnchorRect | null` — Convert a reading anchor to spread/page coordinates
- `anchorAtCoord(spreadIdx: number, x: number, y: number): InChapterAnchor | null` — Convert coordinates back to an anchor
- `selectionRects(range: AnchorRange): AnchorRect[]` — Build highlight rectangles for a text range
- `snapshot(): ChapterLayoutSnapshot` — Serialize layout data for SSR/build caches

### Reading Time

| Export | Signature |
|---|---|
| `estimateReadingTime` | `(chapter: { paragraphs: BookParagraph[] }, options?: ReadingTimeOptions) => number` |
| `formatReadingTime` | `(ms: number, locale?: 'ja' | 'en') => string` |

### Types

**`BookOptions`**:

- `fontFamily: FontFamily` — CSS-ready string or array of family names
- `fontSize: number` — Base font size (px)
- `lineSpacing?: number` — Line spacing multiplier (default: 1.8)
- `mode?: 'strict' | 'loose'` — Kinsoku mode (default: `'strict'`)
- `enableHanging?: boolean` — Hanging punctuation (default: `true`)
- `headingStyles?: Record<number, HeadingStyle>` — Per-level heading overrides
- `headingScale?: number` — Default heading scale (default: 1.4)
- `analyzer?: TextAnalyzer` — Morphological analyzer used to derive line breaking hints. Consulted only when `wordAwareBreaking` asks for hints, and once per paragraph at layout time; a re-break (resize, font change, exclusion reflow) replays what the first pass produced. Read when a chapter is laid out, and not changeable through `setOptions()`
- `wordAwareBreaking?: 'off' | 'clusters' | 'full'` — How far the analyzer's findings reach into line breaking (default: `'off'`). `'clusters'` keeps break positions as the character-class rules would choose them, except where a break would have split a unit it is a typesetting error to split; `'full'` adds per-position penalties, which do move break positions
- `breakCost?: BreakCostOptions` — Weights for the penalty search. Forwarded to the line breaker, which ignores it unless break penalties are in play

**`PageSize`**:

- `pageWidth: number` — Page width (px)
- `lineWidth: number` — Line width / column height (px)
- `pagePaddingX?: number` — Horizontal padding (default: 0)
- `pagePaddingY?: number` — Vertical padding (default: 0)

**`BookParagraph`**:

- `text: string`
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `headingLevel?: number`
- `kind?: ParagraphKind` — `'body'` (default) / `'heading'` / `'blockquote'` / `'sceneBreak'` / `'pre'` / `'figure'`
- `hints?: TypographyHints` — Pre-computed hints for this paragraph, bypassing the book's own `analyzer` entirely. Offsets are code point indices into the NFC form of `text`

**`BookImage`**:

- `x: number` / `y: number` — Position relative to right page top-left (px)
- `w: number` / `h: number` — Size (px)
- `margin?: number` — Inline margin (default: base fontSize)

**`SpreadResult`**:

- `right: PageResult` — Right page (first in vertical-rl reading order)
- `left: PageResult` — Left page
- `totalPages: number`

**`PageResult`**:

- `page: RenderPage` — Paragraph-structured data (for CSS `vertical-rl` rendering)
- `lines: PageLine[]` — Flat line list (for slot-based absolute rendering)
- `slots: ColumnSlot[]` — Per-line position and dimensions
- `hasImages: boolean` — Whether this page has image exclusions

**`PageLine`**:

- `segments: RenderSegment[]` — Text and inline annotation segments
- `headingLevel?: number` — Heading level (undefined for body)
- `fontSize: number` — Computed font size (px, accounts for heading scale)

**`MejiroBookOptions`** — Constructor options for `MejiroBook`: `BookOptions` plus `strictFontCheck?: boolean`, which is captured at construction time and cannot be changed afterwards.

**`ChapterLike`** — `{ paragraphs: readonly BookParagraph[] }`, the minimal chapter shape `estimateReadingTime()` needs.

**`ManuscriptChapter`** — One chapter for `MejiroBook.layoutManuscript()`: `id?: string` (key in the returned map), `title: string` (emitted as an `h1` paragraph at the top of the layout), `body: string` (raw manuscript; blank lines separate paragraphs).

**`InChapterAnchor` / `ReadingAnchor`** — Reflow-stable reading positions. `InChapterAnchor` is `{ paragraph, charIndex }`; `ReadingAnchor` extends it with `chapter: number` for a book-wide position. `AnchorLocation`, `AnchorRect`, `AnchorRange` and `SearchMatch` are the layout-side results built from them.

This subpath also re-exports `RubyInputAnnotation`, the deprecated alias of `InlineRubyAnnotation`, so a `mejiro/book`-only consumer does not have to reach into `mejiro/browser` for it.

**`ChapterLayoutSnapshot`** — Serialized layout produced by `ChapterLayout.snapshot()` and consumed by `MejiroBook.layoutFromSnapshot()`. Its parts are exported so a host can store them:

- **`ChapterLayoutSnapshotConfig`** — Serializable subset of the layout config: `fontSize`, `lineSpacing`, `headingScale`, `mode`, `enableHanging`, `headingStyles?`
- **`ParagraphSnapshot`** — Per-paragraph entry: `text`, `advances: number[]`, `breakPoints: number[]`, `inlineAnnotations`, `isHeading?`, `headingLevel?`, `kind?`, `layoutRubyAnnotations?`, `layoutTcyAnnotations?`
- **`LayoutRubySnapshot`** — `RubyAnnotation` with the typed arrays widened to plain `number[]` so the snapshot survives `JSON.stringify`
- **`SpreadImagesSnapshot`** — `{ spreadIndex: number; images: BookImage[] }`, the image exclusions of one spread

---

## `@libraz/mejiro/image` — Image Helpers

| Export | Signature |
|---|---|
| `prepareImage` | `(file: Blob \| File, options?: PrepareImageOptions) => Promise<PrepareImageResult>` |

Decodes a browser image file, optionally downscales it, re-encodes it, and returns binary data plus dimensions for EPUB embedding. Browser-only: it uses `createImageBitmap`, `OffscreenCanvas` and `HTMLCanvasElement`.

**`PrepareImageOptions`** — All fields optional, so `prepareImage(file)` is safe:

- `maxBytes?: number` — Target size after re-encoding (default 2 MiB). When the encoded image still exceeds it, JPEG/WebP quality keeps dropping (down to `0.4`) before a warning is emitted
- `maxWidth?: number` / `maxHeight?: number` — Pixel bounds after downscale (default `2048` each)
- `convertTo?: 'auto' | 'webp' | 'jpeg' | 'png'` — Output format (default `'auto'`, which keeps JPEG / PNG / WebP sources, re-encodes GIF as `image/png` with animation flattened, and falls back to `image/jpeg` for anything else). The request is not a guarantee: a platform that cannot encode the requested format silently produces another one
- `quality?: number` — Initial JPEG/WebP quality (default `0.85`)

**`PrepareImageResult`**:

- `data: Uint8Array` — Re-encoded payload, ready to drop into an EPUB
- `mediaType: string` — MIME type of `data`, taken from the encoder's output rather than from the requested format
- `width: number` / `height: number` — Decoded pixel size after any downscale
- `warnings: string[]` — Diagnostic notices: downscaling, quality drops and format fallbacks

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

Creates an analyzer backed by the suzume WebAssembly tokenizer. The module and its dictionaries load here, once, because `TextAnalyzer.analyze()` is synchronous — every asynchronous step has to happen before the analyzer exists. The returned promise **rejects** when `@libraz/suzume` is not installed or its module fails to load: calling this factory is an explicit request for that analyzer, so a caller that would rather fall back to character-class-only breaking catches the rejection and does so itself. Dispose the analyzer when you are done with it; an adopted `instance` is left alone, because its lifetime belongs to whoever created it.

**`SuzumeAnalyzerOptions`**:

- `instance?: unknown` — Pre-created Suzume instance to adopt instead of creating one
- `wasmPath?: string` — Override for the WebAssembly binary location, forwarded to the instance factory

| Export | Signature |
|---|---|
| `alignMorphemeOffsets` | `(text: string, normalizedText: string, morphemes: readonly MorphemeLike[]) => { morphemes: MorphemeLike[]; warnings: string[] } \| null` |

Maps morpheme offsets from an analyzer's normalized text back onto the text the layout engine will break. An analyzer indexes its output against the text its own normalizer produced, and that normalizer can only shorten its input, so the mapping is either the identity — the fast path ordinary prose takes — or a single monotone walk. It succeeds completely or not at all: a partial mapping would move hints onto the wrong characters, so `null` comes back instead. Morphemes whose mapped span falls outside the text or fails to describe its own surface are dropped and reported in `warnings`. Use it when adapting an analyzer of your own to the `TextAnalyzer` interface.

This subpath also re-exports `AnalyzerIdentity`, `MorphemeLike`, `TextAnalysis` and `TextAnalyzer`, so an analyzer implementation does not have to reach into the core subpath for them.

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

### Components

Every component exports a matching props type; `MejiroSettingsPanel` additionally exports the value types its form edits.

| Component | Props type | Purpose |
|---|---|---|
| `MejiroReader` | `MejiroReaderProps` | Full reader: chrome, navigation, settings, persistence hooks |
| `MejiroEditor` | `MejiroEditorProps` | Block editor over an `EditableEpub`, with `MejiroExportPolicy` |
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
| `MejiroChapterNav` | `MejiroChapterNavProps` | Chapter selector; `MejiroChapterNavVariant` is `'select' \| 'panel'` |
| `MejiroStats` | `MejiroStatsProps` | Layout statistics line |
| `MejiroPageIndicator` | `MejiroPageIndicatorProps` | "current / total" spread position |
| `MejiroDropZone` | `MejiroDropZoneProps` | EPUB drop target / file picker |
| `MejiroImageOverlay` | `MejiroImageOverlayProps` | Draggable, resizable image placeholder |
| `MejiroI18nProvider` | — | Scopes a message catalog to its descendants |

### Hooks

| Hook | Options / return types | Other exported types |
|---|---|---|
| `useEpub` | `UseEpubOptions` / `UseEpubReturn` | — |
| `useEditableEpub` | `UseEditableEpubOptions` / `UseEditableEpubReturn` | `EditableEpubSelection` |
| `useEpubProject` | `UseEpubProjectOptions` / `UseEpubProjectReturn` | `EpubProjectChapterDraft` |
| `useLibrary` | `UseLibraryOptions` / `UseLibraryReturn` | `VolumeInfo` |
| `useManuscriptDraft` | `UseManuscriptDraftOptions` / `UseManuscriptDraftReturn` | — |
| `useManuscriptLayout` | `UseManuscriptLayoutOptions` / `UseManuscriptLayoutReturn` | `ManuscriptPageDimensions`, `ManuscriptRecomputeOptions` |
| `useAnnotations` | `UseAnnotationsOptions` / `UseAnnotationsReturn` | `Annotation`, `AnnotationsStorage` |
| `useMejiroBook` | `UseMejiroBookOptions` / `UseMejiroBookReturn` | — |
| `useChapterLayout` | `UseChapterLayoutOptions` / `UseChapterLayoutReturn` | `PageDimensions`, `RecomputeOptions` |
| `useSpread` | `UseSpreadOptions` / `UseSpreadReturn` | — |
| `useReadingPosition` | `UseReadingPositionOptions` / `UseReadingPositionReturn` | `ReadingPositionStorage`, `ReadingPositionValue` |
| `useI18n` | `UseI18nOptions` | `MejiroLocale`, `MejiroMessages`; `enMessages`, `jaMessages`, `resolveMessages`, `format` |
| `useImageOverlay` | `UseImageOverlayOptions` / `UseImageOverlayReturn` | `ImageOverlayRect` (and its deprecated alias `ImageRect`) |
| `useMultiImageOverlay` | `UseMultiImageOverlayOptions` / `UseMultiImageOverlayReturn` | `MultiImageItem` |

`format(template, vars)` substitutes `{name}` placeholders, the same contract as the core `formatMessage`. `AnnotationsStorage` and `ReadingPositionStorage` are both aliases of the core `MejiroStorage`. `PageDimensions` and `ManuscriptPageDimensions` are both `{ pageWidth, pageHeight, contentHeight }`, and `RecomputeOptions` / `ManuscriptRecomputeOptions` are both `{ blank?: boolean }`. `VolumeInfo` is `{ id, label, author?, cover?, meta? }`, `EpubProjectChapterDraft` and `ManuscriptEditorChapter` are both `{ id, title, body }`, and `MultiImageItem` is `{ id, rect }`.

### MejiroReader types

- **`MejiroReaderProps`** — Discriminated union of the four source modes, so TypeScript rejects passing more than one source at once: `MejiroReaderControlledProps` (`epub: EpubBook | null`), `MejiroReaderUrlProps` (`epubUrl: string`), `MejiroReaderFileProps` (no source; the reader exposes its drop zone / file picker), and `MejiroReaderManuscriptProps` (`manuscript: readonly ManuscriptChapter[]`, `dialect?: ManuscriptDialect`). Each variant extends **`MejiroReaderCommonProps`**, which carries everything else.
- **`MejiroReaderHandle`** — Imperative handle from `ref`: `goToSpread`, `next`, `prev`, `goToChapter`, `getReadingPosition(): ReadingPosition`, `goToAnchor(): Promise<void>`, `getAnchor()`, `getVisibleRange()`, `setOptions(): Promise<void>`, `subscribe()`.
- **`MejiroReaderEventMap`** — Payloads for `subscribe`: `spreadChanged({ chapter, spreadIdx })`, `turnStart({ from })`, `turnEnd({ to })`, `chapterFinished({ chapter })`.
- **`ReadingPosition`** — `{ chapter, spreadIdx, totalPages, totalSpreads }` returned by `getReadingPosition()`.
- **`MejiroReaderSettingsSlot`** — Context for the `renderSettings` render prop: `{ settings: EditableSettings; update; open; toggle }`.
- **`MejiroTheme`** — `MejiroThemeName` or `{ name, override }` to layer custom CSS variables on a preset. **`MejiroThemeName`** is `'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto'`.
- **`MejiroReaderMode`** — `'paginated' | 'scroll'`. **`MejiroSpreadMode`** — `'double' | 'single' | 'auto'`. **`MejiroReaderFit`** — `'fill' | 'width'`. **`PageNumberDisplay`** — `'both' | 'right' | 'left' | 'none'`. **`MejiroChapterNavMode`** — `'select' | 'panel' | 'both' | 'none'`.

### MejiroManuscriptEditor types

- **`ManuscriptEditorChapter`** — `{ id, title, body }`, one chapter of the draft.
- **`ManuscriptAutosaveDraft`** — Autosave payload: `{ title, author, cover: File | null, chapters }`.
- **`ManuscriptPreviewProps`** — The subset of `MejiroReader` props forwarded to the live preview. Properties the editor drives itself (`manuscript`, `fonts`, `chapter`, `onChapterChange`) are ignored if supplied.

### MejiroEditor types

- **`MejiroExportPolicy`** — Declarative restrictions on the export pipeline, applied in order: `watermark` (on an export-only copy of the book, never on the edited document) → `encrypt` (replaces the buffer) → `allowDownload` (skips the browser download when `false`).

Common headless editor returns:

- `useEditableEpub({ defaultUrl?, onLoad?, onError?, onExport? })` returns `editor`, `book`, `previewBook`, `loading`, `exporting`, `error`, `revision`, `history`, `selection`, `selectedParagraph`, `setSelection`, `loadBuffer`, `loadFile`, `loadUrl`, `updateParagraph`, `setInlineAnnotations`, `addImage({ filename, data, ... })`, `undo`, `redo`, and `exportEpub(options?)`.
- `useEpub({ defaultUrl?, onLoad?, onError?, fetchOptions?, fetchEpub? })` returns `epub`, `loading`, `error`, `loadBuffer`, `loadFile`, `loadUrl`, and `setEpub`.
- `useEpubProject({ metadata?, chapters?, cover?, assets?, debounceMs?, onPreview?, onExport? })` returns `metadata`, `chapters`, `selectedChapter`, `currentChapter`, `cover`, `assets`, `previewBook`, `previewError`, `previewing`, plus `setMetadata`, `setChapters`, `setSelectedChapter`, `setCover`, `setAssets`, `addChapter`, `removeChapter`, `patchChapter`, `reorderChapters`, `buildProject`, and `exportEpub`. `currentChapter` is the selected draft (or `null`); `setCover(null)` drops the cover, and both the debounced preview and `exportEpub` reflect cover/asset changes.
- `useManuscriptDraft({ initialChapters?, onAutosave?, autosaveDelay? })` returns draft chapter state plus add/remove/reorder/patch helpers.
- `useManuscriptLayout(book, chapter, surfaceRef, { dialect?, enableResize?, resizeDebounce? })` lays out a single manuscript chapter directly, with no EPUB ZIP round-trip. Returns `{ layout, pageWidth, pageHeight, contentHeight, elapsedMs, recompute }` (same shape as `useChapterLayout`). Designed for live preview surfaces.
- `useAnnotations({ key, storage?, throttleMs?, onChange? })` persists highlights / bookmarks / comments. Returns `{ annotations, add, remove, update, clear }`. `storage` follows the same `getItem` / `setItem` / `removeItem` interface as `useReadingPosition`. `onChange(next)` fires synchronously after `add` / `remove` / `update` / `clear` (skipped on initial hydration and no-ops) — handy for forwarding each mutation to a server.
- `useReadingPosition({ key, storage?, throttleMs?, onChange? })` exposes the same `onChange(next | null)` hook, fired right after `save` / `clear`.

**`MejiroReader` manuscript source** -- A fourth source mode alongside `epub` / `epubUrl`. Pass `manuscript: ManuscriptChapter[]` plus `dialect?: ManuscriptDialect` and the Reader renders the chapters directly, skipping the EPUB ZIP entirely.

**`MejiroReader` presentation props** -- `theme?: MejiroTheme` (reflected as `data-mejiro-theme` on the reader root, which the bundled CSS reads to swap palettes), `mode?: MejiroReaderMode` (`'paginated'` default / `'scroll'` stacks every page in a vertical scroller), `spreadMode?: MejiroSpreadMode` (`'double'` default / `'single'` / `'auto'`), `fit?: MejiroReaderFit` (`'fill'` default / `'width'`), `pageNumbers?: PageNumberDisplay`, `locale?: MejiroLocale` and `messages?: Partial<MejiroMessages>` for UI strings, and `renderSettings?: (slot: MejiroReaderSettingsSlot) => ReactNode` to replace the settings panel body with a custom form.

**`MejiroReader` `annotations` prop** -- Pass an array of `{ chapter, start, end, color? }` and the Reader converts entries on the current chapter into highlight rectangles via `ChapterLayout.selectionRects`, forwarding them to `MejiroSpread`. Typically paired with `useAnnotations`, but any shape that satisfies the structural type works.

**`MejiroNotationHighlighter`** -- Textarea wrapped with an overlay that tints notation tokens (ruby, emphasis, TCY, em, strong, link, footnote). Props: `{ value, onChange, dialect?, wrapperClassName?, ... }` plus textarea attributes (forwarded). Override per-token colors via CSS on `.mejiro-notation-token[data-token="…"]`.

**`MejiroPageView`** -- Recommended lower-level page renderer. Renders a `PageResult` from `ChapterLayout`. Automatically switches between CSS vertical-rl and slot-based rendering.

Props:

- `result: PageResult` -- Required
- `fontFamily?: string` -- CSS font family (for slot-based mode)
- `lineSpacing?: number` -- Line spacing multiplier (for slot-based mode)
- `slotMode?: boolean` -- Force slot-based rendering (set when layout has images)
- `className?: string`
- `style?: CSSProperties`

**`useImageOverlay(layout, spreadIdx, onUpdate, options?)`** -- Hook for managing a draggable/resizable image overlay with automatic text reflow.

- `layout: ChapterLayout | null` -- Current chapter layout
- `spreadIdx: number` -- Current spread index
- `onUpdate: (spread: SpreadResult) => void` -- Called after every reflow
- `options?: { defaultWidth?, defaultHeight?, defaultX?, defaultY?, margin? }`

Returns: `{ imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown }`

**`MejiroPage`** -- Low-level. Renders a `RenderPage` using CSS `writing-mode: vertical-rl`.

Props:

- `page: RenderPage` -- Required
- `className?: string`
- `style?: CSSProperties`

Paragraph classes come from the shared `paragraphClassName(kind, headingLevel)` helper, falling back to `'heading'` when only the deprecated `isHeading` is set, so `blockquote` / `sceneBreak` / `pre` / `figure` paragraphs get the same `mejiro-paragraph--*` modifiers the static renderer emits.

---

## `@libraz/mejiro-vue` — Vue Component

```bash
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

Peer dependency: `vue >= 3.3`.

### Components and prop types

The component set matches the React package. Each component exports a props alias declared as `InstanceType<typeof Component>['$props']`, so it always tracks the component's own `props` block — including the `default` values, which is why every field appears optional even when the runtime default is `undefined`.

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
| `MejiroImageOverlay` | `MejiroImageOverlayProps` |
| `MejiroManuscriptEditor` (preview passthrough) | `ManuscriptPreviewProps` |

`MejiroI18nProvider` is a component too, and takes `locale` / `messages` like its React counterpart.

Unlike React, `MejiroReaderProps` is a single object type rather than a discriminated union, so the source props are not mutually exclusive at the type level: `epub` wins over `epubUrl`, and `manuscript` cannot be combined with either. `MejiroReaderCommonProps` / `MejiroReaderControlledProps` / `MejiroReaderUrlProps` / `MejiroReaderFileProps` / `MejiroReaderManuscriptProps` exist only in the React package.

### Composables

The Vue composables expose the same operations as the React hooks and share the option / return type names: `useEpub` (`UseEpubOptions` / `UseEpubReturn`), `useEditableEpub` (`UseEditableEpubOptions` / `UseEditableEpubReturn`, `EditableEpubSelection`), `useEpubProject` (`UseEpubProjectOptions` / `UseEpubProjectReturn`, `EpubProjectChapterDraft`), `useLibrary` (`UseLibraryOptions` / `UseLibraryReturn`, `VolumeInfo`), `useManuscriptDraft` (`UseManuscriptDraftOptions` / `UseManuscriptDraftReturn`), `useManuscriptLayout` (`UseManuscriptLayoutOptions` / `UseManuscriptLayoutReturn`, `ManuscriptPageDimensions`, `ManuscriptRecomputeOptions`), `useAnnotations` (`UseAnnotationsOptions` / `UseAnnotationsReturn`, `Annotation`, `AnnotationsStorage`), `useMejiroBook` (`UseMejiroBookOptions` / `UseMejiroBookReturn`), `useChapterLayout` (`UseChapterLayoutOptions` / `UseChapterLayoutReturn`, `PageDimensions`, `RecomputeOptions`), `useSpread` (`UseSpreadOptions` / `UseSpreadReturn`), `useReadingPosition` (`UseReadingPositionOptions` / `UseReadingPositionReturn`, `ReadingPositionStorage`), `useI18n` (`UseI18nOptions`, plus `enMessages` / `jaMessages` / `resolveMessages` / `format`), `useImageOverlay` (`UseImageOverlayOptions` / `UseImageOverlayReturn`) and `useMultiImageOverlay` (`UseMultiImageOverlayOptions` / `UseMultiImageOverlayReturn`, `MultiImageItem`).

Reactive state is returned as `Ref` / `ComputedRef` values, and composables that take a layout or index accept refs rather than plain values.

### `MejiroReader` presentation props

The same set as React, declared as Vue props:

- `theme?: MejiroTheme` (default `'light'`) — reflected as `data-mejiro-theme` on the reader root, which the bundled CSS reads to swap palettes. `MejiroThemeName` is `'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto'`; the object form `{ name, override }` layers custom CSS variables on a preset
- `mode?: MejiroReaderMode` (default `'paginated'`) — `'scroll'` stacks every page of the chapter in a vertical scroller
- `spreadMode?: MejiroSpreadMode` (default `'double'`) — `'single'` renders only the right page; `'auto'` flips to single for portrait viewports, observed with a `ResizeObserver`
- `fit?: MejiroReaderFit` (default `'fill'`) — `'width'` makes the reader self-size from its width and the page aspect, and defaults the reserved `gutterOffset` / `headerOffset` to 0 so the spread fills edge-to-edge
- `pageNumbers?: PageNumberDisplay` (default `'both'`) — which page of a spread shows its number in the running head; the "n / total" indicator is independent
- `chapterNavMode?: MejiroChapterNavMode` (default `'select'`) — where the built-in chapter navigation renders
- `locale?: MejiroLocale` and `messages?: Partial<MejiroMessages>` — UI strings
- `title` / `subtitle` — header logo text
- `bare?: boolean` (default `false`) — flips the defaults of `enableHeader`, `enableChapterNav`, `enableSettings`, `enableStats` and `enablePageIndicator` to `false`; explicitly passed `enable*` props still win
- `enableHeader` / `enableChapterNav` / `enableSettings` / `enableStats` / `enablePageIndicator` (default `!bare`), `enableDropZone` / `enableImageOverlay` (default `false`), `enableKeyboard` / `enableSurfaceTap` (default `true`)
- `fallbackHtml?: string` — static hydration fallback, typically the output of `renderEpubStatic`
- `fetchOptions?: RequestInit`, `limits?: EpubParseLimits`, `fetchEpub?: (url: string) => Promise<ArrayBuffer>` — EPUB loading in URL mode
- `annotations?` — `{ chapter, start, end, color? }` entries converted to highlight rectangles via `ChapterLayout.selectionRects`

Where React takes a `renderSettings` render prop, Vue uses slots: `settings` (receives the same `MejiroReaderSettingsSlot` context), plus `header`, `logo`, `dropZone`, `fallback` and `loading`.

Events are emitted rather than passed as callbacks: `load`, `chapter-change`, `spread-change`, `spread-idx-change`, `error`, `page-read` and `chapter-completed`. `MejiroReaderEventMap` still describes the payloads of the imperative `MejiroReaderHandle.subscribe()`, and `MejiroReaderHandle` exposes the same methods as in React (`goToSpread`, `next`, `prev`, `goToChapter`, `getReadingPosition`, `goToAnchor`, `getAnchor`, `getVisibleRange`, `setOptions`, `subscribe`).

### `MejiroManuscriptEditor` and `MejiroEditor` types

`ManuscriptEditorChapter`, `ManuscriptAutosaveDraft`, `ManuscriptPreviewProps` and `MejiroExportPolicy` have the same shapes as in the React package.

### Supporting types

The Vue barrel exports these alongside the components, with the same shapes as their React counterparts, so a Vue-only host never has to import from the React package:

- `MejiroChapterNavVariant` — `'select' | 'panel'`, the layout `MejiroChapterNav` renders in
- `EditableSettings` and `FontChoice` — the value and option types `MejiroSettingsPanel` edits
- `PageHeaderData` — `{ title?, pageNumber? }` for the running heads `MejiroSpread` draws
- `ReadingPosition` — `{ chapter, spreadIdx, totalPages, totalSpreads }` from `MejiroReaderHandle.getReadingPosition()`
- `ReadingPositionValue` — the persisted anchor `useReadingPosition` stores
- `ImageOverlayRect` — the core overlay rectangle, re-exported so `useImageOverlay` callers get it from one place. `ImageRect` remains as its deprecated alias

**`MejiroPageView`** -- Recommended lower-level page renderer. Renders a `PageResult` from `ChapterLayout`. Automatically switches between CSS vertical-rl and slot-based rendering.

Props:

- `result: PageResult` -- Required
- `fontFamily?: string` -- CSS font family (for slot-based mode)
- `lineSpacing?: number` -- Line spacing multiplier (for slot-based mode)
- `slotMode?: boolean` -- Force slot-based rendering (set when layout has images)

**`useImageOverlay(layout, spreadIdx, onUpdate, options?)`** -- Composable for managing a draggable/resizable image overlay with automatic text reflow.

- `layout: Ref<ChapterLayout | null>` -- Current chapter layout ref
- `spreadIdx: Ref<number>` -- Current spread index ref
- `onUpdate: (spread: SpreadResult) => void` -- Called after every reflow
- `options?: { defaultWidth?, defaultHeight?, defaultX?, defaultY?, margin? }`

Returns: `{ imageRect: Ref, hasImage: Ref, toggleImage, onOverlayPointerDown, onResizePointerDown }`

**`MejiroPage`** -- Low-level. Renders a `RenderPage` using CSS `writing-mode: vertical-rl`.

Props:

- `page: RenderPage` -- Required

Paragraph classes come from the same shared `paragraphClassName(kind, headingLevel)` helper the React component uses, so `blockquote` / `sceneBreak` / `pre` / `figure` paragraphs get identical `mejiro-paragraph--*` modifiers in both frameworks and in `renderEpubStatic` output.

---

[Back to documentation index](./README.md)
