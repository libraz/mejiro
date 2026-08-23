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

ソースの渡し方は4通りあり、TypeScript の判別共用体で混在を防いでいます。

```tsx
import { MejiroReader } from '@libraz/mejiro-react';

// 1. URL から fetch して開く（最短）
<MejiroReader epubUrl="/books/sample.epub" />

// 2. すでに parseEpub 済みの EpubBook を渡す（サーバ事前パース等）
<MejiroReader epub={epubBook} />

// 3. ファイル入力／ドラッグ&ドロップで開かせる
<MejiroReader enableDropZone />

// 4. 原稿の章をそのまま描画する（EPUB を経由しない）
<MejiroReader manuscript={chapters} dialect="mejiro" />
```

原稿モードでは、各章の本文が空行で段落に分割され、`parseManuscript()` を通してからレイアウトされます。自作の原稿エディタでライブプレビューを出す場合はこのモードを使います。

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
| `goToAnchor` | `(anchor: ReadingAnchor) => Promise<void>` | `ReadingAnchor` へ移動。章が異なれば章を切り替えてからアンカー解決。Promise は見開きが適用された時点で resolve。続けて別の `goToAnchor` が呼ばれた場合、先の Promise は即座に resolve（supersede）。アンマウント時も resolve するので `await` がハングしません。 |
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

`storage` は `localStorage` 互換の最小インターフェース（`getItem` / `setItem` / `removeItem`）を持つ任意の実装を受け付けます。サーバへ非同期書き込みする場合は、`storage` を局所的なメモリミラーにしつつ `onChange` でサーバへ送る形が定石です。送信するバイト列は `serializeReadingPosition` で作ります。これは `storage` に書き込まれるものと同じペイロードで、次回訪問時に `parseReadingPosition` がそのまま読み戻せます。

```tsx
import { serializeReadingPosition } from '@libraz/mejiro';

const { position, save } = useReadingPosition({
  key: `mejiro:position:${bookId}`,
  onChange: (next) => {
    void fetch(`/api/books/${bookId}/position`, {
      method: next ? 'PUT' : 'DELETE',
      body: next ? serializeReadingPosition(next) : undefined,
    });
  },
});
```

次回訪問時は、保存しておいた文字列を `parseReadingPosition` に通せばアンカーが得られます（`getItem` がその文字列を返す `storage` を渡しても同じです）。

```tsx
import { parseReadingPosition } from '@libraz/mejiro';

const restored = parseReadingPosition(await loadPositionFromServer(bookId));
if (restored) reader.current?.goToAnchor(restored);
```

`onChange` は `save()` / `clear()` の直後に同期的に呼ばれます（初回ハイドレートでは発火しません）。ローカル永続化（`storage`）は debounce されたままなので、サーバ側で別レートに調整したい場合はこちらに任せます。

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

### リフローをまたいで読書位置を保つ

`useChapterLayout` は、サーフェスのリサイズや組版に影響するオプション変更のたびに完全な再レイアウトを実行します。その結果 `ChapterLayout` は新しいインスタンスになり、下流の見開きインデックスは 0 に戻ります。`capturePosition` を渡すと差し替え直前のアンカーを取得でき、新しいレイアウトが確定したあとに書き込み可能な ref である `pendingRestore` から取り出して復元します。

```tsx
const layout = useChapterLayout(book, epub, chapter, surface, {
  capturePosition: (l) => l.anchorAt(spreadIdx, 'right'),
});

useLayoutEffect(() => {
  const anchor = layout.pendingRestore.current;
  if (!(anchor && layout.layout)) return;
  layout.pendingRestore.current = null; // 消費する
  setSpreadIdx(layout.layout.locateAnchor(anchor)?.spreadIdx ?? 0);
}, [layout.layout]);
```

`pendingRestore` は mutable な ref 型なので、サポート範囲内のどの `@types/react` でも上記の代入が型検査を通ります。原稿プレビュー用の `useManuscriptLayout` にも同じ組み合わせがあります。

### useImageOverlay フック

`useImageOverlay` はドラッグ・リサイズ可能な画像矩形を管理し、レイアウトエンジンと同期してリアルタイムのテキストリフローを行います。レイアウトが差し替わったときや見開きが変わったときには排除を再登録するため、リサイズやページ送りのあともテキストは画像を避けて流れ続けます。

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

ソース指定は React 版と同じ4通り（`epub-url` / `epub` / `manuscript`（任意で `dialect`）/ 未指定で drop-zone）です。`MejiroReaderHandle` は React 版と同じシグネチャを公開しているため、メソッド一覧は [React 側の表](#mejiroreader-の-imperative-handle) を参照してください。Vue 版では `ref` の `.value` 経由で呼び出します。

読書位置の永続化は `useReadingPosition` composable と controlled モード（`:spread-idx` + `@spread-idx-change`）の組み合わせで実装できます。

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

## 3. MejiroEditor と MejiroManuscriptEditor の使い分け

「投稿サイトに採用する」観点で **どちらのエディタを選ぶか** を整理した表です。フレームワークを問わず同じ判定基準で選べます。

| 観点 | `MejiroEditor` | `MejiroManuscriptEditor` |
|---|---|---|
| 入力 | 既存の EPUB（パース済み `EpubBook` または URL） | 原稿テキスト（章の `body` 配列） |
| 編集の単位 | 段落・インライン注釈（ルビ等）・章メタデータ・画像差し込み | 章本文（mejiro 記法のテキスト）・タイトル・著者・カバー |
| 出力 | 編集後の EPUB（バイト） | 原稿チャプター配列 → EPUB へエクスポート |
| 状態管理フック | `useEditableEpub` | `useManuscriptDraft` |
| プレビュー | 段落単位のリスト + Reader 同期 | 章単位のテキストエディタ + 装飾付き `MejiroReader` |
| ノーテーション補助 | 段落の選択範囲にルビ／注釈を当てる | `MejiroNotationHighlighter` 連携のテキストエディタ・圏点／TCY／em／strong ボタン |
| 想定ユースケース | 既刊 EPUB の校正・差し替え、編集者向けワークフロー | 新規執筆、小説投稿サイト、原稿アップロード → 公開 |
| ヘッドレス分解 | `useEditableEpub` で UI を自前化可 | `useManuscriptDraft` + `MejiroReader(manuscript=...)` で UI 自前化可 |
| controlled モード | `useEditableEpub` のセレクション等を外部 state に同期 | `title` / `author` / `cover` をそれぞれ controlled prop 化可（React: `onXxxChange` を渡す／ Vue: `v-model:xxx`） |

判断のショートカット:

- **「すでに EPUB を出版済みで、後から本文を直したい」** → `MejiroEditor`
- **「新規執筆／投稿フォームから連載 → 公開」** → `MejiroManuscriptEditor`
- **「サイト側でタイトル・著者欄を別の場所で編集している（メタデータは外部 state）」** → `MejiroManuscriptEditor` を controlled モードで使う

### MejiroManuscriptEditor の controlled モード

`title` / `author` / `cover` は uncontrolled（初期値）と controlled（親が所有）の両方を sane なまま使えます。`onXxxChange`（React）または `v-model:xxx`（Vue）を付けると controlled に切り替わり、親が prop を更新するまで入力値は親側の値に追従します。

```tsx
// React: 投稿フォームの状態と統合する例
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
<!-- Vue: v-model パターン -->
<MejiroManuscriptEditor
  v-model:title="title"
  v-model:author="author"
  v-model:cover="cover"
/>
```

ハンドラを付けないと従来通りエディタ内部で状態管理されます（既存コードは変更不要）。

---

## 4. スタイリング

`MejiroPageView` と `MejiroPage` は、どちらも `mejiro-` プレフィックス付きの CSS クラスを使います。必要に応じてスタイルシートで上書きできます。

```css
/* ページ背景のカスタマイズ */
.mejiro-page {
  background: #f5f0e8;
  padding: 2em;
}

/* 段落間隔のカスタマイズ。
   vertical-rl ではブロック開始側が右側なので、段落前の間隔は margin-right です。
   margin-left を上書きしても既存の間隔は変わらず、反対側に余白が足されるだけです。 */
.mejiro-paragraph {
  margin-right: 0.6em;
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

### CSS カスケードレイヤー（ホスト側リセットがリーダー UI を壊しうる）

リーダーの UI スタイルシート（`MejiroReader` のヘッダ・設定パネル・コントロール）は CSS カスケードレイヤー内で出荷されます。

```css
@layer mejiro.base, mejiro.chrome, mejiro.print;
```

レイヤー化のおかげで、ホスト側の**レイヤー外**スタイルから詳細度の戦いなしに mejiro の UI を上書きできます（レイヤー外の宣言は常に勝つ）。ただしこの優先順位は逆にも働きます。ホストアプリのレイヤー外の**グローバルリセット**もまた、詳細度に関係なく mejiro のレイヤー内ルールに勝ってしまいます。VitePress・normalize.css・Tailwind の preflight はいずれも次のようなリセットを出荷します。

```css
button, input, optgroup, select, textarea { padding: 0; ... }  /* レイヤー外 */
```

これは設定パネルの `<select>` のドロップダウン矢印用に mejiro が確保している padding を剥がし、矢印が選択肢のテキストに重なってしまいます。mejiro はコントロールが依存する最小限のボックスモデルを `!important` で再宣言してこれに耐えていますが、きれいに埋め込むための一般的な指針は、**自前のリセットもレイヤーに入れる**ことです。そうすればリセットがすべてを踏み潰すのではなく、カスケード順序に従って参加します。

```css
@layer reset, mejiro, app;

@layer reset {
  /* normalize / preflight / 自前リセットはここに */
}
```

リセットを `mejiro` より前のレイヤーに置けば、リーダーの UI スタイルが意図どおり勝ち、`app` レイヤーからはさらにその上で上書きできます。

### ページフローへの埋め込み（`fit="width"`）

デフォルトの `MejiroReader` はコンテナの高さいっぱいに広がる（`fit="fill"`）ため、コンテナに明示的な高さが必要です。ブログ記事やドキュメントページなど通常のドキュメントフローに高さ計算なしで置きたい場合は `fit="width"` を使います。リーダーは計測した幅とページのアスペクト比から自分の高さを導出し、見開きがレターボックスなしで端まで埋まります。指定するのは幅だけです。

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

### ページ番号（`pageNumbers`）

見開きの各ページは、柱（ランニングヘッド）にそのページ自身のノンブルを表示します（右ページが奇数、左ページが偶数）。どのページに番号を出すかは `pageNumbers` で切り替えます。

| 値 | 効果 |
|---|---|
| `'both'` | 全ページに番号（デフォルト）。 |
| `'right'` | 右ページのみ。 |
| `'left'` | 左ページのみ。 |
| `'none'` | 番号を非表示。`enablePageIndicator` の「n / total」表示は独立しています。 |

```tsx
// React
<MejiroReader epubUrl="/book.epub" pageNumbers="right" />
```

```vue
<!-- Vue -->
<MejiroReader epub-url="/book.epub" page-numbers="right" />
```

---

## 5. フルカスタムエディタを組む

`MejiroManuscriptEditor` は便利な完成品ですが、投稿サイトに本格採用するなら **プリミティブから組み立てる**のが筋です。以下の素材を組み合わせれば EPUB を経由しない原稿エディタが書けます。

| 必要なもの | API |
|---|---|
| 原稿の状態管理 (章配列・autosave) | `useManuscriptDraft({ onAutosave, autosaveDelay })` |
| 1 章をプレビュー用にレイアウト | `useManuscriptLayout(book, chapter, surfaceRef, { dialect })` |
| 装飾付きプレビュー (チャプタナビ・設定込み) | `<MejiroReader manuscript={chapters} dialect="mejiro" />` |
| 自前 textarea のルビ/圏点ハイライト | `<MejiroNotationHighlighter value onChange />` |
| 完成時の EPUB 書き出し | `EpubProject.fromManuscript(...).export(...)` |

### MejiroReader を原稿でそのまま駆動する

EPUB の ZIP 経由を完全に外す最短経路です。`manuscript` を渡すだけで、装飾付きの Reader が直接プレビューになります。

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
        manuscript={draft.chapters.map((c) => ({ id: c.id, title: c.title, body: c.body }))}
        chapter={draft.selected}
        onChapterChange={draft.setSelected}
        dialect="mejiro"
      />
      <YourSidePanel draft={draft} />
    </div>
  );
}
```

### `useManuscriptLayout` で MejiroSpread を直接動かす

Reader のクロームを切って、見開きだけ自分の UI に埋め込みたいときに使います。

```tsx
import { useMejiroBook, useManuscriptLayout, MejiroSpread } from '@libraz/mejiro-react';
import { useRef } from 'react';

function CustomPreview({ chapter }: { chapter: ManuscriptChapter }) {
  const { book } = useMejiroBook({ fontFamily: '"Noto Serif JP"', fontSize: 16 });
  const surface = useRef<HTMLDivElement>(null);
  const layout = useManuscriptLayout(book, chapter, surface);
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

### 原稿入力 textarea にルビ可視化を載せる

`MejiroNotationHighlighter` は textarea 背後にオーバーレイを置き、ルビ/圏点/縦中横/em/strong/リンク/脚注の各トークンを背景色で示します。textarea は完全にインタラクティブなまま使えます。

```tsx
import { MejiroNotationHighlighter } from '@libraz/mejiro-react';
import { useState } from 'react';

function Notation() {
  const [text, setText] = useState('｜漢字《かんじ》のルビ例です。');
  return <MejiroNotationHighlighter value={text} onChange={setText} dialect="mejiro" />;
}
```

トークンの色は CSS 変数ではなく、`data-token` 属性セレクタに対する `background` 宣言です。同じセレクタを（`mejiro-editor.css` のレイヤーに勝つよう、レイヤー外の規則として）再宣言して上書きします。

```css
.mejiro-notation-token[data-token="ruby"] { background: rgba(255, 200, 200, 0.55); }
```

`data-token` の値は `ruby` / `emphasis` / `tcy` / `em` / `strong` / `link` / `footnote` です。`.mejiro-notation-token` 自体は `border-radius` だけを設定しています。

## 6. 章ハイライト / コメント / しおり

`useAnnotations` と `MejiroReader` の `annotations` prop を組み合わせると、永続化付きハイライトを 10 行ほどで実装できます。

```tsx
import { MejiroReader, useAnnotations, useReadingPosition } from '@libraz/mejiro-react';
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

`annotations` は `{ chapter, start, end, color? }` の配列。Reader は現在の章のものだけ自動でハイライト rect に変換して `MejiroSpread` に渡します。`useAnnotations` の `storage` オプションはサーバ送信に置き換え可能です (`useReadingPosition` と同じ interface)。

サーバ同期するなら、`onChange` で確定後の全件を受け取って送ります（初回ハイドレートでは発火しません）。読書位置と同様、送信するバイト列は `serializeAnnotations` で作れば次回訪問時に `parseAnnotations` がそのまま受理します。

```tsx
import { serializeAnnotations } from '@libraz/mejiro';

const { annotations, add, remove } = useAnnotations({
  key: `mejiro:ann:${bookId}`,
  onChange: (next) => {
    void fetch(`/api/books/${bookId}/annotations`, {
      method: 'PUT',
      body: serializeAnnotations(next),
    });
  },
});
```

---

## 関連ドキュメント

- [はじめに](./01-getting-started.md) -- インストールと基本的な使い方
- [Book API](./10-api-reference.md) -- MejiroBook、ChapterLayout、画像回り込み
- [ページ分割とレンダリング](./07-pagination-and-rendering.md) -- 低レベルの paginate、buildRenderPage、CSS
- [API リファレンス](./10-api-reference.md) -- 公開 API 一覧
