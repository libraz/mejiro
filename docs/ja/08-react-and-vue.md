# ReactとVueコンポーネント

> **注意:** `@libraz/mejiro-react` および `@libraz/mejiro-vue` は実験的パッケージです。今後のリリースでAPIが変更される可能性があります。

両パッケージは2つのコンポーネントと画像オーバーレイのhook/composableを提供します:

- **`MejiroPageView`**（推奨）-- 高レベル `MejiroBook` APIの `PageResult` をレンダリング。画像がある場合はスロットベースのレンダリングに自動切替。
- **`useImageOverlay`** -- ドラッグ・リサイズ可能な画像オーバーレイを管理するhook（React）/ composable（Vue）。リアルタイムのテキストリフローに対応。
- **`MejiroPage`**（低レベル）-- 生の `RenderPage` を直接レンダリング。手動ページネーション向け。

## 1. React

### インストール

```bash
npm install @libraz/mejiro @libraz/mejiro-react
# peerDependency: react >=18
```

### MejiroPageView（推奨）

`MejiroPageView` は `ChapterLayout.getSpread()` から取得した `PageResult` を受け取り、レンダリングを自動的に処理します。画像がある場合はスロットベースの絶対配置を使用します。

Props:

| Prop | 型 | 説明 |
|------|------|-------------|
| `result` | `PageResult` | 必須。`layout.getSpread()` から取得したページデータ。 |
| `fontFamily` | `string` | スロットベースレンダリング用のフォントファミリー。 |
| `lineSpacing` | `number` | スロットベースレンダリング用の行間倍率。 |
| `slotMode` | `boolean` | スロットベースレンダリングを強制（いずれかの見開きに画像がある場合は `true` に設定）。 |
| `className` | `string` | 追加のCSSクラス。 |
| `style` | `CSSProperties` | 追加のインラインスタイル。 |

### 完全なReactの例

`MejiroBook`、見開きナビゲーション、画像オーバーレイを使用した完全なコンポーネント:

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

### useImageOverlay フック

`useImageOverlay` はドラッグ・リサイズ可能な画像矩形を管理し、レイアウトエンジンと同期してリアルタイムのテキストリフローを行います。

```ts
const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, spreadIdx, onUpdate, options?);
```

パラメータ:

| パラメータ | 型 | 説明 |
|-----------|------|-------------|
| `layout` | `ChapterLayout \| null` | 現在のチャプターレイアウト。 |
| `spreadIdx` | `number` | 現在の見開きインデックス。 |
| `onUpdate` | `(spread: SpreadResult) => void` | リフロー後に呼ばれるコールバック。 |
| `options` | `UseImageOverlayOptions` | デフォルトのサイズ・位置（`defaultWidth`、`defaultHeight`、`defaultX`、`defaultY`、`margin`）。 |

戻り値:

| フィールド | 型 | 説明 |
|-------|------|-------------|
| `imageRect` | `ImageRect \| null` | 現在の矩形 `{ x, y, w, h }`、またはオーバーレイがない場合は `null`。 |
| `hasImage` | `boolean` | オーバーレイがアクティブかどうか。 |
| `toggleImage` | `() => void` | オーバーレイのオン/オフを切替。 |
| `onOverlayPointerDown` | `(e: PointerEvent) => void` | ドラッグ用にオーバーレイdivにアタッチ。 |
| `onResizePointerDown` | `(e: PointerEvent) => void` | リサイズ用にコーナーハンドルにアタッチ。 |

### MejiroPage（低レベル）

低レベルの `MejiroPage` コンポーネントと手動ページネーションについては、[APIリファレンス](./10-api-reference.md)を参照してください。

---

## 2. Vue

### インストール

```bash
npm install @libraz/mejiro @libraz/mejiro-vue
# peerDependency: vue >=3.3
```

### MejiroPageView（推奨）

React版と同じ機能を提供します。CSS `writing-mode` レンダリングとスロットベースの絶対配置を自動的に切り替えます。

Props:

| Prop | 型 | 説明 |
|------|------|-------------|
| `result` | `PageResult` | 必須。`layout.getSpread()` から取得したページデータ。 |
| `fontFamily` | `string` | スロットベースレンダリング用のフォントファミリー。 |
| `lineSpacing` | `number` | スロットベースレンダリング用の行間倍率。 |
| `slotMode` | `boolean` | スロットベースレンダリングを強制。 |

### 完全なVueの例

`MejiroBook`、見開きナビゲーション、画像オーバーレイを使用した完全なコンポーネント:

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

### useImageOverlay コンポーザブル

Reactのフックと同じ機能ですが、`layout` と `spreadIdx` に **Vue Ref** を受け取り、リアクティブな **Ref** を返します。

```ts
const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, spreadIdx, onUpdate, options?);
```

パラメータ:

| パラメータ | 型 | 説明 |
|-----------|------|-------------|
| `layout` | `Ref<ChapterLayout \| null>` | チャプターレイアウトへのRef。 |
| `spreadIdx` | `Ref<number>` | 現在の見開きインデックスへのRef。 |
| `onUpdate` | `(spread: SpreadResult) => void` | リフロー後に呼ばれるコールバック。 |
| `options` | `UseImageOverlayOptions` | デフォルトのサイズ・位置。 |

戻り値:

| フィールド | 型 | 説明 |
|-------|------|-------------|
| `imageRect` | `Ref<ImageRect \| null>` | リアクティブな矩形。 |
| `hasImage` | `Ref<boolean>` | リアクティブなcomputed boolean。 |
| `toggleImage` | `() => void` | オーバーレイの切替。 |
| `onOverlayPointerDown` | `(e: PointerEvent) => void` | ドラッグ用にアタッチ。 |
| `onResizePointerDown` | `(e: PointerEvent) => void` | リサイズ用にアタッチ。 |

### MejiroPage（低レベル）

低レベルの `MejiroPage` コンポーネントと手動ページネーションについては、[APIリファレンス](./10-api-reference.md)を参照してください。

---

## 3. スタイリング

`MejiroPageView` と `MejiroPage` はどちらも `mejiro-` プレフィックス付きのCSSクラスを使用してレンダリングします。スタイルシートでこれらをオーバーライドできます:

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
- [Book API](./09-book-api.md) -- MejiroBook、ChapterLayout、画像除外
- [ページネーションとレンダリング](./07-pagination-and-rendering.md) -- 低レベルのpaginate、buildRenderPage、CSS
- [APIリファレンス](./10-api-reference.md) -- 完全なAPI一覧
