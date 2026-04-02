# @libraz/mejiro-react

[![npm version](https://img.shields.io/npm/v/@libraz/mejiro-react.svg)](https://www.npmjs.com/package/@libraz/mejiro-react)
[![license](https://img.shields.io/npm/l/@libraz/mejiro-react.svg)](https://github.com/libraz/mejiro/blob/main/LICENSE)

React components and hooks for [mejiro](https://www.npmjs.com/package/@libraz/mejiro) vertical text rendering.

> **Experimental** — API may change in future releases.

## Install

```bash
npm install @libraz/mejiro @libraz/mejiro-react
```

Peer dependency: `react >= 18`

## Quick Start

```tsx
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-react';
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

<MejiroPageView result={spread.right} fontFamily='"Noto Serif JP"' lineSpacing={1.8} />
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
| `className` | `string` | Additional CSS class name. |
| `style` | `CSSProperties` | Additional inline styles. |

### `MejiroPage` (Low-Level)

Renders a `RenderPage` using CSS `writing-mode: vertical-rl`. For use with the lower-level `buildRenderPage()` API.

## Hooks

### `useImageOverlay`

Manages a draggable/resizable image overlay with automatic text reflow.

```tsx
import { useImageOverlay } from '@libraz/mejiro-react';

const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, spreadIdx, (spread) => setSpread(spread));
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `layout` | `ChapterLayout \| null` | Current chapter layout. |
| `spreadIdx` | `number` | Current spread index. |
| `onUpdate` | `(spread: SpreadResult) => void` | Called after every reflow. |
| `options?` | `UseImageOverlayOptions` | Default dimensions, position, and margin. |

Returns `{ imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown }`.

## CSS

```ts
import '@libraz/mejiro/render/mejiro.css';
```

## License

[Apache License 2.0](https://github.com/libraz/mejiro/blob/main/LICENSE)
