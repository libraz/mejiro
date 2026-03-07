# ReactとVueコンポーネント

> **注意:** `@libraz/mejiro-react` および `@libraz/mejiro-vue` は実験的パッケージです。今後のリリースでAPIが変更される可能性があります。

## 1. React

### インストール

```bash
npm install @libraz/mejiro @libraz/mejiro-react
# peerDependency: react >=18
```

### MejiroPage コンポーネント

Props:

- `page: RenderPage` — 必須。`buildRenderPage()` から取得したレンダーページデータ
- `className?: string` — ルート div に追加するCSSクラス
- `style?: CSSProperties` — 追加のインラインスタイル

```tsx
import { MejiroPage } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro.css';

<MejiroPage page={renderPage} className="my-reader" />
```

### 完全なReactの例

レイアウト、ページネーション、ページナビゲーションを含む完全なコンポーネント:

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

### インストール

```bash
npm install @libraz/mejiro @libraz/mejiro-vue
# peerDependency: vue >=3.3
```

### MejiroPage コンポーネント

Props:

- `page: RenderPage` — 必須。`buildRenderPage()` から取得したレンダーページデータ

```vue
<script setup lang="ts">
import { MejiroPage } from '@libraz/mejiro-vue';
import '@libraz/mejiro/render/mejiro.css';
</script>

<template>
  <MejiroPage :page="renderPage" />
</template>
```

### 完全なVueの例

レイアウト、ページネーション、ページナビゲーションを含む完全なコンポーネント:

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

## 3. スタイリング

両コンポーネントは `mejiro-` プレフィックス付きのCSSクラスを使用してレンダリングします。スタイルシートでこれらをオーバーライドできます:

```css
/* ページ背景のカスタマイズ */
.mejiro-page {
  background: #f5f0e8;
  padding: 2em;
}

/* 段落間隔のカスタマイズ */
.mejiro-paragraph {
  margin-left: 0.6em;
}

/* 見出しスタイルのカスタマイズ */
.mejiro-paragraph--heading {
  font-size: 1.6em;
  color: #333;
}

/* ルビサイズのカスタマイズ */
.mejiro-page rt {
  font-size: 0.45em;
  color: #666;
}
```

---

## 関連ドキュメント

- [はじめに](./01-getting-started.md) -- インストールと基本的な使い方
- [ページネーションとレンダリング](./07-pagination-and-rendering.md) -- paginate、buildRenderPage、CSS
- [APIリファレンス](./10-api-reference.md) -- 完全なAPI一覧
