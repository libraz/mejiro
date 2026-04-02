# @libraz/mejiro-vue

[![npm version](https://img.shields.io/npm/v/@libraz/mejiro-vue.svg)](https://www.npmjs.com/package/@libraz/mejiro-vue)
[![license](https://img.shields.io/npm/l/@libraz/mejiro-vue.svg)](https://github.com/libraz/mejiro/blob/main/LICENSE)

Vue components and composables for [mejiro](https://www.npmjs.com/package/@libraz/mejiro) vertical text rendering.

> **Experimental** — API may change in future releases.

## Install

```bash
npm install @libraz/mejiro @libraz/mejiro-vue
```

Peer dependency: `vue >= 3.3`

## Quick Start

```vue
<script setup lang="ts">
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-vue';
import '@libraz/mejiro/render/mejiro.css';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});
book.computePageSize(containerEl);

const epub = await parseEpub(buffer);
const layout = await book.layoutChapter(epub.chapters[0]);
const spread = layout.getSpread(0);
</script>

<template>
  <MejiroPageView :result="spread.right" fontFamily="'Noto Serif JP'" :lineSpacing="1.8" />
</template>
```

## Components

### `MejiroPageView` (Recommended)

Renders a `PageResult` from `ChapterLayout`. Automatically switches between CSS `vertical-rl` and slot-based rendering when images are present.

| Prop | Type | Description |
|------|------|-------------|
| `result` | `PageResult` | Required. Page result from `ChapterLayout`. |
| `fontFamily` | `string` | CSS font family (used in slot-based mode). |
| `lineSpacing` | `number` | Line spacing multiplier (used in slot-based mode). |
| `slotMode` | `boolean` | Force slot-based rendering (set when layout has images). |

### `MejiroPage` (Low-Level)

Renders a `RenderPage` using CSS `writing-mode: vertical-rl`. For use with the lower-level `buildRenderPage()` API.

## Composables

### `useImageOverlay`

Manages a draggable/resizable image overlay with automatic text reflow.

```ts
import { useImageOverlay } from '@libraz/mejiro-vue';

const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, spreadIdx, (spread) => { spreadRef.value = spread; });
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `layout` | `Ref<ChapterLayout \| null>` | Current chapter layout ref. |
| `spreadIdx` | `Ref<number>` | Current spread index ref. |
| `onUpdate` | `(spread: SpreadResult) => void` | Called after every reflow. |
| `options?` | `UseImageOverlayOptions` | Default dimensions, position, and margin. |

Returns `{ imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown }` (values are Vue refs or functions).

## CSS

```ts
import '@libraz/mejiro/render/mejiro.css';
```

## License

[Apache License 2.0](https://github.com/libraz/mejiro/blob/main/LICENSE)
