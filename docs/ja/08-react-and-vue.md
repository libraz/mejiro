# React と Vue コンポーネント

React / Vue パッケージには、リーダー、エディタ、本棚、目次、ページ、オーバーレイ系コンポーネントと hooks / composables が含まれています。

- **`MejiroPageView`**（推奨）-- 高レベル API の `PageResult` を表示します。画像がある場合はスロットベース表示へ自動で切り替わります。
- **`useImageOverlay`** -- ドラッグ・リサイズ可能な画像オーバーレイを管理する hook（React）/ composable（Vue）です。移動に合わせてテキストを再レイアウトします。
- **`MejiroPage`**（低レベル）-- `RenderPage` を直接表示します。手動でページ分割する場合に使います。

## 1. React

### インストール

```bash
npm install @libraz/mejiro @libraz/mejiro-react react
npm install -D @types/react
```

peer dependency は `react >= 18` です。TypeScript プロジェクトでは、利用する React バージョンに合う `@types/react >= 18` もインストールしてください。

### コンポーネントの選び方

- **`<MejiroReader>`** -- 「EPUB を渡したらリーダーがそのまま立ち上がる」全部入りコンポーネント。ヘッダー、章ナビ、設定パネル、見開き、ページめくり、キーボード操作などをまとめて提供します。投稿サイト等の「公開閲覧画面」用途では、まずこれを使うのが最短です。
- **`<MejiroEditor>` / `<MejiroManuscriptEditor>`** -- 既存 EPUB を編集するエディタと、原稿テキストから EPUB を生成するエディタです。`useEditableEpub` / `useEpubProject` を組み合わせてヘッドレスにも使えます。
- **`<MejiroPageView>`** -- 1 ページ単位の低レベル表示。リーダーの周りの UI（コメント欄、SNS シェア等）を自前で組みたい場合に、自前の見開きレイアウト内に配置します。
- **`<MejiroPage>`** -- 最低レベル。`RenderPage` 1 ページを CSS `writing-mode: vertical-rl` でレンダリングするだけのコンポーネントで、独自のページ分割ロジックを使う場合に利用します。

### MejiroReader（フルリーダー）

ソースの渡し方は3通りあり、TypeScript の判別共用体で混在を防いでいます。

```tsx
import { MejiroReader } from '@libraz/mejiro-react';

// 1. URL から fetch して開く（最短）
<MejiroReader epubUrl="/books/sample.epub" />

// 2. すでに parseEpub 済みの EpubBook を渡す（サーバ事前パース等）
<MejiroReader epub={epubBook} />

// 3. ファイル入力／ドラッグ&ドロップで開かせる
<MejiroReader enableDropZone />
```

`bare` で chrome をまとめて消し、`enableHeader` / `enableChapterNav` / `enableSettings` などで個別に再オプトインできます。

```tsx
<MejiroReader epubUrl="/books/sample.epub" bare enableChapterNav />
```

#### MejiroReader の imperative handle

`ref` には `MejiroReaderHandle` が渡り、ホスト側のボタン UI から操作したり、読書位置をサーバへ永続化したりするのに使えます。

```tsx
import { useRef } from 'react';
import type { MejiroReaderHandle } from '@libraz/mejiro-react';

const reader = useRef<MejiroReaderHandle>(null);

<MejiroReader ref={reader} epubUrl="/books/sample.epub" />

reader.current?.goToSpread(12);
```

| メソッド | シグネチャ | 用途 |
|----------|-----------|------|
| `goToSpread` | `(index: number) => void` | 見開きインデックスへジャンプ（範囲外はクランプ）。 |
| `next` | `() => void` | 1 見開き進める。 |
| `prev` | `() => void` | 1 見開き戻す。 |
| `goToChapter` | `(index: number) => void` | 章へ移動し、見開きを 0 にリセット。 |
| `getReadingPosition` | `() => ReadingPosition` | 現在の `{ chapter, spreadIdx, totalPages, totalSpreads }` を取得。 |
| `goToAnchor` | `(anchor: ReadingAnchor) => void` | `ReadingAnchor` へ移動。章が異なれば章を切り替えてからアンカー解決。 |
| `getAnchor` | `() => ReadingAnchor \| null` | 現在の見開き先頭の `ReadingAnchor`。レイアウト未確定時は `null`。 |
| `getVisibleRange` | `() => { start, end } \| null` | 見開きに表示中のアンカー半開区間（`end` は次見開き先頭または章末）。 |
| `setOptions` | `(partial: Partial<BookOptions>) => Promise<void>` | フォントや行間などを実行時変更。再計測・再レイアウトを伴います。 |
| `subscribe` | `(event, listener) => () => void` | ライフサイクルイベントを購読。返り値で解除。 |

`subscribe` で購読できるイベント:

| イベント | ペイロード | 発火タイミング |
|---------|-----------|---------------|
| `spreadChanged` | `{ chapter, spreadIdx }` | 見開きが切り替わった後。 |
| `turnStart` | `{ from }` | めくりアニメーション開始時（表示前）。 |
| `turnEnd` | `{ to }` | めくりアニメーション完了時。 |
| `chapterFinished` | `{ chapter }` | 章の最終見開きに到達したとき。`onChapterCompleted` プロップと同等。 |

#### 読書位置の永続化

`useReadingPosition` は `ReadingAnchor`（`{ chapter, paragraph, charIndex }`）形式で位置を保存します。スプレッド番号と違い、フォントサイズ変更や画面リサイズで再ページネーションされてもアンカーは保持されるため、リフロー耐性のある永続化に向いています。

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
  // storage を省略すると window.localStorage を使用。
  // サーバ保存にする場合は { getItem, setItem, removeItem } を実装して渡す。
});

// マウント後に保存されたアンカーへ復帰
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

`storage` は `localStorage` 互換の最小インターフェース（`getItem` / `setItem` / `removeItem`）を持つ任意の実装を受け付けます。サーバへ非同期書き込みする場合はラッパーを書いてください。

### MejiroPageView（推奨）

`MejiroPageView` は `ChapterLayout.getSpread()` から取得した `PageResult` を受け取り、ページを表示します。画像があるページではスロットベースの絶対配置を使います。

Props:

| Prop | 型 | 説明 |
|------|------|-------------|
| `result` | `PageResult` | 必須。`layout.getSpread()` から取得したページデータ。 |
| `fontFamily` | `string` | スロットベースレンダリング用のフォントファミリー。 |
| `lineSpacing` | `number` | スロットベースレンダリング用の行間倍率。 |
| `slotMode` | `boolean` | スロットベースレンダリングを強制（いずれかの見開きに画像がある場合は `true` に設定）。 |
| `className` | `string` | 追加のCSSクラス。 |
| `style` | `CSSProperties` | 追加のインラインスタイル。 |

### React の例

`MejiroBook`、見開きナビゲーション、画像オーバーレイを組み合わせたコンポーネント例です。

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

低レベルの `MejiroPage` コンポーネントと手動ページ分割については、[API リファレンス](./10-api-reference.md)を参照してください。

---

## 2. Vue

### インストール

```bash
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

peer dependency は `vue >= 3.3` です。

### コンポーネントの選び方

React 版と同じ階層の高レベル → 低レベル順です。`<MejiroReader>` が「リーダー全部入り」、`<MejiroEditor>` / `<MejiroManuscriptEditor>` がエディタ、`<MejiroPageView>` がページ単位の表示、`<MejiroPage>` が最低レベル（`RenderPage` を直接レンダリング）です。

### MejiroReader（フルリーダー）

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
  <button @click="jump">12 見開き目へ</button>
</template>
```

ソース指定は React 版と同じ3通り（`epub-url` / `epub` / 未指定で drop-zone）です。`MejiroReaderHandle` は React 版と同じシグネチャを公開しているため、メソッド一覧は [React 側の表](#mejiroreader-の-imperative-handle) を参照してください。Vue 版では `ref` の `.value` 経由で呼び出します。

読書位置の永続化は `useReadingPosition` composable と controlled モード（`:spread-idx` + `@update:spread-idx`）の組み合わせで実装できます。

### MejiroPageView（推奨）

React 版と同じ機能を使えます。通常の CSS `writing-mode` 表示と、スロットベースの絶対配置表示を自動で切り替えます。

Props:

| Prop | 型 | 説明 |
|------|------|-------------|
| `result` | `PageResult` | 必須。`layout.getSpread()` から取得したページデータ。 |
| `fontFamily` | `string` | スロットベースレンダリング用のフォントファミリー。 |
| `lineSpacing` | `number` | スロットベースレンダリング用の行間倍率。 |
| `slotMode` | `boolean` | スロットベースレンダリングを強制。 |

### Vue の例

`MejiroBook`、見開きナビゲーション、画像オーバーレイを組み合わせたコンポーネント例です。

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

低レベルの `MejiroPage` コンポーネントと手動ページ分割については、[API リファレンス](./10-api-reference.md)を参照してください。

---

## 3. スタイリング

`MejiroPageView` と `MejiroPage` は、どちらも `mejiro-` プレフィックス付きの CSS クラスを使います。必要に応じてスタイルシートで上書きできます。

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
- [Book API](./10-api-reference.md) -- MejiroBook、ChapterLayout、画像回り込み
- [ページ分割とレンダリング](./07-pagination-and-rendering.md) -- 低レベルの paginate、buildRenderPage、CSS
- [API リファレンス](./10-api-reference.md) -- 公開 API 一覧
