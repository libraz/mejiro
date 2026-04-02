# React and Vue Components

> **Note:** `@libraz/mejiro-react` and `@libraz/mejiro-vue` are experimental. Their API may change in future releases.

Both packages provide two components and an image overlay hook/composable:

- **`MejiroPageView`** (recommended) -- Renders a `PageResult` from the high-level `MejiroBook` API, with automatic slot-based rendering when images are present.
- **`useImageOverlay`** -- Hook (React) / composable (Vue) for draggable/resizable image overlays with real-time text reflow.
- **`MejiroPage`** (low-level) -- Renders a raw `RenderPage` directly. For manual pagination workflows.

## 1. React

### Installation

```bash
npm install @libraz/mejiro @libraz/mejiro-react
# peerDependency: react >=18
```

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
import '@libraz/mejiro/render/mejiro.css';

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
npm install @libraz/mejiro @libraz/mejiro-vue
# peerDependency: vue >=3.3
```

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
import '@libraz/mejiro/render/mejiro.css';

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
- [Book API](./09-book-api.md) -- MejiroBook, ChapterLayout, image exclusion
- [Pagination & Rendering](./07-pagination-and-rendering.md) -- Low-level paginate, buildRenderPage, CSS
- [API Reference](./10-api-reference.md) -- Complete API listing
