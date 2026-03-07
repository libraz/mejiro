# API Reference

> **Note:** This document covers the full public API. For parameter details and defaults, see the TypeScript type definitions included in the package.

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
| `buildKinsokuRules` | `(raw: { lineStartProhibited: number[]; lineEndProhibited: number[] }) => KinsokuRules` |

Creates a `KinsokuRules` object from raw codepoint arrays with pre-computed lookup sets.

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

Distributes ruby text widths across base characters and generates cluster IDs. Applies JLReq adjacent kana overhang (50%).

| Export | Signature |
|---|---|
| `isKana` | `(cp: number) => boolean` |

Tests if a codepoint is hiragana (U+3040--U+309F) or katakana (U+30A0--U+30FF).

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

Distributes paragraph lines across fixed-size pages, splitting at page boundaries.

| Export | Signature |
|---|---|
| `getLineRanges` | `(breakPoints: Uint32Array, charCount: number) => [number, number][]` |

Converts break points into `[start, end)` character index pairs per line.

### Token Boundaries

| Export | Signature |
|---|---|
| `tokenLengthsToBoundaries` | `(tokenLengths: number[]) => Uint32Array` |

Converts morphological analyzer token lengths to boundary indices for `LayoutInput.tokenBoundaries`.

### Types

**`LayoutInput`** -- Input for `computeBreaks()`:

- `text: Uint32Array` -- Unicode codepoints
- `advances: Float32Array` -- Per-character advance widths (px)
- `lineWidth: number` -- Available line width (px)
- `mode?: KinsokuMode` -- `'strict'` (default) or `'loose'`
- `enableHanging?: boolean` -- Enable hanging punctuation (default: `true`)
- `clusterIds?: Uint32Array` -- Indivisible character groups
- `rubyAnnotations?: RubyAnnotation[]` -- Ruby annotations
- `tokenBoundaries?: Uint32Array | readonly number[]` -- Preferred break positions
- `kinsokuRules?: KinsokuRules` -- Custom prohibition rules

**`BreakResult`** -- Output of `computeBreaks()`:

- `breakPoints: Uint32Array` -- Index of last character before each break
- `hangingAdjustments?: Float32Array` -- Hanging overhang per line (px)
- `effectiveAdvances?: Float32Array` -- Per-char advances after ruby distribution

**`KinsokuMode`** -- `'strict' | 'loose'`

**`KinsokuRules`** -- Custom prohibition rules:

- `lineStartProhibited: number[]` / `lineEndProhibited: number[]`
- `lineStartProhibitedSet: Set<number>` / `lineEndProhibitedSet: Set<number>`

**`RubyAnnotation`** -- Core-level ruby annotation:

- `startIndex: number` / `endIndex: number` -- Range in base text
- `rubyText: Uint32Array` / `rubyAdvances: Float32Array`
- `type?: 'mono' | 'group' | 'jukugo'`
- `jukugoSplitPoints?: number[]`

**`ParagraphMeasure`** -- Pagination input:

- `lineCount: number` / `linePitch: number` / `gapBefore: number`

**`PageSlice`** -- Pagination output:

- `paragraphIndex: number` / `lineStart: number` / `lineEnd: number`

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
| `layoutText` | `(options: { text, fontFamily, fontSize, lineWidth, mode?, enableHanging?, rubyAnnotations? }) => Promise<BreakResult>` |

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
- `toFontSpec(fontFamily: string, fontSize: number): string` -- CSS font spec

### Types

**`MejiroBrowserOptions`**:

- `fixedFontFamily?: string`
- `fixedFontSize?: number`
- `strictFontCheck?: boolean`

**`LayoutOptions`**:

- `text: string`
- `fontFamily?: string`
- `fontSize?: number`
- `lineWidth: number`
- `mode?: KinsokuMode`
- `enableHanging?: boolean`
- `rubyAnnotations?: RubyInputAnnotation[]`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`ChapterLayoutOptions`**:

- `paragraphs: ParagraphInput[]`
- `fontFamily?: string`
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
- `rubyAnnotations?: RubyInputAnnotation[]`
- `fontFamily?: string`
- `fontSize?: number`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`RubyInputAnnotation`**:

- `startIndex: number`
- `endIndex: number`
- `rubyText: string`
- `type?: 'mono' | 'group' | 'jukugo'`
- `jukugoSplitPoints?: number[]`

---

## `@libraz/mejiro/epub` — EPUB Parsing

| Export | Signature |
|---|---|
| `parseEpub` | `(buffer: ArrayBuffer) => Promise<EpubBook>` |

Parses an EPUB file into structured chapters with ruby annotations.

| Export | Signature |
|---|---|
| `extractRubyContent` | `(xhtml: string) => AnnotatedParagraph[]` |

Extracts paragraphs and ruby annotations from an XHTML document string.

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
- `rubyAnnotations: RubyInputAnnotation[]`
- `headingLevel?: number`

---

## `@libraz/mejiro/render` — Render Data

| Export | Signature |
|---|---|
| `buildParagraphMeasures` | `(entries: RenderEntry[], options: MeasureOptions) => ParagraphMeasure[]` |

Computes paragraph measures for pagination.

| Export | Signature |
|---|---|
| `buildRenderPage` | `(slices: PageSlice[], entries: RenderEntry[]) => RenderPage` |

Converts page slices + entries into a renderable page structure.

### CSS

```ts
import '@libraz/mejiro/render/mejiro.css';
```

### Types

**`RenderEntry`**:

- `chars: string[]`
- `breakPoints: Uint32Array`
- `rubyAnnotations: RubyInputAnnotation[]`
- `isHeading: boolean`

**`RenderPage`**:

- `paragraphs: RenderParagraph[]`

**`RenderParagraph`**:

- `lines: RenderLine[]`
- `isHeading: boolean`

**`RenderLine`**:

- `segments: RenderSegment[]`

**`RenderSegment`**:

- `{ type: 'text'; text: string } | { type: 'ruby'; base: string; rubyText: string }`

**`MeasureOptions`**:

- `fontSize: number`
- `lineHeight: number`
- `headingScale?: number` (default: 1.4)
- `paragraphGapEm?: number` (default: 0.4)
- `headingGapEm?: number` (default: 1.2)

---

## `@libraz/mejiro-react` — React Component (Experimental)

```bash
npm install @libraz/mejiro-react  # peerDep: react >=18
```

**`MejiroPage`** -- `(props: MejiroPageProps) => ReactNode`

Props:

- `page: RenderPage` -- Required
- `className?: string`
- `style?: CSSProperties`

---

## `@libraz/mejiro-vue` — Vue Component (Experimental)

```bash
npm install @libraz/mejiro-vue  # peerDep: vue >=3.3
```

**`MejiroPage`** -- Vue component (defineComponent)

Props:

- `page: RenderPage` -- Required

---

[Back to documentation index](./README.md)
