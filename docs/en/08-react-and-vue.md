# React and Vue Components

Both packages provide reader, editor, shelf, TOC, page, and overlay components plus hooks/composables:

- **`MejiroPageView`** (recommended) -- Renders a `PageResult` from the high-level `MejiroBook` API, with automatic slot-based rendering when images are present.
- **`useImageOverlay`** -- Hook (React) / composable (Vue) for draggable/resizable image overlays with real-time text reflow.
- **`MejiroPage`** (low-level) -- Renders a raw `RenderPage` directly. For manual pagination workflows.

## 1. React

### Installation

```bash
npm install @libraz/mejiro @libraz/mejiro-react react
npm install -D @types/react
```

Peer dependencies: `react >= 18`; TypeScript projects should install `@types/react >= 18` matching their React version.

### Choosing a component

- **`<MejiroReader>`** -- the all-in-one reader. Hand it an EPUB and you get a working viewer with header, chapter nav, settings panel, paged spreads, page turns, and keyboard bindings out of the box. Start here for "public reading page" use cases such as a novel-submission site.
- **`<MejiroEditor>` / `<MejiroManuscriptEditor>`** -- editors for an existing EPUB and for plain-text manuscripts respectively. Pair with `useEditableEpub` / `useEpubProject` when you want headless state with your own UI.
- **`<MejiroPageView>`** -- per-page renderer. Use it when you need to embed pages inside a custom layout (comment column, share buttons, etc.) instead of the bundled reader chrome.
- **`<MejiroPage>`** -- lowest-level renderer for a single `RenderPage` under CSS `writing-mode: vertical-rl`. Use it when you drive paginate / buildRenderPage yourself.

### MejiroReader (full reader)

There are three mutually exclusive source modes, enforced by a TypeScript discriminated union:

```tsx
import { MejiroReader } from '@libraz/mejiro-react';

// 1. Fetch and open from a URL (shortest path)
<MejiroReader epubUrl="/books/sample.epub" />

// 2. Pass an already-parsed EpubBook (e.g. parsed on the server)
<MejiroReader epub={epubBook} />

// 3. Let the reader collect a file via drop zone / file picker
<MejiroReader enableDropZone />
```

Use `bare` to strip all chrome at once, and reintroduce individual pieces with `enableHeader` / `enableChapterNav` / `enableSettings` / etc.:

```tsx
<MejiroReader epubUrl="/books/sample.epub" bare enableChapterNav />
```

#### MejiroReader imperative handle

`ref` exposes `MejiroReaderHandle` so the host can drive navigation from custom buttons or persist the reading position to a backend.

```tsx
import { useRef } from 'react';
import type { MejiroReaderHandle } from '@libraz/mejiro-react';

const reader = useRef<MejiroReaderHandle>(null);

<MejiroReader ref={reader} epubUrl="/books/sample.epub" />

reader.current?.goToSpread(12);
```

| Method | Signature | Purpose |
|--------|-----------|---------|
| `goToSpread` | `(index: number) => void` | Jump to a spread index (clamped to range). |
| `next` | `() => void` | Advance one spread. |
| `prev` | `() => void` | Go back one spread. |
| `goToChapter` | `(index: number) => void` | Switch chapter; resets the spread index to 0. |
| `getReadingPosition` | `() => ReadingPosition` | Returns `{ chapter, spreadIdx, totalPages, totalSpreads }`. |
| `goToAnchor` | `(anchor: ReadingAnchor) => void` | Navigate to a `ReadingAnchor`; switches chapters first if needed. |
| `getAnchor` | `() => ReadingAnchor \| null` | Anchor at the start of the current spread, or `null` before layout is ready. |
| `getVisibleRange` | `() => { start, end } \| null` | Half-open anchor range visible on the current spread; `end` points at the start of the next spread (or end of chapter). |
| `setOptions` | `(partial: Partial<BookOptions>) => Promise<void>` | Change fonts / sizes at runtime; re-measures and re-lays out asynchronously. |
| `subscribe` | `(event, listener) => () => void` | Subscribe to a lifecycle event; the returned function detaches the listener. |

Lifecycle events available via `subscribe`:

| Event | Payload | Fires |
|-------|---------|-------|
| `spreadChanged` | `{ chapter, spreadIdx }` | After the current spread index changes. |
| `turnStart` | `{ from }` | When a turn animation begins, before the new spread is shown. |
| `turnEnd` | `{ to }` | When a turn animation completes. |
| `chapterFinished` | `{ chapter }` | When the reader reaches the last spread of a chapter. Mirrors the `onChapterCompleted` prop. |

#### Persisting the reading position

`useReadingPosition` stores positions as a `ReadingAnchor` (`{ chapter, paragraph, charIndex }`). Unlike a spread index, anchors survive font-size changes and viewport resizes because they reference logical content, so they round-trip cleanly through any reflow.

```tsx
import { useEffect, useRef } from 'react';
import {
  MejiroReader,
  useReadingPosition,
  type MejiroReaderHandle,
} from '@libraz/mejiro-react';

const reader = useRef<MejiroReaderHandle>(null);
const { position, save } = useReadingPosition({
  key: `mejiro:position:${bookId}`,
  // Defaults to `window.localStorage`. For server-backed persistence,
  // pass a custom { getItem, setItem, removeItem } implementation.
});

// Restore the saved anchor once after mount.
useEffect(() => {
  if (position) reader.current?.goToAnchor(position);
}, [position]);

<MejiroReader
  ref={reader}
  epubUrl={url}
  onSpreadChange={() => {
    const anchor = reader.current?.getAnchor();
    if (anchor) save(anchor);
  }}
/>
```

`storage` accepts any implementation of the minimal `localStorage`-shaped interface (`getItem` / `setItem` / `removeItem`). Wrap your network calls in that shape for server-side persistence.

### MejiroPageView (Recommended)

`MejiroPageView` takes a `PageResult` from `ChapterLayout.getSpread()` and handles rendering automatically -- including slot-based absolute positioning when images are present.

Props:

| Prop | Type | Description |
|------|------|-------------|
| `result` | `PageResult` | Required. Page data from `layout.getSpread()`. |
| `fontFamily` | `string` | Font family for slot-based rendering. |
| `lineSpacing` | `number` | Line spacing multiplier for slot-based rendering. |
| `slotMode` | `boolean` | Force slot-based rendering (set to `true` when images exist on any spread). |
| `className` | `string` | Additional CSS class. |
| `style` | `CSSProperties` | Additional inline styles. |

### Complete React Example

A full component using `MejiroBook`, spread navigation, and image overlay:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-react';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

function VerticalReader({ paragraphs }: { paragraphs: { text: string }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ChapterLayout | null>(null);
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [spreadIdx, setSpreadIdx] = useState(0);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  // Image overlay hook
  const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
    useImageOverlay(layout, spreadIdx, setSpread);

  // Compute page size from container and lay out the chapter
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const { pageWidth, pageHeight } = book.computePageSize(el);
    setPageSize({ w: pageWidth, h: pageHeight });

    book.layoutChapter({ paragraphs }).then((lo) => {
      setLayout(lo);
      setSpread(lo.getSpread(0));
      setSpreadIdx(0);
    });
  }, [paragraphs]);

  // Navigate spreads
  const goTo = useCallback(
    (idx: number) => {
      if (!layout) return;
      setSpreadIdx(idx);
      setSpread(layout.getSpread(idx));
    },
    [layout],
  );

  if (!spread) return <div>Loading...</div>;

  const totalSpreads = Math.ceil(spread.totalPages / 2);

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
        {/* Right page (first in vertical-rl order) */}
        <div style={{ width: pageSize.w, height: pageSize.h, position: 'relative' }}>
          <MejiroPageView
            result={spread.right}
            fontFamily='"Noto Serif JP"'
            lineSpacing={1.8}
            slotMode={hasImage}
            style={{ width: '100%', height: '100%' }}
          />
          {/* Image overlay on the right page */}
          {imageRect && (
            <div
              style={{
                position: 'absolute',
                left: imageRect.x,
                top: imageRect.y,
                width: imageRect.w,
                height: imageRect.h,
                background: 'rgba(0,0,0,0.1)',
                border: '2px dashed #888',
                cursor: 'move',
              }}
              onPointerDown={onOverlayPointerDown}
            >
              {/* Resize handle */}
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: 16,
                  height: 16,
                  cursor: 'nwse-resize',
                }}
                onPointerDown={onResizePointerDown}
              />
            </div>
          )}
        </div>

        {/* Left page */}
        <div style={{ width: pageSize.w, height: pageSize.h }}>
          <MejiroPageView
            result={spread.left}
            fontFamily='"Noto Serif JP"'
            lineSpacing={1.8}
            slotMode={hasImage}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <button onClick={() => goTo(spreadIdx - 1)} disabled={spreadIdx === 0}>
          Previous
        </button>
        <span style={{ margin: '0 1em' }}>
          {spreadIdx + 1} / {totalSpreads}
        </span>
        <button onClick={() => goTo(spreadIdx + 1)} disabled={spreadIdx >= totalSpreads - 1}>
          Next
        </button>
        <button onClick={toggleImage} style={{ marginLeft: '1em' }}>
          {hasImage ? 'Remove Image' : 'Add Image'}
        </button>
      </div>
    </div>
  );
}
```

### useImageOverlay Hook

`useImageOverlay` manages a draggable/resizable image rectangle and syncs it with the layout engine for real-time text reflow.

```ts
const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, spreadIdx, onUpdate, options?);
```

Parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `layout` | `ChapterLayout \| null` | Current chapter layout. |
| `spreadIdx` | `number` | Current spread index. |
| `onUpdate` | `(spread: SpreadResult) => void` | Called after every reflow. |
| `options` | `UseImageOverlayOptions` | Default size/position (`defaultWidth`, `defaultHeight`, `defaultX`, `defaultY`, `margin`). |

Returns:

| Field | Type | Description |
|-------|------|-------------|
| `imageRect` | `ImageRect \| null` | Current rectangle `{ x, y, w, h }`, or `null`. |
| `hasImage` | `boolean` | Whether an overlay is active. |
| `toggleImage` | `() => void` | Toggle the overlay on/off. |
| `onOverlayPointerDown` | `(e: PointerEvent) => void` | Attach to the overlay div for dragging. |
| `onResizePointerDown` | `(e: PointerEvent) => void` | Attach to a corner handle for resizing. |

### MejiroPage (Low-Level)

For the low-level `MejiroPage` component and manual pagination, see the [API Reference](./10-api-reference.md).

---

## 2. Vue

### Installation

```bash
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

Peer dependency: `vue >= 3.3`.

### Choosing a component

Same layering as the React package — `<MejiroReader>` is the all-in-one reader, `<MejiroEditor>` / `<MejiroManuscriptEditor>` are editors, `<MejiroPageView>` renders a single page, and `<MejiroPage>` is the lowest-level renderer for one `RenderPage`.

### MejiroReader (full reader)

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { MejiroReader, type MejiroReaderHandle } from '@libraz/mejiro-vue';

const reader = ref<MejiroReaderHandle | null>(null);

function jump(): void {
  reader.value?.goToSpread(12);
}
</script>

<template>
  <MejiroReader ref="reader" epub-url="/books/sample.epub" />
  <button @click="jump">Jump to spread 12</button>
</template>
```

Source props mirror the React package: `epub-url`, `epub`, or neither (the reader renders its own drop zone). `MejiroReaderHandle` exposes the same surface as the React handle — see [the React handle table](#mejiroreader-imperative-handle) for the full list. Vue callers reach it through the `ref`'s `.value`.

Persisting the reading position uses the `useReadingPosition` composable together with the controlled props (`:spread-idx` + `@update:spread-idx`).

### MejiroPageView (Recommended)

Same functionality as the React version. Automatically switches between CSS `writing-mode` rendering and slot-based absolute positioning.

Props:

| Prop | Type | Description |
|------|------|-------------|
| `result` | `PageResult` | Required. Page data from `layout.getSpread()`. |
| `fontFamily` | `string` | Font family for slot-based rendering. |
| `lineSpacing` | `number` | Line spacing multiplier for slot-based rendering. |
| `slotMode` | `boolean` | Force slot-based rendering. |

### Complete Vue Example

A full component using `MejiroBook`, spread navigation, and image overlay:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-vue';

const props = defineProps<{ paragraphs: { text: string }[] }>();

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

const containerRef = ref<HTMLElement | null>(null);
const layout = ref<ChapterLayout | null>(null);
const spread = ref<SpreadResult | null>(null);
const spreadIdx = ref(0);
const pageSize = ref({ w: 0, h: 0 });

// Image overlay composable (note: takes Vue Refs for layout and spreadIdx)
const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, spreadIdx, (s) => {
    spread.value = s;
  });

const totalSpreads = computed(() =>
  spread.value ? Math.ceil(spread.value.totalPages / 2) : 0,
);

function goTo(idx: number): void {
  if (!layout.value) return;
  spreadIdx.value = idx;
  spread.value = layout.value.getSpread(idx);
}

onMounted(async () => {
  const el = containerRef.value;
  if (!el) return;

  const { pageWidth, pageHeight } = book.computePageSize(el);
  pageSize.value = { w: pageWidth, h: pageHeight };

  const lo = await book.layoutChapter({ paragraphs: props.paragraphs });
  layout.value = lo;
  spread.value = lo.getSpread(0);
});
</script>

<template>
  <div ref="containerRef">
    <template v-if="spread">
      <div style="display: flex; gap: 4px; justify-content: center">
        <!-- Right page (first in vertical-rl order) -->
        <div
          :style="{ width: pageSize.w + 'px', height: pageSize.h + 'px', position: 'relative' }"
        >
          <MejiroPageView
            :result="spread.right"
            font-family='"Noto Serif JP"'
            :line-spacing="1.8"
            :slot-mode="hasImage"
            :style="{ width: '100%', height: '100%' }"
          />
          <!-- Image overlay on the right page -->
          <div
            v-if="imageRect"
            :style="{
              position: 'absolute',
              left: imageRect.x + 'px',
              top: imageRect.y + 'px',
              width: imageRect.w + 'px',
              height: imageRect.h + 'px',
              background: 'rgba(0,0,0,0.1)',
              border: '2px dashed #888',
              cursor: 'move',
            }"
            @pointerdown="onOverlayPointerDown"
          >
            <!-- Resize handle -->
            <div
              :style="{
                position: 'absolute',
                right: 0,
                bottom: 0,
                width: '16px',
                height: '16px',
                cursor: 'nwse-resize',
              }"
              @pointerdown="onResizePointerDown"
            />
          </div>
        </div>

        <!-- Left page -->
        <div :style="{ width: pageSize.w + 'px', height: pageSize.h + 'px' }">
          <MejiroPageView
            :result="spread.left"
            font-family='"Noto Serif JP"'
            :line-spacing="1.8"
            :slot-mode="hasImage"
            :style="{ width: '100%', height: '100%' }"
          />
        </div>
      </div>

      <div style="text-align: center; margin-top: 8px">
        <button :disabled="spreadIdx === 0" @click="goTo(spreadIdx - 1)">Previous</button>
        <span style="margin: 0 1em">{{ spreadIdx + 1 }} / {{ totalSpreads }}</span>
        <button :disabled="spreadIdx >= totalSpreads - 1" @click="goTo(spreadIdx + 1)">
          Next
        </button>
        <button style="margin-left: 1em" @click="toggleImage">
          {{ hasImage ? 'Remove Image' : 'Add Image' }}
        </button>
      </div>
    </template>
    <div v-else>Loading...</div>
  </div>
</template>
```

### useImageOverlay Composable

Same functionality as the React hook, but takes **Vue Refs** for `layout` and `spreadIdx`, and returns **Refs** for reactive values.

```ts
const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, spreadIdx, onUpdate, options?);
```

Parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `layout` | `Ref<ChapterLayout \| null>` | Ref to the current chapter layout. |
| `spreadIdx` | `Ref<number>` | Ref to the current spread index. |
| `onUpdate` | `(spread: SpreadResult) => void` | Called after every reflow. |
| `options` | `UseImageOverlayOptions` | Default size/position. |

Returns:

| Field | Type | Description |
|-------|------|-------------|
| `imageRect` | `Ref<ImageRect \| null>` | Reactive rectangle. |
| `hasImage` | `Ref<boolean>` | Reactive computed boolean. |
| `toggleImage` | `() => void` | Toggle the overlay. |
| `onOverlayPointerDown` | `(e: PointerEvent) => void` | Attach for dragging. |
| `onResizePointerDown` | `(e: PointerEvent) => void` | Attach for resizing. |

### MejiroPage (Low-Level)

For the low-level `MejiroPage` component and manual pagination, see the [API Reference](./10-api-reference.md).

---

## 3. Styling

Both `MejiroPageView` and `MejiroPage` render using `mejiro-` prefixed CSS classes. Override them in your stylesheet:

```css
/* Custom page background */
.mejiro-page {
  background: #f5f0e8;
  padding: 2em;
}

/* Custom paragraph spacing */
.mejiro-paragraph {
  margin-left: 0.6em;
}

/* Custom heading style */
.mejiro-paragraph--heading {
  font-size: 1.6em;
  color: #333;
}

/* Custom ruby size */
.mejiro-page rt {
  font-size: 0.45em;
  color: #666;
}
```

---

## Related Documentation

- [Getting Started](./01-getting-started.md) -- Installation and basic usage
- [Book API](./10-api-reference.md) -- MejiroBook, ChapterLayout, image exclusion
- [Pagination & Rendering](./07-pagination-and-rendering.md) -- Low-level paginate, buildRenderPage, CSS
- [API Reference](./10-api-reference.md) -- Complete API listing
