# Getting Started

This guide walks you through installing mejiro and rendering your first vertical Japanese text. Choose the approach that fits your stack: vanilla JS, React, Vue, or headless (core only, no browser APIs).

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
npm install @libraz/mejiro-react

# Vue
npm install @libraz/mejiro-vue
```

## Quick Start: Browser (Vanilla JS)

This example measures text with a real font via `MejiroBrowser`, computes line breaks with kinsoku processing, paginates the result, and builds render-ready page data.

```ts
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import { getLineRanges, paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import '@libraz/mejiro/render/mejiro.css';

const mejiro = new MejiroBrowser();

// 1. Lay out text
const result = await mejiro.layout({
  text: '吾輩は猫である。名前はまだ無い。',
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: verticalLineWidth(600, 16),
});

// 2. Get line ranges
const lines = getLineRanges(result.breakPoints, 16);

// 3. Paginate
const entries = [{
  chars: [...'吾輩は猫である。名前はまだ無い。'],
  breakPoints: result.breakPoints,
  rubyAnnotations: [],
  isHeading: false,
}];
const measures = buildParagraphMeasures(entries, { fontSize: 16, lineHeight: 1.8 });
const pages = paginate(400, measures);

// 4. Render
const page = buildRenderPage(pages[0], entries);
// page.paragraphs -> lines -> segments (text or ruby)
```

`verticalLineWidth` converts a container height and font size into the maximum line width in pixels. `getLineRanges` returns an array of `[start, end)` index pairs describing each line. `buildRenderPage` produces a framework-agnostic `RenderPage` structure that you can walk to build DOM nodes, or pass directly to the React/Vue components below.

## Quick Start: React

The `@libraz/mejiro-react` package provides a `MejiroPage` component that renders a `RenderPage` object.

```tsx
import { useEffect, useState } from 'react';
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderPage } from '@libraz/mejiro/render';
import { MejiroPage } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro.css';

const mejiro = new MejiroBrowser();

function VerticalText() {
  const [page, setPage] = useState<RenderPage | null>(null);

  useEffect(() => {
    (async () => {
      const result = await mejiro.layout({
        text: '吾輩は猫である。名前はまだ無い。',
        fontFamily: '"Noto Serif JP"',
        fontSize: 16,
        lineWidth: verticalLineWidth(600, 16),
      });

      const entries = [{
        chars: [...'吾輩は猫である。名前はまだ無い。'],
        breakPoints: result.breakPoints,
        rubyAnnotations: [],
        isHeading: false,
      }];
      const measures = buildParagraphMeasures(entries, { fontSize: 16, lineHeight: 1.8 });
      const pages = paginate(400, measures);
      setPage(buildRenderPage(pages[0], entries));
    })();
  }, []);

  if (!page) return null;
  return <MejiroPage page={page} />;
}
```

Create `MejiroBrowser` once outside the component so the internal width cache persists across renders.

## Quick Start: Vue

The `@libraz/mejiro-vue` package provides an equivalent `MejiroPage` component for Vue 3.

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderPage } from '@libraz/mejiro/render';
import { MejiroPage } from '@libraz/mejiro-vue';
import '@libraz/mejiro/render/mejiro.css';

const mejiro = new MejiroBrowser();
const page = ref<RenderPage | null>(null);

onMounted(async () => {
  const result = await mejiro.layout({
    text: '吾輩は猫である。名前はまだ無い。',
    fontFamily: '"Noto Serif JP"',
    fontSize: 16,
    lineWidth: verticalLineWidth(600, 16),
  });

  const entries = [{
    chars: [...'吾輩は猫である。名前はまだ無い。'],
    breakPoints: result.breakPoints,
    rubyAnnotations: [],
    isHeading: false,
  }];
  const measures = buildParagraphMeasures(entries, { fontSize: 16, lineHeight: 1.8 });
  const pages = paginate(400, measures);
  page.value = buildRenderPage(pages[0], entries);
});
</script>

<template>
  <MejiroPage v-if="page" :page="page" />
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

## Next Steps

- [Core Concepts](02-core-concepts.md) -- Architecture and data flow
- [Line Breaking](03-line-breaking.md) -- Kinsoku and hanging punctuation details
- [Browser Integration](05-browser-integration.md) -- MejiroBrowser class in depth
- [React & Vue](08-react-and-vue.md) -- Full component examples
- [API Reference](10-api-reference.md) -- Complete API listing
