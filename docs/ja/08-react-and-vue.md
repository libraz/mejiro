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
| `goToChapter` | `(index: number) => void` | 章へ移動し（インデックスは書籍の章の範囲に丸める）、見開きを 0 にリセット。 |
| `getReadingPosition` | `() => ReadingPosition` | 現在の `{ chapter, spreadIdx, totalPages, totalSpreads }` を取得。 |
| `goToAnchor` | `(anchor: ReadingAnchor) => Promise<void>` | `ReadingAnchor` へ移動。章が異なれば章を切り替えてからアンカー解決。書籍の読み込み前に呼んだ場合は、読み込み後に適用されます。Promise は見開きが適用された時点で resolve し、アンカーの章や位置が書籍に存在しない場合は移動せずに resolve します。続けて別の `goToAnchor` が呼ばれた場合、先の Promise は即座に resolve（supersede）。アンマウント時も resolve するので `await` がハングしません。 |
| `getAnchor` | `() => ReadingAnchor \| null` | 現在の見開きに表示中の本文の先頭の `ReadingAnchor`。レイアウト未確定時は `null`。画像がページ全体を覆っているときは、本文のある次のページから取ります。 |
| `getVisibleRange` | `() => { start, end } \| null` | 見開きに表示中のアンカー半開区間（`end` は本文のある次の見開きの本文先頭、なければ章末）。 |
| `setOptions` | `(partial: Partial<BookOptions>) => Promise<void>` | フォントや行間などを実行時変更。再計測・再レイアウトを伴います。 |
| `subscribe` | `(event, listener) => () => void` | ライフサイクルイベントを購読。返り値で解除。 |

`subscribe` で購読できるイベント:

| イベント | ペイロード | 発火タイミング |
|---------|-----------|---------------|
| `spreadChanged` | `{ chapter, spreadIdx }` | 見開きが切り替わった後。 |
| `turnStart` | `{ from }` | めくりアニメーション開始時（表示前）。 |
| `turnEnd` | `{ to }` | めくりアニメーション完了時。 |
| `chapterFinished` | `{ chapter }` | 章の最終見開きに到達したとき。`onChapterCompleted` プロップと同等。 |

読み込み後に最初に落ち着いた位置は基準点として扱い、イベントは発火しません。以降は章か見開きインデックスが変わるたびに `spreadChanged` が 1 回発火し、新しいインデックスが章の最後であれば続けて `chapterFinished` が発火します。インデックスが変わらない再レイアウトでは何も発火しません。`onPageRead(anchor, dwellMs)` プロップも同じ遷移で呼ばれ、離れた側の見開きを受け取ります。React と Vue は同じ順序でイベントを発火します。

単ページ表示（`spreadMode="single"`、または縦長の表示面での `"auto"`）では 1 ページずつ表示し、上記の見開きインデックスはすべてページ単位になります。対象は `goToSpread`・`next` / `prev`・`spreadIdx` / `totalSpreads`・`spreadChanged` のペイロード・`onSpreadIdxChange` です。`getAnchor` と `getVisibleRange` も現在のページを対象にします。`"auto"` がモードを切り替えるときは、表示中のページが見えたままになるようインデックスを換算します。

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

// 保存されたアンカーへの復帰はマウント時に 1 回だけ行う。依存配列に position を
// 入れると下の save() のたびに再実行され、ページをめくるたびに引き戻される。
useEffect(() => {
  if (position) reader.current?.goToAnchor(position);
}, []);

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

どちらのモードでも、段落（フロー）や行（スロット）には同じ `mejiro-paragraph--*` クラスが付きます。章に画像が入っても、引用・整形済みテキスト・場面転換・図版のスタイルはそのまま残ります。スロットモードで各列の位置とサイズはインラインで指定し、太さ・書体スタイル・空白の扱いはクラスから受け取ります。

### React の例

`MejiroBook`、見開きナビゲーション、画像オーバーレイを組み合わせたコンポーネント例です。

<!-- doc-example: 08-react-vertical-reader.tsx#reader -->
```tsx
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-react';
import { useCallback, useEffect, useRef, useState } from 'react';

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

  // 計測するコンテナはどの分岐でも描画するので、最初のコミットで effect が取得できる
  if (!spread) return <div ref={containerRef}>Loading...</div>;

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
        <button type="button" onClick={() => goTo(spreadIdx - 1)} disabled={spreadIdx === 0}>
          Previous
        </button>
        <span style={{ margin: '0 1em' }}>
          {spreadIdx + 1} / {totalSpreads}
        </span>
        <button
          type="button"
          onClick={() => goTo(spreadIdx + 1)}
          disabled={spreadIdx >= totalSpreads - 1}
        >
          Next
        </button>
        <button type="button" onClick={toggleImage} style={{ marginLeft: '1em' }}>
          {hasImage ? 'Remove Image' : 'Add Image'}
        </button>
      </div>
    </div>
  );
}
```

### リフローをまたいで読書位置を保つ

`useChapterLayout` は、サーフェスのリサイズや組版に影響するオプション変更のたびに章をレイアウトし直します。ただし、現在のレイアウトを計測したときと同じボックスを報告するリサイズ通知ではリフローしません。book はすでに導出した改行ヒントを再利用するので、アナライザーが再実行されることはありません。ただし結果は新しい `ChapterLayout` インスタンスになり、下流の見開きインデックスは 0 に戻ります。フックは次の 3 段階で読書位置を引き継ぎます。Vue のコンポーザブルもまったく同じ形です。

- `capturePosition(layout)` はリフロー直前に差し替えられるレイアウトを受け取り、残すアンカー（または `null`）を返します。内容の切り替えに伴う空白化した再レイアウトでは呼ばれません。
- `pendingRestore.current` は、新しいレイアウトが揃うまでそのアンカーを保持します。
- `restorePosition(layout, anchor)` を渡した場合、新しいレイアウトが揃った時点で呼ばれます（React ではコミット後、描画前）。呼ばれる時点で `pendingRestore` はすでに空です。

<!-- doc-example: 08-reflow-options.tsx#react -->
```tsx
const layout = useChapterLayout(book, epub, chapter, surface, {
  capturePosition: (l) => l.anchorAt(spreadIdx, 'right'),
  restorePosition: (l, anchor) => setSpreadIdx(l.locateAnchor(anchor)?.spreadIdx ?? 0),
});
```

<!-- doc-example: 08-reflow-options-vue.ts#vue -->
```ts
// Vue: オプションは同じ。`layout.layout` は Ref です。
const layout = useChapterLayout(book, epub, chapter, surface, {
  capturePosition: (l) => l.anchorAt(spreadIdx.value, 'right'),
  restorePosition: (l, anchor) => {
    spreadIdx.value = l.locateAnchor(anchor)?.spreadIdx ?? 0;
  },
});
```

`restorePosition` を渡さない場合は、新しいレイアウトが揃ったあとに `pendingRestore.current` を自分で読み、`null` に戻します。見開きインデックスを自前のレイアウトエフェクトでリセットし、そのあとで復元したいコンポーネントにはこちらが向いています。原稿プレビュー用の `useManuscriptLayout` も同じオプションを受け取り、同じ `pendingRestore` を返します。

### useImageOverlay フック

`useImageOverlay` はドラッグ・リサイズ可能な画像矩形を管理し、レイアウトエンジンと同期してリアルタイムのテキストリフローを行います。レイアウトが差し替わったときや見開きが変わったときには排除を再登録するため、リサイズやページ送りのあともテキストは画像を避けて流れ続けます。React では `margin` オプションが変わったときも再登録します。Vue のコンポーザブルはオプションを呼び出し時に 1 度だけ読みます。ドラッグは `isPrimaryPointerPress` が受け付ける押下（タッチ、ペン、マウスの主ボタン）でだけ始まり、`MejiroSpread` はオーバーレイ上の押下ではページをめくりません。`enableImageOverlay` を有効にした `MejiroReader` は、本を読み込んだときと章が変わったときにオーバーレイを消去します。

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

読書位置の永続化は React 版と同じ方法で行います。`useReadingPosition` は `ReadingAnchor` を保存し、ハンドルの `getAnchor` で取得して `goToAnchor` で復帰します。見開き番号（`:spread-idx`）はリフローで変わるため、保存形式には使えません。

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { MejiroReader, type MejiroReaderHandle, useReadingPosition } from '@libraz/mejiro-vue';

const props = defineProps<{ bookId: string; url: string }>();
const reader = ref<MejiroReaderHandle | null>(null);
const { position, save } = useReadingPosition({ key: `mejiro:position:${props.bookId}` });

// 復帰はマウント時に 1 回だけ。position を watch すると save() のたびに再実行される。
onMounted(() => {
  if (position.value) void reader.value?.goToAnchor(position.value);
});

function onSpreadChange(): void {
  const anchor = reader.value?.getAnchor();
  if (anchor) save(anchor);
}
</script>

<template>
  <MejiroReader ref="reader" :epub-url="url" @spread-change="onSpreadChange" />
</template>
```

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

<!-- doc-example: 08-vue-reader.vue -->
```vue
<script setup lang="ts">
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-vue';
import { computed, onMounted, ref, shallowRef } from 'vue';

const props = defineProps<{ paragraphs: { text: string }[] }>();

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

const containerRef = ref<HTMLElement | null>(null);
const layout = shallowRef<ChapterLayout | null>(null);
const spread = shallowRef<SpreadResult | null>(null);
const spreadIdx = ref(0);
const pageSize = ref({ w: 0, h: 0 });

// Image overlay composable (note: takes Vue Refs for layout and spreadIdx)
const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, spreadIdx, (s) => {
    spread.value = s;
  });

const totalSpreads = computed(() => (spread.value ? Math.ceil(spread.value.totalPages / 2) : 0));

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
| ノーテーション補助 | 段落の選択範囲にルビ／注釈を当てる。場面転換はテキストを持たないため、場面転換を選択している間はテキスト欄が読み取り専用になり、テキストとルビの適用ボタンは無効になる | `MejiroNotationHighlighter` 連携のテキストエディタ・圏点／TCY／em／strong ボタン。これらの記法を認識するのは `mejiro` 方言だけなので、ボタンは `mejiro` 方言のときだけ表示される |
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

/* 見出しスタイルのカスタマイズ。見出しのサイズと前後の間隔は
   --mejiro-paragraph-scale に従うので、font-size ではなくスケールを変えます。 */
.mejiro-paragraph--heading {
  color: #333;
}

/* renderEpubStatic の出力は見出しサイズをスタイルシートから受け取ります。 */
.mejiro-page--static .mejiro-paragraph--h1 {
  --mejiro-paragraph-scale: 1.8;
}

/* ルビサイズのカスタマイズ */
.mejiro-page rt {
  font-size: 0.45em;
  color: #666;
}
```

`ChapterLayout` から作ったページの見出しサイズは、スタイルシートでは決まりません。ページコンポーネントがレイアウトの計測に使ったスケールを `--mejiro-paragraph-scale` としてインラインで設定するためです。サイズは book オプションの `headingScale` / `headingStyles` で変えてください。そうすれば計測と描画が食い違いません。

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

<!-- doc-example: 08-custom-preview.tsx#custom-preview -->
```tsx
import type { ManuscriptChapter } from '@libraz/mejiro/book';
import { MejiroSpread, useManuscriptLayout, useMejiroBook } from '@libraz/mejiro-react';
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

`annotations` は `{ chapter, start, end, color? }` の配列です。Reader は現在の章のエントリだけを `ChapterLayout.selectionRects` でハイライト矩形に変換し、`MejiroSpread` に渡します。`storage` オプションは `useReadingPosition` と同じインターフェースなので、`localStorage` をサーバー側のストアに差し替えるだけで済みます。

サーバーと非同期に同期するには、`onChange` で変更を 1 件ずつ転送します。`onChange` は `add` / `remove` / `update` / `clear` の直後に同期的に呼ばれ、初回のハイドレーションでは呼ばれません。読書位置と同様に、送信するバイト列は `serializeAnnotations` で作ってください。次回の訪問時に `parseAnnotations` がそのまま受け付けます。

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
