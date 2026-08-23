# Getting Started

This guide walks you through installing mejiro and rendering your first vertical Japanese text. The recommended approach uses the high-level `MejiroBook` API, which handles font loading, line breaking, pagination, and rendering in just a few steps. Framework-specific components are available for React and Vue, and a headless core is available for use without browser APIs.

## Installation

Install the core package:

```bash
# npm
npm install @libraz/mejiro

# yarn
yarn add @libraz/mejiro

# pnpm
pnpm add @libraz/mejiro

# bun
bun add @libraz/mejiro
```

If you are using React or Vue, install the corresponding component package as well:

```bash
# React
npm install @libraz/mejiro @libraz/mejiro-react react
npm install -D @types/react

# Vue
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

For React, TypeScript projects should install `@types/react >= 18` matching their React version.
For Vue, the peer dependency is `vue >= 3.3`.

## Quick Start: EPUB Reader (Recommended)

This example uses `MejiroBook` to load an EPUB file, lay out a chapter with heading styles, and render a two-page spread. This is the simplest way to get started with mejiro.

```ts
import { MejiroBook, DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import '@libraz/mejiro/render/mejiro.css';

// 1. Create a MejiroBook instance
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

// 2. Compute page size from a container element
const container = document.getElementById('reader')!;
const { pageWidth, pageHeight } = book.computePageSize(container);

// 3. Load and parse an EPUB file
const response = await fetch('/book.epub');
const epub = await parseEpub(await response.arrayBuffer());

// 4. Lay out the first chapter
const layout = await book.layoutChapter(epub.chapters[0]);

// 5. Get a two-page spread (right page + left page)
const spread = layout.getSpread(0);

// spread.right  — PageResult for the right page
// spread.left   — PageResult for the left page
// spread.totalPages — total page count

// 6. Render with DOM (example for the right page)
const pageEl = document.createElement('div');
pageEl.style.width = `${pageWidth}px`;
pageEl.style.height = `${pageHeight}px`;
pageEl.style.writingMode = 'vertical-rl';
pageEl.style.fontFamily = '"Noto Serif JP", serif';
pageEl.style.fontSize = '16px';
pageEl.style.lineHeight = '1.8';

for (const para of spread.right.page.paragraphs) {
  const p = document.createElement('p');
  if (para.isHeading) p.style.fontWeight = '700';
  for (const line of para.lines) {
    for (const seg of line.segments) {
      // Resolves every segment type: ruby, emphasis, tate-chu-yoko, em, strong,
      // links and footnote references, including nested annotations.
      appendInlineNode(p, segmentToInlineNode(seg));
    }
  }
  pageEl.appendChild(p);
}

container.appendChild(pageEl);
```

`segmentToInlineNode()` comes from `@libraz/mejiro/render` and returns a small
framework-agnostic element description; turning that into DOM takes a dozen lines:

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

Do not branch on `seg.type` with a two-way `text` / ruby split: a normal Japanese book
also produces emphasis, tate-chu-yoko, link and footnote-reference segments, which such a
branch would render as `<ruby>undefined<rt>undefined</rt></ruby>`. See
[Pagination & Rendering](07-pagination-and-rendering.md) for the full segment table.

You can also lay out plain text paragraphs without an EPUB file:

```ts
const layout = await book.layoutChapter({
  paragraphs: [
    { text: '吾輩は猫である。', headingLevel: 1 },
    { text: '名前はまだ無い。どこで生れたかとんと見当がつかぬ。' },
  ],
});
```

### Key APIs

| API | Description |
|-----|-------------|
| `new MejiroBook({ fontFamily, fontSize, lineSpacing, headingStyles })` | Create a layout engine with typographic options |
| `book.computePageSize(container)` | Auto-compute page dimensions from a DOM element |
| `await book.layoutChapter(chapter)` | Lay out a chapter (font loading + line breaking + pagination) |
| `layout.getSpread(index)` | Get a two-page spread result |
| `layout.totalPages` | Total page count |
| `layout.syncImages(index, images)` | Set image exclusion zones with text reflow |
| `layout.resize({ pageWidth, lineWidth })` | Reflow on window resize |

## Quick Start: React

The `@libraz/mejiro-react` package provides a `MejiroPageView` component that renders a `PageResult` from the high-level API.

```tsx
import { useEffect, useRef, useState } from 'react';
import { MejiroBook, DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-react';

// Create once outside the component so the cache persists across renders
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

function Reader() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    (async () => {
      if (!surfaceRef.current) return;

      // Compute page dimensions from container
      const { pageWidth, pageHeight } = book.computePageSize(surfaceRef.current);
      setPageSize({ w: pageWidth, h: pageHeight });

      // Load EPUB and lay out the first chapter
      const res = await fetch('/book.epub');
      const epub = await parseEpub(await res.arrayBuffer());
      const layout = await book.layoutChapter(epub.chapters[0]);

      // Get first spread
      setSpread(layout.getSpread(0));
    })();
  }, []);

  if (!spread) return <div ref={surfaceRef} style={{ width: '100%', height: '100vh' }} />;

  const style = {
    width: pageSize.w,
    height: pageSize.h,
    fontSize: 16,
    fontFamily: '"Noto Serif JP", serif',
    lineHeight: 1.8,
  };

  return (
    <div ref={surfaceRef} style={{ display: 'flex', justifyContent: 'center' }}>
      <MejiroPageView result={spread.right} style={style} fontFamily='"Noto Serif JP", serif' lineSpacing={1.8} />
      <MejiroPageView result={spread.left} style={style} fontFamily='"Noto Serif JP", serif' lineSpacing={1.8} />
    </div>
  );
}
```

`MejiroPageView` accepts a `PageResult` (from `layout.getSpread()` or `layout.getPage()`) and automatically selects between CSS vertical writing mode and slot-based rendering when images are present.

## Quick Start: Vue

The `@libraz/mejiro-vue` package provides an equivalent `MejiroPageView` component for Vue 3.

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { MejiroBook, DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import type { SpreadResult } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-vue';

// Create once so the cache persists
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

const surfaceEl = ref<HTMLDivElement | null>(null);
const spread = ref<SpreadResult | null>(null);
const pageW = ref(0);
const pageH = ref(0);

onMounted(async () => {
  if (!surfaceEl.value) return;

  // Compute page dimensions from container
  const { pageWidth, pageHeight } = book.computePageSize(surfaceEl.value);
  pageW.value = pageWidth;
  pageH.value = pageHeight;

  // Load EPUB and lay out the first chapter
  const res = await fetch('/book.epub');
  const epub = await parseEpub(await res.arrayBuffer());
  const layout = await book.layoutChapter(epub.chapters[0]);

  // Get first spread
  spread.value = layout.getSpread(0);
});

const fontFamily = '"Noto Serif JP", serif';
const lineSpacing = 1.8;
</script>

<template>
  <div ref="surfaceEl" style="display: flex; justify-content: center; width: 100%; height: 100vh">
    <template v-if="spread">
      <MejiroPageView
        :result="spread.right"
        :style="{ width: `${pageW}px`, height: `${pageH}px`, fontSize: '16px', fontFamily, lineHeight: lineSpacing }"
        :font-family="fontFamily"
        :line-spacing="lineSpacing"
      />
      <MejiroPageView
        :result="spread.left"
        :style="{ width: `${pageW}px`, height: `${pageH}px`, fontSize: '16px', fontFamily, lineHeight: lineSpacing }"
        :font-family="fontFamily"
        :line-spacing="lineSpacing"
      />
    </template>
  </div>
</template>
```

## Quick Start: Core Only

If you do not need browser-based font measurement (for example, in a Node.js script or when you already have character advance widths), you can use the core module directly. It has zero external dependencies and does not require any browser APIs.

```ts
import { computeBreaks, toCodepoints, getLineRanges } from '@libraz/mejiro';

const text = toCodepoints('吾輩は猫である。名前はまだ無い。');
const advances = new Float32Array(text.length).fill(16); // 16px per character

const result = computeBreaks({
  text,
  advances,
  lineWidth: 128, // 8 characters per line
});

const lines = getLineRanges(result.breakPoints, text.length);
// lines: [[0, 8], [8, 16]]
```

`toCodepoints` converts a string into a `Uint32Array` of Unicode codepoints (handling surrogate pairs correctly). `computeBreaks` runs the O(n) greedy line breaking algorithm with kinsoku and hanging punctuation rules, returning break point indices. `getLineRanges` turns those break points into line ranges you can iterate over.

For low-level APIs such as `MejiroBrowser`, `buildParagraphMeasures`, `paginate`, and `buildRenderPage`, see the [API Reference](10-api-reference.md).

## Next Steps

- [Core Concepts](02-core-concepts.md) -- Architecture and data flow
- [Line Breaking](03-line-breaking.md) -- Kinsoku and hanging punctuation details
- [Browser Integration](05-browser-integration.md) -- MejiroBrowser class in depth
- [React & Vue](08-react-and-vue.md) -- Full component examples
- [API Reference](10-api-reference.md) -- Complete API listing
