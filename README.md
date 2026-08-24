# mejiro

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/mejiro/ci.yml?branch=main&label=CI)](https://github.com/libraz/mejiro/actions)
[![npm](https://img.shields.io/npm/v/@libraz/mejiro)](https://www.npmjs.com/package/@libraz/mejiro)
[![codecov](https://codecov.io/gh/libraz/mejiro/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/mejiro)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/mejiro/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)

**mejiro breaks Japanese vertical text the way a typesetter would, and hands you
the result as data.** Give it a string or an EPUB and get back line breaks that
honour kinsoku shori, hanging punctuation, ruby and tate-chu-yoko, laid out into
pages you render however you like. The core engine is arithmetic over typed
arrays — no DOM, no Canvas, no dependencies — so the same breaks come out in a
browser, in Node, and during server-side rendering.

**Reach for it when you need to:**

- **Break Japanese lines correctly** — JIS X 4051 / JLREQ kinsoku, hanging punctuation, ruby that never clips its base text, tate-chu-yoko runs that never split across a column.
- **Read and write EPUB** — parse a file into text plus inline annotations, edit it in place and write it back, or author one from a plain-text manuscript. Untrusted archives are bounded by resource limits.
- **Wrap text around images** — per-column exclusion across a single page or a two-page spread, recomputed live while the reader drags the image.
- **Ship a reader or an editor** — React and Vue components sit on the same engine; take the hooks instead and render the pages yourself.

📖 **[Documentation](docs/en/)** &nbsp;·&nbsp; **[Getting started](docs/en/01-getting-started.md)** &nbsp;·&nbsp; **[API reference](docs/en/10-api-reference.md)**

<p align="center">
  <img src="docs/images/wagahai.jpg" alt="mejiro demo — Natsume Soseki &quot;I Am a Cat&quot; rendered in vertical text" width="640">
</p>

## What can you build with it?

Vertical readers and manuscript editors, in the browser or pre-rendered on a
server. `examples/` holds runnable starters for each shape — a paginated reader,
a spread-based EPUB editor, a manuscript authoring tool, a bookshelf, a headless
setup that uses only the hooks, and an iframe embed with no framework at all.
Each starter is a workspace member, so copy it out before installing:

```bash
npx degit libraz/mejiro/examples/react my-reader
```

The copied `package.json` still carries `workspace:*` versions; each starter's
README has the one-liner that pins them to the published release.

## What's inside

| Subpath | Description |
|---|---|
| `@libraz/mejiro` | Core: `computeBreaks()`, kinsoku, hanging punctuation, `preprocessRuby()`, `preprocessTcy()` (tate-chu-yoko), `normalizeText()` NFC normalization, `ExclusionEngine`, `paginate()`, reading-position persistence |
| `@libraz/mejiro/browser` | Browser: `MejiroBrowser`, font measurement and width caching, ruby font derivation, `createOverlayDragSession()` for image drag and resize |
| `@libraz/mejiro/epub` | EPUB: `parseEpub()` with `EpubParseOptions.limits` for untrusted input, `EditableEpub`, `cloneEditableEpubBook()`, `EpubProject`, `parseManuscript()` |
| `@libraz/mejiro/render` | Render: `buildRenderPage()`, `buildParagraphMeasures()`, `segmentToInlineNode()`, `paragraphClassName()`, `renderEpubStatic()`, and the `mejiro.css` / `mejiro-reader.css` / `mejiro-editor.css` / `mejiro-fonts.css` / `mejiro-print.css` stylesheets |
| `@libraz/mejiro/book` | Book: `MejiroBook`, `ChapterLayout`, `estimateReadingTime()` — layout, pagination, image exclusion, text search, anchors and snapshots in one class |
| `@libraz/mejiro/image` | `prepareImage(file, opts?)` — decode, downscale and re-encode before embedding |
| `@libraz/mejiro/analysis` | `createSuzumeAnalyzer()` — the optional morphological analyzer behind analysis-driven line breaking |
| `@libraz/mejiro-react` | React: `<MejiroReader>`, `<MejiroEditor>`, `<MejiroManuscriptEditor>`, `<MejiroShelf>`, `<MejiroToc>`, `<MejiroPage>` and the `useEpub` / `useMejiroBook` / `useChapterLayout` / `useSpread` / `useReadingPosition` / `useAnnotations` hooks |
| `@libraz/mejiro-vue` | Vue: the same component and composable set as React |

The React and Vue packages are experimental — the hooks and low-level components
are the primary API, and the composed components are their reference
implementation.

## Installation

```bash
npm install @libraz/mejiro                     # core, browser, EPUB, render, book, image
npm install @libraz/mejiro-react react react-dom   # React components (experimental)
npm install @libraz/mejiro-vue vue                 # Vue components (experimental)
```

## Quick start

### Core layout

```ts
import { getLineRanges, paginate } from '@libraz/mejiro';
import { MejiroBrowser } from '@libraz/mejiro/browser';

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

const text = '吾輩は猫である。名前はまだ無い。';

// 1. Lay out text (fontFamily/fontSize use instance defaults)
const result = await mejiro.layout({
  text,
  lineWidth: mejiro.verticalLineWidth(600), // effective line width from container height
});

// 2. Get line ranges → [[start, end), ...]
const lines = getLineRanges(result.breakPoints, text.length);

// 3. Paginate into pages of 400px width
const pages = paginate(400, [
  { lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 },
]);
```

### EPUB + MejiroBook

`MejiroBook` is the high-level entry point: it owns measurement, breaking and
pagination, so a reader only deals in chapters and spreads.

```ts
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

// Auto-compute page size from a container element
book.computePageSize(document.querySelector('.reading-surface')!);

const epub = await parseEpub(epubArrayBuffer);
const layout = await book.layoutChapter(epub.chapters[0]);

// Get a two-page spread
const spread = layout.getSpread(0);
// spread.right.page → RenderPage (paragraphs → lines → segments)
// spread.right.lines / spread.right.slots → for absolute positioning
// spread.totalPages → total page count

// Place images with text wrapping (returns updated spread)
const updated = layout.syncImages(0, [{ x: 80, y: 100, w: 120, h: 160 }]);
```

### React

```tsx
import { MejiroReader } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro-reader.css';

<MejiroReader file={epubFile} theme="sepia" />;
```

Vue exposes the same component under `@libraz/mejiro-vue`. See the
[React / Vue guide](docs/en/08-react-and-vue.md) for props, theming, controlled
usage and SSR.

## Japanese typography

**Kinsoku shori** (禁則処理) keeps certain characters off the start or end of a
line, as defined in [JIS X 4051](https://www.jisc.go.jp/app/jis/general/GnrJISNumberNameSearchList?show&jisStdNo=X4051)
and [JLREQ](https://www.w3.org/TR/jlreq/). Two modes ship:

- **Strict** (default) — closing brackets, punctuation, small kana, the long vowel mark and iteration marks never start a line; opening brackets never end one.
- **Loose** — strict, except small kana and `ー` may start a line. Useful for narrow columns.

**Hanging punctuation** lets `。` `、` `，` `．` protrude past the line end
instead of being pushed to the next line.

**Ruby** is resolved before line breaking: each annotated span reserves the wider
of its base text and its reading, so a reading can never be clipped by the line
it sits on. **Tate-chu-yoko** collapses a horizontal run inside a vertical
column into one upright box that the breaker treats as indivisible.

**Analysis-driven breaking** is optional and off by default. Install the
optional peer dependency `@libraz/suzume` and mejiro can derive break hints from
a morphological analysis: the first stage leaves break positions as the
character-class rules chose them and only stops the ones that would split a unit
it is a typesetting error to split, and a second stage adds per-position
penalties that do move break positions. It is not "break at word boundaries" —
Japanese body text is set by breaking wherever kinsoku allows, and word-edge
breaks alone leave loose lines. The analyzer costs roughly 567 KB of WebAssembly
with its dictionaries embedded, about 230 KB gzipped; without it everything else
works unchanged.

Custom kinsoku rules go through `LayoutInput.kinsokuRules` on the core
`computeBreaks()` API. [Line breaking](docs/en/03-line-breaking.md) has the full
character lists, the conformance table and worked examples.

## Architecture

<p align="center">
  <img src="docs/assets/architecture-layers-en.svg" alt="mejiro layer diagram — book, epub and image sit over render, which sits over browser and the core engine" width="640">
</p>

- **Core** — line breaking, kinsoku, hanging, ruby and tate-chu-yoko preprocessing, image exclusion. Zero dependencies, no DOM.
- **Browser** — font measurement over Canvas and the FontFace API, ruby font derivation, overlay drag sessions.
- **Render** — turns layout results into a framework-agnostic `RenderPage` structure plus the shipped stylesheets.
- **Book** and **EPUB** are siblings over render, not a stack: `MejiroBook` orchestrates measurement, breaking and pagination, while the EPUB layer parses and authors files (its only external dependency is `jszip`). Neither imports the other.
- **Image** stands alone — it prepares images for placement and is usable on its own.

## Documentation

Guides and the full API reference live in [`docs/en/`](docs/en/)
([日本語](docs/ja/)).

- **Learn** — [Getting started](docs/en/01-getting-started.md) · [Core concepts](docs/en/02-core-concepts.md) · [Line breaking](docs/en/03-line-breaking.md) · [Ruby](docs/en/04-ruby.md)
- **Build** — [Browser integration](docs/en/05-browser-integration.md) · [EPUB](docs/en/06-epub.md) · [Pagination and rendering](docs/en/07-pagination-and-rendering.md) · [React and Vue](docs/en/08-react-and-vue.md)
- **Details** — [Advanced](docs/en/09-advanced.md) · [API reference](docs/en/10-api-reference.md)

## Design decisions

- **TypedArray core** — `Uint32Array` for codepoints, `Float32Array` for advances. No string manipulation in the hot path.
- **O(n) line breaking** — a single-pass greedy algorithm with backtracking for kinsoku, not dynamic programming.
- **Ruby and tate-chu-yoko as preprocessing** — both resolve to effective advances and cluster IDs before the main loop, so the breaking algorithm itself stays unchanged.
- **Deterministic** — the same input always produces the same output, which is what makes server-side rendering and snapshot replay possible.
- **Separation of concerns** — the core is pure arithmetic, the browser layer measures, the EPUB layer parses and authors, and the render layer emits data. Producing the final DOM is the caller's job.

## Non-goals

mejiro lays out text; it does not draw it. There is no renderer of its own, no
horizontal-writing layout engine, no font file parsing (measurement goes through
Canvas), and no PDF or print pipeline beyond the stylesheet. EPUB support
targets what a vertical Japanese reader needs rather than the whole
specification — fixed-layout EPUB, audio overlays and DRM are out of scope. The
React and Vue packages are reference implementations of the hooks, not a design
system.

## Security

Report vulnerabilities through [`SECURITY.md`](SECURITY.md), not the public
issue tracker. EPUB parsing accepts untrusted archives and bounds them with
`EpubParseOptions.limits`; the defaults are in
[`DEFAULT_EPUB_PARSE_LIMITS`](docs/en/06-epub.md).

## License

[Apache-2.0](LICENSE)
