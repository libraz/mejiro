# @libraz/mejiro

Japanese vertical text layout engine — line breaking, kinsoku shori, and hanging punctuation for the web.

## Install

```bash
npm install @libraz/mejiro
# or
yarn add @libraz/mejiro
# or
pnpm add @libraz/mejiro
# or
bun add @libraz/mejiro
```

## Quick Start

```ts
import { MejiroBrowser } from '@libraz/mejiro/browser';

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

// Preload font (uses instance defaults)
await mejiro.preloadFont();

// Compute effective line width for vertical layout
const lineWidth = mejiro.verticalLineWidth(containerHeight);

// Layout a single paragraph
const result = await mejiro.layout({ text: '吾輩は猫である。', lineWidth });

// Layout an entire chapter
const chapter = await mejiro.layoutChapter({
  paragraphs: [{ text: '吾輩は猫である。' }, { text: '名前はまだ無い。' }],
  lineWidth,
});
```

## Units

All dimensional parameters — `fontSize`, `lineWidth`, `containerHeight`, advances, etc. — are in **CSS pixels (px)**. This matches the unit returned by `Canvas.measureText()` and used by CSS layout.

## Subpath Exports

| Import path | Description |
|---|---|
| `@libraz/mejiro` | Core layout engine (zero dependencies, no DOM required) |
| `@libraz/mejiro/browser` | Font loading, measurement, and browser integration |
| `@libraz/mejiro/epub` | EPUB parsing — extracts text and ruby annotations |
| `@libraz/mejiro/render` | Converts layout results into framework-agnostic render data + CSS |
| `@libraz/mejiro/book` | High-level API — `MejiroBook` + `ChapterLayout` for layout, pagination, and image exclusion |

## API Overview

### `MejiroBrowser`

Main browser integration class. Manages font loading, width caching, and layout.

- **`constructor(options?)`** — `fixedFontFamily` / `fixedFontSize` set defaults for all methods.
- **`layout(options)`** — Compute line breaks for a single text. `fontFamily` / `fontSize` fall back to instance defaults.
- **`layoutChapter(options)`** — Lay out multiple paragraphs. `fontFamily` / `fontSize` fall back to instance defaults.
- **`preloadFont(fontFamily?, fontSize?)`** — Preload a font. Falls back to instance defaults.
- **`verticalLineWidth(containerHeight, fontSize?)`** — Effective line width for vertical text. Falls back to instance `fixedFontSize`.
- **`clearCache(fontKey?)`** — Clear the width measurement cache.

### `layoutText(options)`

Standalone one-shot layout function. Creates its own font loader and measurer — no `MejiroBrowser` instance needed. All parameters are required.

### `verticalLineWidth(containerHeight, fontSize)`

Standalone function to compute effective vertical line width with a safety margin.

## License

MIT
