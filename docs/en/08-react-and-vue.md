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

- **`<MejiroReader>`** -- the all-in-one reader. Hand it an EPUB and you get a working viewer with chapter navigation, settings panel, paged spreads, page turns, and keyboard bindings out of the box; it adds a header when you give it a `title`. Start here for "public reading page" use cases such as a novel-submission site.
- **`<MejiroEditor>` / `<MejiroManuscriptEditor>`** -- editors for an existing EPUB and for plain-text manuscripts respectively. Pair with `useEditableEpub` / `useEpubProject` when you want headless state with your own UI.
- **`<MejiroPageView>`** -- per-page renderer. Use it when you need to embed pages inside a custom layout (comment column, share buttons, etc.) instead of the bundled reader chrome.
- **`<MejiroPage>`** -- lowest-level renderer for a single `RenderPage` under CSS `writing-mode: vertical-rl`. Use it when you drive paginate / buildRenderPage yourself.

### MejiroReader (full reader)

There are four mutually exclusive source modes, enforced by a TypeScript discriminated union:

```tsx
import { MejiroReader } from '@libraz/mejiro-react';

// 1. Fetch and open from a URL (shortest path)
<MejiroReader epubUrl="/books/sample.epub" />

// 2. Pass an already-parsed EpubBook (e.g. parsed on the server)
<MejiroReader epub={epubBook} />

// 3. Let the reader collect a file via drop zone / file picker
<MejiroReader enableDropZone />

// 4. Render manuscript chapters directly, with no EPUB round-trip
<MejiroReader manuscript={chapters} dialect="mejiro" />
```

In manuscript mode each chapter body is split into paragraphs on blank lines and parsed
with `parseManuscript()` before layout, which makes it the mode to use for live preview
inside a custom manuscript editor.

The shortest call shows the book with the page indicator, the settings button and the chapter selector; there is no header until you give the reader a `title` (or a `logo`), and no development statistics. Each piece of chrome has its own switch: `showSettings`, `showPageIndicator`, `showStats`, `showImageOverlayButton`, and `chapterNavMode` (`'none'` hides the chapter navigation):

```tsx
<MejiroReader epubUrl="/books/sample.epub" title="吾輩は猫である" showSettings={false} />
```

The arrow keys and Escape act on the reader root once it has focus, so several readers on one page do not steal each other's keys.

#### Reading position props

`chapterIndex`, `spreadIndex` and `anchor` set where the reader opens. Passing the matching handler — `onChapterIndexChange`, `onSpreadIndexChange`, `onAnchorChange` — makes that value controlled: the reader reports each move through the handler and shows what the prop says. Without the handler the prop is only the starting position.

- `spreadIndex` always counts spreads of the chapter layout, also in single-page mode. Given alone in single-page mode, the reader opens the right page of that spread (the first in reading order). Turning from the right to the left page of one spread keeps the spread, so `onSpreadIndexChange` does not fire; follow `onAnchorChange` for page-level changes.
- `anchor` (a `ReadingAnchor`) wins over `chapterIndex` and `spreadIndex` when both are given, and survives re-layout, which a spread index does not.
- A position that is not finite reads as `0`, a fraction is truncated, and an index past the end is clamped.

```tsx
const [chapterIndex, setChapterIndex] = useState(0);

<MejiroReader epub={epub} chapterIndex={chapterIndex} onChapterIndexChange={setChapterIndex} />
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
| `goToSpread` | `(index: number) => void` | Jump to a navigation index (clamped to range). |
| `next` | `() => void` | Advance one spread. |
| `prev` | `() => void` | Go back one spread. |
| `goToChapter` | `(index: number) => void` | Switch chapter (clamped to the book's chapters); resets the spread index to 0. |
| `getSpreadPosition` | `() => SpreadPosition` | Returns `{ chapterIndex, spreadIndex, spreadCount, pageCount }`. |
| `goToAnchor` | `(anchor: ReadingAnchor) => Promise<void>` | Navigate to a `ReadingAnchor`, without the page-turn animation; switches chapters first if needed. A call made before the book has loaded is applied once it has. The promise resolves once the spread is applied, or without moving when the anchor's chapter or position does not exist in the book. If a later `goToAnchor` supersedes the previous call, the earlier promise resolves immediately. The promise also resolves on unmount so `await` cannot hang. |
| `getAnchor` | `() => ReadingAnchor \| null` | Anchor at the start of the text on the current spread, or `null` before layout is ready. When an image covers a whole page, the anchor comes from the next page with text. |
| `getVisibleRange` | `() => ReadingAnchorRange \| null` | Half-open anchor range visible on the current spread; `end` points at the start of the text on the next spread that has any (or the end of the chapter). |
| `updateOptions` | `(patch: BookOptionsPatch) => Promise<void>` | Change fonts / sizes at runtime; re-measures and re-lays out asynchronously. |
| `subscribe` | `(event, listener) => () => void` | Subscribe to a lifecycle event; the returned function detaches the listener. |

Lifecycle events available via `subscribe`:

| Event | Payload | Fires |
|-------|---------|-------|
| `spreadIndexChange` | `{ chapterIndex, spreadIndex }` | After the current spread index changes. |
| `turnStart` | `{ from }` | When a turn animation begins, before the new spread is shown. |
| `turnEnd` | `{ to }` | When a turn animation completes. |
| `chapterFinished` | `{ chapterIndex }` | When the reader reaches the last spread of a chapter. Mirrors the `onChapterFinished` prop, which receives the chapter index. |

The first position the reader settles on after loading is the baseline and fires nothing. After that, each change of chapter or spread index fires `spreadIndexChange` once, then `chapterFinished` if the new index is the last one in the chapter, and a re-layout that keeps the index fires nothing. The `onPageRead(anchor, dwellMs)` prop fires on the same transitions, for the spread that was left; a book swap and unmount do not fire it. When an uncontrolled reader on another chapter resets to chapter 0 on a book swap, `onChapterIndexChange` fires with `0`. React and Vue emit the same sequence.

In single-page mode (`spreadMode="single"`, or `"auto"` on a portrait surface) the reader shows one page at a time. `goToSpread`, `next` and `prev` then move by page, while `spreadIndex`, `onSpreadIndexChange`, the `spreadIndexChange` event and `SpreadPosition` keep counting layout spreads. `getAnchor` and `getVisibleRange` cover the current page. When `"auto"` switches mode, the index is converted so the page on screen stays visible.

#### Persisting the reading position

`useReadingPosition` stores positions as a `ReadingAnchor` (`{ chapterIndex, paragraphIndex, charIndex }`). Unlike a spread index, anchors survive font-size changes and viewport resizes because they reference logical content, so they round-trip cleanly through any reflow.

```tsx
import { MejiroReader, useReadingPosition } from '@libraz/mejiro-react';

const { position, save } = useReadingPosition({
  key: `mejiro:position:${bookId}`,
  // Defaults to `window.localStorage`. For server-backed persistence,
  // pass a custom { getItem, setItem, removeItem } implementation.
});

// The reader opens at the saved anchor and reports every move to save().
<MejiroReader epubUrl={url} anchor={position} onAnchorChange={save} />
```

`storage` accepts any implementation of the minimal `localStorage`-shaped interface (`getItem` / `setItem` / `removeItem`). For async, server-backed persistence, the idiomatic pattern is to leave `storage` pointing at an in-memory mirror and use `onPositionChange` to forward each mutation. Send the bytes produced by `serializeReadingPosition` -- that is the same payload the hook writes to `storage`, and `parseReadingPosition` reads it back on the next visit:

```tsx
import { serializeReadingPosition } from '@libraz/mejiro';

const { position, save } = useReadingPosition({
  key: `mejiro:position:${bookId}`,
  onPositionChange: (next) => {
    void fetch(`/api/books/${bookId}/position`, {
      method: next ? 'PUT' : 'DELETE',
      body: next ? serializeReadingPosition(next) : undefined,
    });
  },
});
```

On the next visit, feed the stored string back through `parseReadingPosition` (or hand it to a `storage` whose `getItem` returns it) to get the anchor:

```tsx
import { parseReadingPosition } from '@libraz/mejiro';

const restored = parseReadingPosition(await loadPositionFromServer(bookId));
if (restored) reader.current?.goToAnchor(restored);
```

`onPositionChange` fires synchronously after `save()` or `clear()` (never on initial hydration or `key` changes). Local persistence stays on its own `debounceMs`, so you can pick a different rate for the network call without coordinating the two. A storage that throws, or data it cannot read back, is reported to `onError` (`storage-read-failed`, `storage-write-failed`, `storage-corrupt`); corrupt data is left in place until the first change.

### MejiroPageView (Recommended)

`MejiroPageView` takes a `PageResult` from `ChapterLayout.getSpread()` and handles rendering automatically -- including slot-based absolute positioning when images are present.

Props:

| Prop | Type | Description |
|------|------|-------------|
| `result` | `PageResult` | Required. Page data from `layout.getSpread()`. |
| `layout` | `ChapterLayout` | Supplies the default `fontFamily` and `lineSpacing` from `layout.typography`. |
| `fontFamily` | `string` | Font family for slot-based rendering. |
| `lineSpacing` | `number` | Line spacing multiplier for slot-based rendering. |
| `slotMode` | `boolean` | Force slot-based rendering (set it from `result.hasImages`). |
| `className` | `string` | Additional CSS class. |
| `style` | `CSSProperties` | Additional inline styles. |

Both modes give each paragraph (flow) or line (slot) the same `mejiro-paragraph--*` class, so blockquote, preformatted, scene-break and figure styling survive a chapter gaining an image. Slot mode positions and sizes each column inline; weight, style and white-space come from the class.

### Complete React Example

A full component using `MejiroBook`, spread navigation, and image overlay:

<!-- doc-example: 08-react-vertical-reader.tsx#reader -->
```tsx
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
});

function VerticalReader({ paragraphs }: { paragraphs: { text: string }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ChapterLayout | null>(null);
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });

  // Image overlays: every change re-flows the spread around them
  const { currentImages, addOverlay, clearOverlays, onOverlayPointerDown, onResizePointerDown } =
    useImageOverlay(layout, { spreadIndex, onReflow: setSpread });
  const overlay = currentImages[0];

  // Measure the container and lay out the chapter
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const { pageWidth, pageHeight } = book.fitPageSize(el);
    setPageSize({ width: pageWidth, height: pageHeight });

    book.layoutChapter({ paragraphs }).then((lo) => {
      setLayout(lo);
      setSpread(lo.getSpread(0));
      setSpreadIndex(0);
    });
  }, [paragraphs]);

  // Navigate spreads
  const goTo = useCallback(
    (index: number) => {
      if (!layout) return;
      setSpreadIndex(index);
      setSpread(layout.getSpread(index));
    },
    [layout],
  );

  // The measured container renders on every path, so the effect finds it on first commit.
  if (!spread) return <div ref={containerRef}>Loading...</div>;

  const spreadCount = Math.ceil(spread.pageCount / 2);

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
        {/* Right page (first in vertical-rl order) */}
        <div style={{ width: pageSize.width, height: pageSize.height, position: 'relative' }}>
          <MejiroPageView
            result={spread.right}
            fontFamily='"Noto Serif JP"'
            lineSpacing={1.8}
            slotMode={spread.right.hasImages}
            style={{ width: '100%', height: '100%' }}
          />
          {/* Image overlay on the right page */}
          {overlay && (
            <div
              style={{
                position: 'absolute',
                left: overlay.rect.x,
                top: overlay.rect.y,
                width: overlay.rect.width,
                height: overlay.rect.height,
                background: 'rgba(0,0,0,0.1)',
                border: '2px dashed #888',
                cursor: 'move',
              }}
              onPointerDown={(e) => onOverlayPointerDown(overlay.id, e)}
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
                onPointerDown={(e) => onResizePointerDown(overlay.id, e)}
              />
            </div>
          )}
        </div>

        {/* Left page */}
        <div style={{ width: pageSize.width, height: pageSize.height }}>
          <MejiroPageView
            result={spread.left}
            fontFamily='"Noto Serif JP"'
            lineSpacing={1.8}
            slotMode={spread.left.hasImages}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <button type="button" onClick={() => goTo(spreadIndex - 1)} disabled={spreadIndex === 0}>
          Previous
        </button>
        <span style={{ margin: '0 1em' }}>
          {spreadIndex + 1} / {spreadCount}
        </span>
        <button
          type="button"
          onClick={() => goTo(spreadIndex + 1)}
          disabled={spreadIndex >= spreadCount - 1}
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => (overlay ? clearOverlays(spreadIndex) : addOverlay())}
          style={{ marginLeft: '1em' }}
        >
          {overlay ? 'Remove Image' : 'Add Image'}
        </button>
      </div>
    </div>
  );
}
```

### Keeping the reading position across a re-flow

`useChapterLayout` lays the chapter out again whenever the surface resizes or a metric option changes; a resize observation that reports the box the current layout was measured with does not re-flow. The book replays the line-breaking hints it already derived, so this never re-runs the analyzer, but the result is a brand-new `ChapterLayout`, which resets any downstream spread index to 0. The hook carries the reading position across the swap in three steps, and the Vue composable has exactly the same shape:

- `capturePosition(layout)` is called on the outgoing layout just before a re-flow and returns the anchor to keep (or `null`). It is never called for a blank (content-change) re-layout.
- `pendingRestore.current` (Vue: `pendingRestore.value`) holds that anchor until the new layout is in place.
- `restorePosition(layout, anchor)`, when given, is called once the new layout is in place (React: after it commits, before paint), with `pendingRestore` already cleared.

<!-- doc-example: 08-reflow-options.tsx#react -->
```tsx
const layout = useChapterLayout(book, {
  epub,
  chapterIndex,
  surface,
  capturePosition: (l) => l.anchorAt(spreadIndex),
  restorePosition: (l, anchor) => setSpreadIndex(l.locateAnchor(anchor)?.spreadIndex ?? 0),
});
```

<!-- doc-example: 08-reflow-options-vue.ts#vue -->
```ts
// Vue: the same options, which also take Refs; `layout.layout` is a Ref.
const layout = useChapterLayout(book, {
  epub,
  chapterIndex,
  surface,
  capturePosition: (l) => l.anchorAt(spreadIndex.value),
  restorePosition: (l, anchor) => {
    spreadIndex.value = l.locateAnchor(anchor)?.spreadIndex ?? 0;
  },
});
```

When the spread index lives in `useSpread`, one option does all of this: `useSpread(layout, { preservePosition: true })` opens each replacement layout at the text the old one showed.

Without `restorePosition`, read `pendingRestore.current` (Vue: `.value`) yourself once the new layout is in place and set it back to `null`; this suits a component that resets its spread index in its own layout effect and must restore after that reset. `useManuscriptLayout` takes the same options and returns the same `pendingRestore` for manuscript previews.

### useImageOverlay Hook

`useImageOverlay` manages draggable, resizable image overlays per spread and syncs them with the layout engine for real-time text reflow. Each overlay change re-flows its spread through `ChapterLayout.setImages`, and the overlays are re-applied when the layout is replaced, so the text keeps flowing around them after a resize. In React a change of the `margin` option re-applies them as well; the Vue composable reads its options once, when it is called. A drag starts only on a press `isPrimaryPointerPress` accepts (touch, pen or the primary mouse button), and `MejiroSpread` does not turn the page for a press on an overlay. With `showImageOverlayButton`, `MejiroReader` clears its overlays when a book loads or the chapter changes.

```ts
const nav = useSpread(layout);
const overlays = useImageOverlay(layout, {
  spreadIndex: nav.spreadIndex,
  onReflow: () => nav.refresh(),
});
```

Options (`UseImageOverlayOptions`):

| Option | Type | Description |
|--------|------|-------------|
| `spreadIndex` | `number` | Required. Layout spread `addOverlay` places overlays on. |
| `onReflow` | `(spread: SpreadResult) => void` | Called with each spread re-flowed after an overlay change. Pair it with `useSpread().refresh()`. Defaults to a no-op. |
| `defaultWidth` / `defaultHeight` / `defaultX` / `defaultY` | `number` | Size and position of a new overlay (120 × 160 at 80, 100). |
| `margin` | `number` | Margin around each overlay; defaults to the book's font size. |

Returns (`UseImageOverlayReturn`):

| Field | Type | Description |
|-------|------|-------------|
| `imagesBySpread` | `ReadonlyMap<number, readonly MultiImageItem[]>` | Overlays keyed by spread index. |
| `currentImages` | `readonly MultiImageItem[]` | Overlays on `spreadIndex`; pass them to `MejiroSpread`'s `images`. |
| `hasOverlays` | `boolean` | Whether any spread holds an overlay. |
| `addOverlay` | `(overrides?: Partial<ImageOverlayRect>) => MultiImageItem` | Add an overlay on the current spread. |
| `removeOverlay` / `updateOverlay` | `(id) => void` / `(id, rect) => void` | Remove an overlay, or merge a rectangle into it. |
| `clearOverlays` | `(spreadIndex?: number) => void` | Remove every overlay, or those of one spread. |
| `onOverlayPointerDown` / `onResizePointerDown` | `(id: string, e: PointerEvent) => void` | Attach to an overlay body for dragging, and to its corner handle for resizing. |

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

Source props mirror the React package: `epub-url`, `epub`, `manuscript` (with the optional `dialect` prop), or none of them (the reader renders its own drop zone). The position props bind with `v-model:chapter-index`, `v-model:spread-index` and `v-model:anchor`; a value bound without listening to its `update:` event is only the starting position, as in React. `MejiroReaderHandle` exposes the same surface as the React handle — see [the React handle table](#mejiroreader-imperative-handle) for the full list. Vue callers reach it through the `ref`'s `.value`.

Persist the reading position the same way as in React: bind the `ReadingAnchor` that `useReadingPosition` stores to `anchor` and save each move. A spread index does not survive reflow, so it is not a persistence format.

```vue
<script setup lang="ts">
import { MejiroReader, useReadingPosition } from '@libraz/mejiro-vue';

const props = defineProps<{ bookId: string; url: string }>();
const { position, save } = useReadingPosition({ key: `mejiro:position:${props.bookId}` });
</script>

<template>
  <MejiroReader :epub-url="url" :anchor="position" @update:anchor="save" />
</template>
```

### MejiroPageView (Recommended)

Same functionality as the React version. Automatically switches between CSS `writing-mode` rendering and slot-based absolute positioning.

Props:

| Prop | Type | Description |
|------|------|-------------|
| `result` | `PageResult` | Required. Page data from `layout.getSpread()`. |
| `layout` | `ChapterLayout` | Supplies the default `fontFamily` and `lineSpacing` from `layout.typography`. |
| `fontFamily` | `string` | Font family for slot-based rendering. |
| `lineSpacing` | `number` | Line spacing multiplier for slot-based rendering. |
| `slotMode` | `boolean` | Force slot-based rendering. |

### Complete Vue Example

A full component using `MejiroBook`, spread navigation, and image overlay:

<!-- doc-example: 08-vue-reader.vue -->
```vue
<script setup lang="ts">
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-vue';
import { computed, onMounted, ref, shallowRef } from 'vue';

const props = defineProps<{ paragraphs: { text: string }[] }>();

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
});

const containerRef = ref<HTMLElement | null>(null);
const layout = shallowRef<ChapterLayout | null>(null);
const spread = shallowRef<SpreadResult | null>(null);
const spreadIndex = ref(0);
const pageSize = ref({ width: 0, height: 0 });

// Image overlays: every change re-flows the spread around them (layout and spreadIndex are Refs)
const { currentImages, addOverlay, clearOverlays, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, {
    spreadIndex,
    onReflow: (s) => {
      spread.value = s;
    },
  });
const overlay = computed(() => currentImages.value[0]);

const spreadCount = computed(() => (spread.value ? Math.ceil(spread.value.pageCount / 2) : 0));

function goTo(index: number): void {
  if (!layout.value) return;
  spreadIndex.value = index;
  spread.value = layout.value.getSpread(index);
}

function toggleOverlay(): void {
  if (overlay.value) clearOverlays(spreadIndex.value);
  else addOverlay();
}

onMounted(async () => {
  const el = containerRef.value;
  if (!el) return;

  const { pageWidth, pageHeight } = book.fitPageSize(el);
  pageSize.value = { width: pageWidth, height: pageHeight };

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
          :style="{ width: pageSize.width + 'px', height: pageSize.height + 'px', position: 'relative' }"
        >
          <MejiroPageView
            :result="spread.right"
            font-family='"Noto Serif JP"'
            :line-spacing="1.8"
            :slot-mode="spread.right.hasImages"
            :style="{ width: '100%', height: '100%' }"
          />
          <!-- Image overlay on the right page -->
          <div
            v-if="overlay"
            :style="{
              position: 'absolute',
              left: overlay.rect.x + 'px',
              top: overlay.rect.y + 'px',
              width: overlay.rect.width + 'px',
              height: overlay.rect.height + 'px',
              background: 'rgba(0,0,0,0.1)',
              border: '2px dashed #888',
              cursor: 'move',
            }"
            @pointerdown="onOverlayPointerDown(overlay.id, $event)"
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
              @pointerdown="onResizePointerDown(overlay.id, $event)"
            />
          </div>
        </div>

        <!-- Left page -->
        <div :style="{ width: pageSize.width + 'px', height: pageSize.height + 'px' }">
          <MejiroPageView
            :result="spread.left"
            font-family='"Noto Serif JP"'
            :line-spacing="1.8"
            :slot-mode="spread.left.hasImages"
            :style="{ width: '100%', height: '100%' }"
          />
        </div>
      </div>

      <div style="text-align: center; margin-top: 8px">
        <button :disabled="spreadIndex === 0" @click="goTo(spreadIndex - 1)">Previous</button>
        <span style="margin: 0 1em">{{ spreadIndex + 1 }} / {{ spreadCount }}</span>
        <button :disabled="spreadIndex >= spreadCount - 1" @click="goTo(spreadIndex + 1)">
          Next
        </button>
        <button style="margin-left: 1em" @click="toggleOverlay">
          {{ overlay ? 'Remove Image' : 'Add Image' }}
        </button>
      </div>
    </template>
    <div v-else>Loading...</div>
  </div>
</template>
```

### useImageOverlay Composable

The same options and return keys as the React hook. `layout` and `options.spreadIndex` accept a value, a `Ref` or a getter; `imagesBySpread`, `currentImages` and `hasOverlays` are returned as refs; the other options are read once.

```ts
const nav = useSpread(layout);
const overlays = useImageOverlay(layout, {
  spreadIndex: nav.spreadIndex,
  onReflow: () => nav.refresh(),
});
overlays.addOverlay();
```

### MejiroPage (Low-Level)

For the low-level `MejiroPage` component and manual pagination, see the [API Reference](./10-api-reference.md).

---

## 3. MejiroEditor vs MejiroManuscriptEditor

When adopting mejiro for a posting site, the two editors trade off across the same axes regardless of framework:

| Axis | `MejiroEditor` | `MejiroManuscriptEditor` |
|---|---|---|
| Input | An EPUB URL (`epubUrl`) or a dropped file; the buffer is parsed into an editable book | Manuscript text (chapter `body` array) |
| Edit granularity | Paragraphs, inline annotations (ruby), image insertion | Chapter body text (mejiro notation), title, author, cover |
| Output | A re-serialized EPUB (bytes) | Manuscript chapter array → exported to EPUB |
| State hook | `useEditableEpub` | `useManuscriptDraft` |
| Preview | Paragraph list + Reader synced to selection | Chapter body textarea + Reader driven by the manuscript |
| Notation aids | Ruby/annotation tools applied to paragraph selections. On a selected scene break the text area is read-only and Apply text / Apply ruby are disabled, since a scene break carries no text | `MejiroNotationHighlighter` + emphasis-dot / TCY / em / strong buttons; the buttons appear only for the `mejiro` dialect, the one that recognizes those markers |
| Intended use | Proofing published EPUBs, editorial workflows | New writing, novel posting sites, draft-to-publish pipelines |
| Headless decomposition | `useEditableEpub` lets you replace the UI | `useManuscriptDraft` + `MejiroReader(manuscript=...)` lets you replace the UI |
| Controlled mode | Drive `useEditableEpub` selection from external state | `title` / `author` / `cover` are individually controllable (React: pass `onXxxChange`; Vue: use `v-model:xxx`) |

Quick decision:

- **"Already shipped an EPUB and need to patch the text"** → `MejiroEditor`
- **"New writing or a posting form that publishes after each draft"** → `MejiroManuscriptEditor`
- **"Site already has the title/author fields edited elsewhere"** → `MejiroManuscriptEditor` in controlled mode

### MejiroManuscriptEditor controlled mode

`title` / `author` / `cover` / `chapters` work as both uncontrolled (initial value) and controlled (parent-owned) props. Attaching `onXxxChange` (React) or `v-model:xxx` (Vue) flips that field into controlled mode — the input value tracks the prop until the parent updates it.

This is the rule for every value prop in both packages: the prop is the starting value, and the handler is what makes it controlled. It differs from the common `value` + `onChange` / `defaultValue` split, so that a host can take over one field — a title edited on another screen, say — without the others leaving their uncontrolled default, and so that each value keeps a single prop name.

```tsx
// React: wiring the editor into a post-form's shared state
const [title, setTitle] = useState('');
const [author, setAuthor] = useState('');
const [cover, setCover] = useState<File | null>(null);

<MejiroManuscriptEditor
  title={title}
  onTitleChange={setTitle}
  author={author}
  onAuthorChange={setAuthor}
  cover={cover}
  onCoverChange={setCover}
/>
```

```vue
<!-- Vue: v-model pattern -->
<MejiroManuscriptEditor
  v-model:title="title"
  v-model:author="author"
  v-model:cover="cover"
/>
```

Without handlers the fields stay uncontrolled.

---

## 4. Styling

Both `MejiroPageView` and `MejiroPage` render using `mejiro-` prefixed CSS classes. Override them in your stylesheet:

```css
/* Custom page background */
.mejiro-page {
  background: #f5f0e8;
  padding: 2em;
}

/* Custom paragraph spacing.
   In vertical-rl the block-start side is the right side, so the gap before a
   paragraph is `margin-right` — overriding `margin-left` adds a gap on the
   opposite side instead of changing this one. */
.mejiro-paragraph {
  margin-right: 0.6em;
}

/* Custom heading style. Size and the gaps around a heading follow
   --mejiro-paragraph-scale, so change the scale rather than font-size. */
.mejiro-paragraph--heading {
  color: #333;
}

/* renderEpubStatic output takes heading sizes from the stylesheet. */
.mejiro-page--static .mejiro-paragraph--h1 {
  --mejiro-paragraph-scale: 1.8;
}

/* Custom ruby size */
.mejiro-page rt {
  font-size: 0.45em;
  color: #666;
}
```

Heading sizes on pages from a `ChapterLayout` are not a stylesheet setting: the page components set `--mejiro-paragraph-scale` inline from the scale the layout measured, so change them through `headingScale` / `headingStyles` in the book options, which keeps measurement and rendering in step.

### CSS cascade layers (host resets can clobber the reader chrome)

The reader's chrome stylesheet (`MejiroReader` header, settings panel, controls)
ships inside a CSS cascade layer:

```css
@layer mejiro.base, mejiro.chrome, mejiro.print;
```

Layering lets you override mejiro's chrome from your own **unlayered** styles
without specificity wars — any unlayered rule wins. But that same precedence
rule cuts the other way: an unlayered global **reset** in the host app also beats
mejiro's layered rules, regardless of selector specificity. VitePress,
normalize.css, and Tailwind's preflight all ship something like:

```css
button, input, optgroup, select, textarea { padding: 0; ... }  /* unlayered */
```

which strips the padding mejiro reserves for the settings `<select>` dropdown
arrows (the arrow then overlaps the option text). mejiro reasserts the few
box-model properties its controls depend on with `!important` so they survive
this, but the general guidance for a clean embed is to **put your own resets in a
layer** so they participate in the cascade order instead of trumping everything:

```css
@layer reset, mejiro, app;

@layer reset {
  /* normalize / preflight / your reset here */
}
```

With the reset layered before `mejiro`, the reader's chrome styles win as
intended, and your `app` layer can still override them on top.

### Embedding in page flow (`fit="width"`)

By default `MejiroReader` fills its container's height (`fit="fill"`), so the
container needs an explicit height. To drop the reader into normal document flow
(a blog post, a docs page) without computing a height, use `fit="width"`: the
reader derives its own height from its measured width and the page aspect ratio,
the spread fills edge-to-edge with no letterbox, and you only constrain the
width.

```tsx
// React
<div style={{ width: '100%', maxWidth: 720 }}>
  <MejiroReader epubUrl="/book.epub" fit="width" />
</div>
```

```vue
<!-- Vue -->
<div style="width: 100%; max-width: 720px;">
  <MejiroReader epub-url="/book.epub" fit="width" />
</div>
```

### Page numbers (`pageNumbers`)

Each page of a spread prints its own page number in the running head — the right
page odd, the left page even. Use `pageNumbers` to choose which pages show one. It applies in every reader mode: `mode="scroll"` numbers its page stack by the same rule, with the first page on the right, and shows the `showPageIndicator` badge as well.

| Value | Effect |
|---|---|
| `'both'` | Number every page (default). |
| `'right'` | Only the right page. |
| `'left'` | Only the left page. |
| `'none'` | Hide page numbers. The `showPageIndicator` "n / total" badge is independent. |

```tsx
// React
<MejiroReader epubUrl="/book.epub" pageNumbers="right" />
```

```vue
<!-- Vue -->
<MejiroReader epub-url="/book.epub" page-numbers="right" />
```

---

## 5. Building a fully custom editor

`MejiroManuscriptEditor` is a finished component, but if you're embedding mejiro in a posting site you'll usually want to **assemble the editor from primitives**. The pieces below let you skip the EPUB ZIP round-trip entirely.

| What you need | API |
|---|---|
| Draft state (chapter array + autosave) | `useManuscriptDraft({ onAutosave, autosaveDebounceMs })` |
| Lay out a single manuscript chapter for preview | `useManuscriptLayout(book, { chapter, surface, dialect })` |
| Full-chrome preview (chapter nav + settings) | `<MejiroReader manuscript={chapters} dialect="mejiro" />` |
| Notation highlight overlay for an editing textarea | `<MejiroNotationHighlighter value onValueChange />` |
| Final EPUB export | `EpubProject.fromManuscript(...).export(...)` |

### Drive MejiroReader from manuscript chapters directly

The shortest path to a full-chrome preview without going through a real EPUB. Pass `manuscript` to the same Reader you'd ship to readers.

```tsx
import { MejiroReader, useManuscriptDraft } from '@libraz/mejiro-react';

function MyEditor() {
  const draft = useManuscriptDraft({
    onAutosave: async (chapters) => {
      await fetch('/api/draft', { method: 'PUT', body: JSON.stringify(chapters) });
    },
  });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', height: '100vh' }}>
      <MejiroReader
        manuscript={draft.chapters}
        chapterIndex={draft.selectedChapterIndex}
        onChapterIndexChange={draft.setSelectedChapterIndex}
        dialect="mejiro"
      />
      <YourSidePanel draft={draft} />
    </div>
  );
}
```

### Drive MejiroSpread directly with `useManuscriptLayout`

Skip the Reader chrome entirely and embed only the spread in your own UI.

<!-- doc-example: 08-custom-preview.tsx#custom-preview -->
```tsx
import type { ManuscriptChapter } from '@libraz/mejiro/book';
import { MejiroSpread, useManuscriptLayout, useMejiroBook } from '@libraz/mejiro-react';
import { useRef } from 'react';

function CustomPreview({ chapter }: { chapter: ManuscriptChapter }) {
  const { book } = useMejiroBook({ fontFamily: '"Noto Serif JP"', fontSize: 16 });
  const surface = useRef<HTMLDivElement>(null);
  const layout = useManuscriptLayout(book, { chapter, surface });
  return (
    <div ref={surface} style={{ height: '100%' }}>
      {layout.layout && (
        <MejiroSpread
          spread={layout.layout.getSpread(0)}
          pageWidth={layout.pageWidth}
          pageHeight={layout.pageHeight}
          contentHeight={layout.contentHeight}
        />
      )}
    </div>
  );
}
```

### Add notation highlighting to your manuscript textarea

`MejiroNotationHighlighter` places an overlay behind a textarea and tints the background of manuscript notation tokens (ruby, emphasis dots, tate-chu-yoko, em/strong, links, footnotes). The textarea stays fully interactive. `onValueChange` receives the new text; other textarea attributes, a native `onChange` included, reach the textarea (Vue: `v-model:value`, with the attributes passed through).

```tsx
import { MejiroNotationHighlighter } from '@libraz/mejiro-react';
import { useState } from 'react';

function Notation() {
  const [text, setText] = useState('｜漢字《かんじ》 is a ruby example.');
  return <MejiroNotationHighlighter value={text} onValueChange={setText} dialect="mejiro" />;
}
```

Token colors are plain `background` declarations selected by the `data-token` attribute, not custom properties. Override them by re-declaring the same selector (in an unlayered rule, so it wins over `mejiro-editor.css`):

```css
.mejiro-notation-token[data-token="ruby"] { background: rgba(255, 200, 200, 0.55); }
```

The token values are `ruby`, `emphasis`, `tcy`, `em`, `strong`, `link` and `footnote`; `.mejiro-notation-token` itself only sets `border-radius`.

## 6. Highlights / comments / bookmarks

Pair `useAnnotations` with the `annotations` prop on `MejiroReader` to persist highlights with about ten lines of glue.

```tsx
import { MejiroReader, type MejiroReaderHandle, useAnnotations } from '@libraz/mejiro-react';
import { useRef } from 'react';

function Reader({ bookId, epub }) {
  const handle = useRef<MejiroReaderHandle>(null);
  const { annotations, add, remove } = useAnnotations({ key: `mejiro:ann:${bookId}` });
  return (
    <MejiroReader
      ref={handle}
      epub={epub}
      annotations={annotations}
      onPageRead={(anchor) => console.log('read', anchor)}
    />
  );
}
```

`annotations` is an array of `ReaderAnnotation` (`{ chapterIndex, start, end, color? }`). The Reader filters by current chapter, computes highlight rectangles via `ChapterLayout.selectionRects`, and forwards them to `MejiroSpread`. The `storage` option follows the same interface as `useReadingPosition`, so swapping `localStorage` for a server-backed store is a drop-in change.

For asynchronous server sync, use `onAnnotationsChange` to forward each mutation (it fires synchronously after `add` / `remove` / `update` / `clear` and never on initial hydration or `key` changes; `clear()` on an empty list is a no-op and does not fire it). As with the reading position, send the bytes produced by `serializeAnnotations` so `parseAnnotations` accepts them on the next visit:

```tsx
import { serializeAnnotations } from '@libraz/mejiro';

const { annotations, add, remove } = useAnnotations({
  key: `mejiro:ann:${bookId}`,
  onAnnotationsChange: (next) => {
    void fetch(`/api/books/${bookId}/annotations`, {
      method: 'PUT',
      body: serializeAnnotations(next),
    });
  },
});
```

---

## Related Documentation

- [Getting Started](./01-getting-started.md) -- Installation and basic usage
- [Book API](./10-api-reference.md) -- MejiroBook, ChapterLayout, image exclusion
- [Pagination & Rendering](./07-pagination-and-rendering.md) -- Low-level paginate, buildRenderPage, CSS
- [API Reference](./10-api-reference.md) -- Complete API listing
