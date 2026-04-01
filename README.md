# mejiro

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/mejiro/ci.yml?branch=main&label=CI)](https://github.com/libraz/mejiro/actions)
[![npm](https://img.shields.io/npm/v/@libraz/mejiro)](https://www.npmjs.com/package/@libraz/mejiro)
[![codecov](https://codecov.io/gh/libraz/mejiro/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/mejiro)
[![License](https://img.shields.io/github/license/libraz/mejiro)](https://github.com/libraz/mejiro/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)

Japanese vertical text layout engine for the web. Handles line breaking, kinsoku shori (禁則処理), hanging punctuation, ruby (furigana) preprocessing, image exclusion (text wrapping), and pagination — all with zero DOM dependencies in the core.

<p align="center">
  <img src="docs/images/wagahai.jpg" alt="mejiro demo — Natsume Soseki &quot;I Am a Cat&quot; rendered in vertical text" width="640">
</p>

## Installation

```bash
npm install @libraz/mejiro   # or yarn / pnpm / bun
```

## Overview

mejiro provides the building blocks for rendering Japanese vertical text (`writing-mode: vertical-rl`) in the browser. The core engine operates on typed arrays and pure math, making it fast, deterministic, and portable. Browser-specific concerns (font measurement, Canvas API) live in a separate subpath, and EPUB parsing is available as a third.

```
@libraz/mejiro          Core: line breaking, kinsoku, hanging, ruby, image exclusion, pagination
@libraz/mejiro/browser  Browser: font measurement, width caching, layout integration
@libraz/mejiro/epub     EPUB: parsing, ruby extraction
@libraz/mejiro/render   Render: layout data → framework-agnostic page structure + CSS
@libraz/mejiro/book     Book: high-level API — layout, pagination, image exclusion in one class
```

## Architecture

```
Application (React / Vue / vanilla DOM)
       ↓
  @libraz/mejiro/book     High-level: MejiroBook → layout, paginate, image exclusion
       ↓
  @libraz/mejiro/render   Layout data → RenderPage structure + CSS
       ↓
  @libraz/mejiro/epub     EPUB → text + ruby annotations
       ↓
  @libraz/mejiro/browser  Font measurement + ruby font derivation
       ↓
  @libraz/mejiro          Line breaking + kinsoku + hanging + ruby + pagination
```

- **Core** has zero external dependencies
- **Browser** uses Canvas and FontFace APIs
- **EPUB** depends on `jszip`
- **Render** converts layout results into a framework-agnostic `RenderPage` data structure
- **Book** orchestrates all layers into a simple `MejiroBook` → `ChapterLayout` → `SpreadResult` workflow

## Quick Start

```ts
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { getLineRanges, paginate } from '@libraz/mejiro';

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

### EPUB + MejiroBook (Recommended)

```ts
import { MejiroBook } from '@libraz/mejiro/book';
import { verticalLineWidth } from '@libraz/mejiro/browser';
import { parseEpub } from '@libraz/mejiro/epub';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: { 1: { scale: 1.6, gapAfterEm: 1.4 } },
});

book.setPageSize({
  pageWidth: 400,
  lineWidth: verticalLineWidth(600, 16),
});

const epub = await parseEpub(epubArrayBuffer);
const layout = await book.layoutChapter(epub.chapters[0]);

// Get a two-page spread
const spread = layout.getSpread(0);
// spread.right.page → RenderPage (paragraphs → lines → segments)
// spread.right.lines / spread.right.slots → for absolute positioning
// spread.totalPages → total page count

// Place images with text wrapping
layout.setImages(0, [{ x: 80, y: 100, w: 120, h: 160 }]);
const updated = layout.getSpread(0); // reflow-aware result
```

## API

For the complete API reference, see [API Reference](docs/en/10-api-reference.md).
For detailed guides with examples, see [Documentation](docs/en/).

| Subpath | Description |
|---|---|
| `@libraz/mejiro` | Core: `computeBreaks()`, `ExclusionEngine`, `toCodepoints()`, kinsoku, hanging, ruby, pagination |
| `@libraz/mejiro/browser` | Browser: `MejiroBrowser` class, font measurement, width caching |
| `@libraz/mejiro/epub` | EPUB: `parseEpub()`, ruby extraction |
| `@libraz/mejiro/render` | Render: `buildRenderPage()`, `buildParagraphMeasures()`, `mejiro.css` |
| `@libraz/mejiro/book` | Book: `MejiroBook`, `ChapterLayout` — high-level layout, pagination, and image exclusion |
| `@libraz/mejiro-react` | React: `<MejiroPage>` component (experimental) |
| `@libraz/mejiro-vue` | Vue: `<MejiroPage>` component (experimental) |

## Kinsoku Shori (禁則処理)

Kinsoku shori is a set of Japanese typographic rules that prohibit certain characters from appearing at the start or end of a line, defined in [JIS X 4051](https://www.jisc.go.jp/app/jis/general/GnrJISNumberNameSearchList?show&jisStdNo=X4051) and [JLREQ](https://www.w3.org/TR/jlreq/).

mejiro implements these rules with two modes:

- **Strict** (default) — Prohibits closing brackets, punctuation, small kana, long vowel mark, and iteration marks at line start. Prohibits opening brackets at line end.
- **Loose** — Same as strict, but allows small kana and the long vowel mark (`ー`) at line start. Useful for narrow columns.

**Hanging punctuation** (`。` `、` `，` `．`) can protrude past the line end rather than being pushed to the next line.

Custom kinsoku rules can be passed via `LayoutInput.kinsokuRules` when using the core `computeBreaks()` API directly. See [Line Breaking](docs/en/03-line-breaking.md) for the full character lists, JIS X 4051 / JLREQ conformance table, and custom rules examples.

## Design Decisions

- **TypedArray-based core** — `Uint32Array` for codepoints, `Float32Array` for advances. No string manipulation in the hot path.
- **O(n) line breaking** — Single-pass greedy algorithm with backtracking for kinsoku. No dynamic programming overhead.
- **Ruby as preprocessing** — Ruby annotations are resolved to effective advances and cluster IDs before the main loop, keeping the algorithm unchanged.
- **Image exclusion** — `ExclusionEngine` and `SpreadExclusionEngine` compute per-column text placement around arbitrarily placed images across single pages or two-page spreads, with automatic gutter handling and real-time drag-and-drop support.
- **Deterministic** — Same input always produces the same output.
- **Separation of concerns** — Core is pure math (no DOM, no Canvas). Browser layer handles measurement. EPUB layer handles parsing. Render layer produces framework-agnostic data; final DOM output is the consumer's responsibility.

## License

[Apache License 2.0](LICENSE)

## Authors

- libraz <libraz@libraz.net>

