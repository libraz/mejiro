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
- `kinsokuRules?: KinsokuRules` -- Custom prohibition rules

**`BreakResult`** -- Output of `computeBreaks()`:

- `breakPoints: Uint32Array` -- Index of last character before each break
- `hangingAdjustments?: Float32Array` -- Hanging overhang per line (px)
- `effectiveAdvances?: Float32Array` -- Per-char advances after ruby distribution
- `lineWidths?: Float32Array` -- Actual width used per line (present when `lineWidths` input was provided)

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

**`ExclusionPageGeometry`** — Page geometry for exclusion computation:

- `lineWidth: number` — Base line width (px)
- `lineCount: number` — Number of columns
- `linePitch: number` — Column pitch (fontSize × lineHeight) (px)
- `contentWidth: number` — Content width in block direction (px)

**`ImageRect`** — Image rectangle in content-area coordinates:

- `x: number` / `y: number` — Position from content area origin (px)
- `w: number` / `h: number` — Size (px)

**`ImageOverlayRect`** — UI overlay rectangle:

- `x: number` / `y: number` — Overlay position (px)
- `w: number` / `h: number` — Overlay size (px)

**`ColumnSlot`** — Per-column rendering slot:

- `xPos: number` — Offset from right edge of content area (px)
- `yStart: number` — Vertical offset from content top (px)
- `height: number` — Available text height (px)

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
| `layoutText` | `(options: { text, fontFamily, fontSize, lineWidth, mode?, enableHanging?, inlineAnnotations? }) => Promise<BreakResult>` |

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
- `inlineAnnotations?: readonly InlineAnnotation[]`
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
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `fontFamily?: string`
- `fontSize?: number`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`InlineAnnotation` / `InlineRubyAnnotation`**:

- `kind: 'ruby' | 'emphasis' | 'tcy' | 'em' | 'strong' | 'link' | 'footnote'`
- `startIndex: number`
- `endIndex: number`
- Ruby variant: `rubyText: string`, `type?: 'mono' | 'group' | 'jukugo'`, `jukugoSplitPoints?: number[]`

`RubyInputAnnotation` remains as a deprecated alias of `InlineRubyAnnotation`.

---

## `@libraz/mejiro/epub` — EPUB Parsing and Authoring

| Export | Signature |
|---|---|
| `parseEpub` | `(buffer: ArrayBuffer) => Promise<EpubBook>` |
| `parseEditableEpub` | `(buffer: ArrayBuffer) => Promise<EditableEpub>` |
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
- `inlineAnnotations: readonly InlineAnnotation[]`
- `headingLevel?: number`

**`EditableBlock`**:

- Paragraph block: `{ kind: 'paragraph'; id; text; inlineAnnotations; paragraphKind?; headingLevel? }`
- Image block: `{ kind: 'image'; id; assetKey; alt?; caption?; placement? }`

**`EpubProjectMetadata`** includes `title`, `subtitle`, `description`, `language`, `identifier`, `publisher`, `rights`, `date`, `modified`, `creators`, `contributors`, `subjects`, `series`, `collections`, and legacy `author`.

---

## `@libraz/mejiro/render` — Render Data

| Export | Signature |
|---|---|
| `buildParagraphMeasures` | `(entries: RenderEntry[], options: MeasureOptions) => ParagraphMeasure[]` |

Computes paragraph measures for pagination.

| Export | Signature |
|---|---|
| `buildRenderPage` | `(slices: PageSlice[], entries: RenderEntry[]) => RenderPage` |
| `renderEpubStatic` | `(chapter: { paragraphs: BookParagraph[] }, options?: RenderEpubStaticOptions) => string` |
| `buildLineMetrics` | `(entries: RenderEntry[], options: MeasureOptions) => LineMetricsResult` |
| `packPageLines` | `(metrics: LineMetric[], startIdx: number, pageWidth: number) => number` |
| `buildColumnSlots` | `(metrics: LineMetric[], startIdx: number, count: number, columnHeight: number) => ColumnSlot[]` |
| `adjustExclusionSlots` | `(slots: ColumnSlot[], metrics: LineMetric[], startIdx: number, basePitch: number) => ColumnSlot[]` |
| `getImageXOffset` | `(offsets: Float32Array, spreadStartLine: number, col: number) => number` |
| `findPhysicalColumn` | `(offsets: Float32Array, spreadStartLine: number, fromRight: number, basePitch: number) => number` |

Converts page slices + entries into a renderable page structure. `renderEpubStatic`
returns framework-agnostic HTML for a single chapter, suitable for SSR fallback
markup before the client reader hydrates.
The metric/slot helpers are low-level utilities for slot-based rendering and image-exclusion layout.

### CSS

```ts
import '@libraz/mejiro/render/mejiro.css';
import '@libraz/mejiro/render/mejiro-reader.css';
import '@libraz/mejiro/render/mejiro-editor.css';
import '@libraz/mejiro/render/mejiro-print.css';
```

### Types

**`RenderEntry`**:

- `chars: string[]`
- `breakPoints: Uint32Array`
- `inlineAnnotations: readonly InlineAnnotation[]`
- `isHeading: boolean`
- `kind?: ParagraphKind`

**`RenderPage`**:

- `paragraphs: RenderParagraph[]`

**`RenderParagraph`**:

- `lines: RenderLine[]`
- `isHeading: boolean`
- `headingLevel?: number`

**`RenderLine`**:

- `segments: RenderSegment[]`

**`RenderSegment`**:

- `{ type: 'text'; text: string }`
- `{ type: 'ruby'; base: string; rubyText: string }`
- `{ type: 'emphasis'; text: string; style: 'sesame' | 'dot' | 'circle' }`
- `{ type: 'tcy'; text: string }`
- `{ type: 'em'; text: string }`
- `{ type: 'strong'; text: string }`
- `{ type: 'link'; text: string; href: string; title?: string }`
- `{ type: 'footnote-ref'; text: string; noteId: string }`

**`MeasureOptions`**:

- `fontSize: number`
- `lineHeight: number`
- `headingScale?: number` (default: 1.4)
- `paragraphGapEm?: number` (default: 0.4)
- `headingGapEm?: number` (default: 1.2)

---

## `@libraz/mejiro/book` — High-Level API

The recommended entry point for most applications. Orchestrates font loading, layout, pagination, and image exclusion in a simple class-based API.

### Constants

| Export | Description |
|---|---|
| `DEFAULT_HEADING_STYLES` | Default heading style overrides for levels 1–4 (`{ 1: { scale: 1.6, gapAfterEm: 1.4 }, ... }`) |
| `DEFAULT_BOOK_OPTIONS` | Default font, spacing, kinsoku, and heading options |
| `DEFAULT_PAGE_GEOMETRY` | Default page size/line width before container measurement |
| `DEFAULT_PAGE_PADDING` | Default page padding values in pixels (`{ x: 52, y: 56, bottom: 40 }`) |

### MejiroBook

**`MejiroBook`** — Main orchestrator class:

- `constructor(options: BookOptions)` — Create with font, spacing, and heading configuration
- `setOptions(options: Partial<BookOptions>): Promise<void>` — Update options and propagate changes to live layouts. Font family / size changes re-measure asynchronously; other option changes apply synchronously.
- `setPageSize(size: PageSize): void` — Set page geometry (must be called before `layoutChapter`)
- `computePageSize(container: HTMLElement, options?: ComputePageSizeOptions): { pageWidth, pageHeight, contentHeight }` — Compute page dimensions from a container element and apply them via `setPageSize`. Uses a 1.45 aspect ratio with min 280×400, max height 780, default padding, and overridable header/gutter reservations.
- `layoutChapter(chapter: { paragraphs: BookParagraph[] }): Promise<ChapterLayout>` — Lay out a chapter (compatible with `EpubChapter`)
- `layoutFromSnapshot(snapshot: ChapterLayoutSnapshot): ChapterLayout` — Restore a layout snapshot without measuring again
- `clearCache(fontKey?: string): void` — Clear the character width measurement cache

### ChapterLayout

**`ChapterLayout`** — Manages pagination and image exclusion for a laid-out chapter:

- `totalPages: number` — Total page count (getter, triggers lazy computation)
- `hasImages: boolean` — Whether any spread has image exclusions
- `resize(size: Partial<PageSize> & { lineSpacing?: number }): void` — Update geometry; re-breaks lines if `lineWidth` changes
- `setImages(spreadIndex: number, images: BookImage[]): void` — Set image exclusions for a spread (empty array removes)
- `clearImages(): void` — Remove all image exclusions
- `syncImages(spreadIndex: number, images?: BookImage[]): SpreadResult` — Set images for a spread, or clear that spread when `images` is empty/omitted, then return the updated spread
- `getSpread(spreadIndex: number): SpreadResult` — Get layout data for a two-page spread
- `getPage(pageIndex: number): PageResult` — Get layout data for a single page
- `findText(query: string | RegExp, options?: FindTextOptions): SearchMatch[]` — **Scope is the current `ChapterLayout` only.** Walks the chapter's paragraphs and returns hits as `SearchMatch` (an `AnchorLocation` extended with the match length, etc.). For cross-chapter or cross-book search (e.g. a novel-site search index), keep an external full-text index server-side (Meilisearch / Elasticsearch / pg_trgm / SQLite FTS5) and hand the resolved anchors to `MejiroReaderHandle.goToAnchor()` to navigate to the hit.
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

- `fontFamily: string` — CSS font family
- `fontSize: number` — Base font size (px)
- `lineSpacing?: number` — Line spacing multiplier (default: 1.8)
- `mode?: 'strict' | 'loose'` — Kinsoku mode (default: `'strict'`)
- `enableHanging?: boolean` — Hanging punctuation (default: `true`)
- `headingStyles?: Record<number, HeadingStyle>` — Per-level heading overrides
- `headingScale?: number` — Default heading scale (default: 1.4)

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

---

## `@libraz/mejiro/image` — Image Helpers

| Export | Signature |
|---|---|
| `prepareImage` | `(file: Blob, options?: PrepareImageOptions) => Promise<PrepareImageResult>` |

Decodes a browser image file, optionally downscales it, re-encodes it, and returns binary data plus dimensions for EPUB embedding.

---

## `@libraz/mejiro-react` — React Component

```bash
npm install @libraz/mejiro @libraz/mejiro-react react
npm install -D @types/react
```

Peer dependencies: `react >= 18`; TypeScript projects should install `@types/react >= 18` matching their React version.

Main components: `MejiroReader`, `MejiroEditor`, `MejiroManuscriptEditor`, `MejiroNotationHighlighter`, `MejiroShelf`, `MejiroToc`, `MejiroScrollView`, `MejiroSelectionLayer`, `MejiroPageView`, `MejiroPage`, `MejiroSpread`, `MejiroSettingsPanel`, `MejiroChapterNav`, `MejiroStats`, `MejiroDropZone`, and `MejiroImageOverlay`.

Hooks: `useEpub`, `useEditableEpub`, `useEpubProject`, `useLibrary`, `useManuscriptDraft`, `useManuscriptLayout`, `useAnnotations`, `useMejiroBook`, `useChapterLayout`, `useSpread`, `useReadingPosition`, `useI18n`, `useImageOverlay`, and `useMultiImageOverlay`.

Common headless editor returns:

- `useEditableEpub({ defaultUrl?, onLoad?, onError?, onExport? })` returns `editor`, `book`, `previewBook`, `loading`, `exporting`, `error`, `revision`, `history`, `selection`, `selectedParagraph`, `setSelection`, `loadBuffer`, `loadFile`, `loadUrl`, `updateParagraph`, `setInlineAnnotations`, `addImage({ filename, data, ... })`, `undo`, `redo`, and `exportEpub(options?)`.
- `useEpub({ defaultUrl?, onLoad?, onError?, fetchOptions?, fetchEpub? })` returns `epub`, `loading`, `error`, `loadBuffer`, `loadFile`, `loadUrl`, and `setEpub`.
- `useEpubProject({ metadata?, chapters?, debounceMs?, onPreview?, onExport? })` returns project metadata/chapter state plus `setMetadata`, `setChapters`, `setSelectedChapter`, `addChapter`, `removeChapter`, `patchChapter`, `reorderChapters`, `previewBook`, `previewError`, `previewing`, `buildProject`, and `exportEpub`.
- `useManuscriptDraft({ initialChapters?, onAutosave?, autosaveDelay? })` returns draft chapter state plus add/remove/reorder/patch helpers.
- `useManuscriptLayout(book, chapter, surfaceRef, { dialect?, enableResize?, resizeDebounce? })` lays out a single manuscript chapter directly, with no EPUB ZIP round-trip. Returns `{ layout, pageWidth, pageHeight, contentHeight, elapsedMs, recompute }` (same shape as `useChapterLayout`). Designed for live preview surfaces.
- `useAnnotations({ key, storage?, throttleMs?, onChange? })` persists highlights / bookmarks / comments. Returns `{ annotations, add, remove, update, clear }`. `storage` follows the same `getItem` / `setItem` / `removeItem` interface as `useReadingPosition`. `onChange(next)` fires synchronously after `add` / `remove` / `update` / `clear` (skipped on initial hydration and no-ops) — handy for forwarding each mutation to a server.
- `useReadingPosition({ key, storage?, throttleMs?, onChange? })` exposes the same `onChange(next | null)` hook, fired right after `save` / `clear`.

**`MejiroReader` manuscript source** -- A fourth source mode alongside `epub` / `epubUrl`. Pass `manuscript: ManuscriptChapter[]` plus `dialect?: ManuscriptDialect` and the Reader renders the chapters directly, skipping the EPUB ZIP entirely.

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

---

## `@libraz/mejiro-vue` — Vue Component

```bash
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

Peer dependency: `vue >= 3.3`.

Main components and composables mirror the React package: `MejiroReader`, `MejiroEditor`, `MejiroManuscriptEditor`, `MejiroNotationHighlighter`, `MejiroShelf`, `MejiroToc`, `MejiroScrollView`, `MejiroSelectionLayer`, page/spread/chrome components, and `useEpub` / `useEditableEpub` / `useEpubProject` / `useLibrary` / `useManuscriptDraft` / `useManuscriptLayout` / `useAnnotations` / `useMejiroBook` / `useChapterLayout` / `useSpread` / `useReadingPosition` / `useI18n` / `useImageOverlay` / `useMultiImageOverlay`.

Public component prop types are exported for the same component set, including `MejiroReaderProps`, `MejiroEditorProps`, `MejiroManuscriptEditorProps`, `MejiroPageViewProps`, `MejiroSpreadProps`, `MejiroSettingsPanelProps`, and the other `Mejiro*Props` aliases.

The Vue composables expose the same operations as the React hooks. Reactive state is returned as `Ref` / `ComputedRef` values.

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

---

[Back to documentation index](./README.md)
