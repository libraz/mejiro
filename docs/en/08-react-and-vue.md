# React and Vue Components

> **Note:** `@libraz/mejiro-react` and `@libraz/mejiro-vue` are experimental. Their API may change in future releases.

## 1. React

### Installation

```bash
npm install @libraz/mejiro @libraz/mejiro-react
# peerDependency: react >=18
```

### MejiroPage Component

Props:

- `page: RenderPage` — Required. Render page data from `buildRenderPage()`
- `className?: string` — Additional CSS class for the root div
- `style?: CSSProperties` — Additional inline styles

```tsx
import { MejiroPage } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro.css';

<MejiroPage page={renderPage} className="my-reader" />
```

### Complete React Example

A full component with layout, pagination, and page navigation:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderEntry, RenderPage } from '@libraz/mejiro/render';
import { MejiroPage } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro.css';

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

interface PageData {
  pages: import('@libraz/mejiro').PageSlice[][];
  entries: RenderEntry[];
}

function VerticalReader({ text }: { text: string }) {
  const [data, setData] = useState<PageData | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    (async () => {
      const result = await mejiro.layoutChapter({
        paragraphs: [{ text }],
        lineWidth: mejiro.verticalLineWidth(600),
      });

      const entries: RenderEntry[] = [{
        chars: result.paragraphs[0].chars,
        breakPoints: result.paragraphs[0].breakResult.breakPoints,
        rubyAnnotations: [],
        isHeading: false,
      }];

      const measures = buildParagraphMeasures(entries, {
        fontSize: 16,
        lineHeight: 1.8,
      });
      const pages = paginate(400, measures);
      setData({ pages, entries });
      setPageIndex(0);
    })();
  }, [text]);

  if (!data) return <div>Loading...</div>;

  const renderPage = buildRenderPage(data.pages[pageIndex], data.entries);

  return (
    <div>
      <MejiroPage page={renderPage} style={{ height: 600, width: 400 }} />
      <div>
        <button
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
          disabled={pageIndex === 0}
        >
          Previous
        </button>
        <span>{pageIndex + 1} / {data.pages.length}</span>
        <button
          onClick={() => setPageIndex((i) => Math.min(data.pages.length - 1, i + 1))}
          disabled={pageIndex === data.pages.length - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

## 2. Vue

### Installation

```bash
npm install @libraz/mejiro @libraz/mejiro-vue
# peerDependency: vue >=3.3
```

### MejiroPage Component

Props:

- `page: RenderPage` — Required. Render page data from `buildRenderPage()`

```vue
<script setup lang="ts">
import { MejiroPage } from '@libraz/mejiro-vue';
import '@libraz/mejiro/render/mejiro.css';
</script>

<template>
  <MejiroPage :page="renderPage" />
</template>
```

### Complete Vue Example

A full component with layout, pagination, and page navigation:

```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import type { PageSlice } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderEntry, RenderPage } from '@libraz/mejiro/render';
import { MejiroPage } from '@libraz/mejiro-vue';
import '@libraz/mejiro/render/mejiro.css';

const props = defineProps<{ text: string }>();

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

const pages = ref<PageSlice[][]>([]);
const entries = ref<RenderEntry[]>([]);
const pageIndex = ref(0);

const renderPage = computed<RenderPage | null>(() => {
  if (pages.value.length === 0) return null;
  return buildRenderPage(pages.value[pageIndex.value], entries.value);
});

onMounted(async () => {
  const result = await mejiro.layoutChapter({
    paragraphs: [{ text: props.text }],
    lineWidth: mejiro.verticalLineWidth(600),
  });

  entries.value = [{
    chars: result.paragraphs[0].chars,
    breakPoints: result.paragraphs[0].breakResult.breakPoints,
    rubyAnnotations: [],
    isHeading: false,
  }];

  const measures = buildParagraphMeasures(entries.value, {
    fontSize: 16,
    lineHeight: 1.8,
  });
  pages.value = paginate(400, measures);
});
</script>

<template>
  <div v-if="renderPage">
    <MejiroPage :page="renderPage" />
    <div>
      <button @click="pageIndex = Math.max(0, pageIndex - 1)" :disabled="pageIndex === 0">
        Previous
      </button>
      <span>{{ pageIndex + 1 }} / {{ pages.length }}</span>
      <button
        @click="pageIndex = Math.min(pages.length - 1, pageIndex + 1)"
        :disabled="pageIndex === pages.length - 1"
      >
        Next
      </button>
    </div>
  </div>
  <div v-else>Loading...</div>
</template>
```

## 3. Styling

Both components render using `mejiro-` prefixed CSS classes. Override them in your stylesheet:

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
- [Pagination & Rendering](./07-pagination-and-rendering.md) -- paginate, buildRenderPage, CSS
- [API Reference](./10-api-reference.md) -- Complete API listing
