# @libraz/mejiro

[![npm version](https://img.shields.io/npm/v/@libraz/mejiro.svg)](https://www.npmjs.com/package/@libraz/mejiro)
[![license](https://img.shields.io/npm/l/@libraz/mejiro.svg)](https://github.com/libraz/mejiro/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@libraz/mejiro)](https://bundlephobia.com/package/@libraz/mejiro)

Japanese vertical text layout engine — line breaking, kinsoku shori, hanging punctuation, ruby, and image exclusion for the web.

## Install

```bash
npm install @libraz/mejiro
```

## Quick Start

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
book.computePageSize(document.querySelector('.reader')!);

// Layout an EPUB chapter
const epub = await parseEpub(epubBuffer);
const layout = await book.layoutChapter(epub.chapters[0]);

// Get a two-page spread
const spread = layout.getSpread(0);
// spread.right / spread.left → PageResult with page, lines, slots

// Image exclusion with text reflow
const updated = layout.syncImages(0, [{ x: 80, y: 100, w: 120, h: 160 }]);
```

## Subpath Exports

| Import path | Description |
|---|---|
| `@libraz/mejiro` | Core layout engine (zero dependencies, no DOM required) |
| `@libraz/mejiro/browser` | Font loading, measurement, and browser integration |
| `@libraz/mejiro/epub` | EPUB parsing — extracts text and ruby annotations |
| `@libraz/mejiro/render` | Converts layout results into framework-agnostic render data + CSS |
| `@libraz/mejiro/book` | High-level API — `MejiroBook`, `ChapterLayout`, `DEFAULT_HEADING_STYLES`, `DEFAULT_PAGE_PADDING` |

## Key APIs

| API | Description |
|-----|-------------|
| `MejiroBook` | Orchestrates font loading, layout, pagination, and image exclusion |
| `book.computePageSize(el)` | Auto-compute page dimensions from a container element |
| `book.layoutChapter(ch)` | Layout a chapter → `ChapterLayout` |
| `layout.getSpread(n)` | Get two-page spread data → `SpreadResult` |
| `layout.syncImages(n, imgs)` | Set images and get updated spread with text reflow |
| `layout.resize(size)` | Resize pages (responsive layout) |
| `DEFAULT_HEADING_STYLES` | Pre-configured heading styles for levels 1–4 |
| `DEFAULT_PAGE_PADDING` | Default page padding `{ x: 52, y: 56, bottom: 40 }` |

For the complete API reference including low-level APIs (`computeBreaks`, `ExclusionEngine`, `MejiroBrowser`), see the [documentation](https://github.com/libraz/mejiro/tree/main/docs/en/10-api-reference.md).

## Framework Components

| Package | Description |
|---------|-------------|
| [`@libraz/mejiro-react`](https://www.npmjs.com/package/@libraz/mejiro-react) | `<MejiroPageView>` component + `useImageOverlay` hook |
| [`@libraz/mejiro-vue`](https://www.npmjs.com/package/@libraz/mejiro-vue) | `<MejiroPageView>` component + `useImageOverlay` composable |

## License

[Apache License 2.0](https://github.com/libraz/mejiro/blob/main/LICENSE)
