# はじめに

このガイドでは、mejiro をインストールして、最初の縦書きページを表示するところまでを扱います。まずは高レベル API の `MejiroBook` を使うのが一番簡単です。フォント読み込み、改行処理、ページ分割、表示用データの生成までを数ステップで進められます。

React / Vue 向けのコンポーネントもあります。ブラウザ API を使わずに、改行計算だけを行うヘッドレスな使い方もできます。

## インストール

コアパッケージをインストールします:

```bash
# npm
npm install @libraz/mejiro

# yarn
yarn add @libraz/mejiro

# pnpm
pnpm add @libraz/mejiro

# bun
bun add @libraz/mejiro
```

React または Vue で使う場合は、対応するコンポーネントパッケージも入れてください:

```bash
# React
npm install @libraz/mejiro @libraz/mejiro-react react
npm install -D @types/react

# Vue
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

React を TypeScript プロジェクトで使う場合は、利用する React バージョンに合う `@types/react >= 18` もインストールしてください。
Vue の peer dependency は `vue >= 3.3` です。

## クイックスタート: EPUB リーダー（推奨）

この例では `MejiroBook` で EPUB を読み込み、最初の章を見開きページとして表示します。mejiro を試すなら、まずこの流れから始めるのが分かりやすいです。

```ts
import { MejiroBook, DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import '@libraz/mejiro/render/mejiro.css';

// 1. MejiroBook を作成する
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

// 2. 表示領域からページサイズを計算する
const container = document.getElementById('reader')!;
const { pageWidth, pageHeight } = book.computePageSize(container);

// 3. EPUB を読み込んで解析する
const response = await fetch('/book.epub');
const epub = await parseEpub(await response.arrayBuffer());

// 4. 最初の章をレイアウトする
const layout = await book.layoutChapter(epub.chapters[0]);

// 5. 最初の見開き（右ページ + 左ページ）を取得する
const spread = layout.getSpread(0);

// spread.right  — 右ページの PageResult
// spread.left   — 左ページの PageResult
// spread.totalPages — 総ページ数

// 6. DOM で表示する（右ページだけの例）
const pageEl = document.createElement('div');
pageEl.style.width = `${pageWidth}px`;
pageEl.style.height = `${pageHeight}px`;
pageEl.style.writingMode = 'vertical-rl';
pageEl.style.fontFamily = '"Noto Serif JP", serif';
pageEl.style.fontSize = '16px';
pageEl.style.lineHeight = '1.8';

for (const para of spread.right.page.paragraphs) {
  const p = document.createElement('p');
  if (para.isHeading) p.style.fontWeight = '700';
  for (const line of para.lines) {
    for (const seg of line.segments) {
      // ルビ・傍点・縦中横・em・strong・リンク・脚注参照まで、
      // 入れ子の注釈を含めて全セグメント種別を解決します。
      appendInlineNode(p, segmentToInlineNode(seg));
    }
  }
  pageEl.appendChild(p);
}

container.appendChild(pageEl);
```

`segmentToInlineNode()` は `@libraz/mejiro/render` が提供する関数で、フレームワーク非依存の小さな要素記述を返します。これを DOM に変換する処理は十数行で書けます。

```ts
import { segmentToInlineNode } from '@libraz/mejiro/render';
import type { InlineRenderNode } from '@libraz/mejiro/render';

function appendInlineNode(parent: Node, node: InlineRenderNode): void {
  if (node.type === 'text') {
    parent.appendChild(document.createTextNode(node.text));
    return;
  }
  const el = document.createElement(node.tag);
  if (node.className) el.className = node.className;
  if (node.href) el.setAttribute('href', node.href);
  if (node.title) el.title = node.title;
  for (const child of node.children) appendInlineNode(el, child);
  parent.appendChild(el);
}
```

`seg.type` を「テキストかルビか」の 2 分岐で書かないでください。通常の日本語書籍では傍点・縦中横・リンク・脚注参照のセグメントも生成され、2 分岐のコードではそれらが `<ruby>undefined<rt>undefined</rt></ruby>` として出力されてしまいます。セグメント種別の一覧は[ページ分割と描画](07-pagination-and-rendering.md)を参照してください。

EPUB ファイルを使わず、プレーンテキストの段落をレイアウトすることもできます:

```ts
const layout = await book.layoutChapter({
  paragraphs: [
    { text: '吾輩は猫である。', headingLevel: 1 },
    { text: '名前はまだ無い。どこで生れたかとんと見当がつかぬ。' },
  ],
});
```

### 主要 API

| API | 説明 |
|-----|------|
| `new MejiroBook({ fontFamily, fontSize, lineSpacing, headingStyles })` | 組版オプションを指定してレイアウトエンジンを作成 |
| `book.computePageSize(container)` | DOM 要素からページサイズを自動計算 |
| `await book.layoutChapter(chapter)` | 章をレイアウト（フォント読み込み＋改行処理＋ページ分割） |
| `layout.getSpread(index)` | 見開きページの結果を取得 |
| `layout.totalPages` | 総ページ数 |
| `layout.syncImages(index, images)` | 画像回り込みを設定し、テキストを再レイアウト |
| `layout.resize({ pageWidth, lineWidth })` | ウィンドウリサイズ時のリフロー |

## クイックスタート: React

`@libraz/mejiro-react` パッケージには、高レベル API の `PageResult` を表示する `MejiroPageView` コンポーネントがあります。

```tsx
import { useEffect, useRef, useState } from 'react';
import { MejiroBook, DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-react';

// Create once outside the component so the cache persists across renders
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

function Reader() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    (async () => {
      if (!surfaceRef.current) return;

      // Compute page dimensions from container
      const { pageWidth, pageHeight } = book.computePageSize(surfaceRef.current);
      setPageSize({ w: pageWidth, h: pageHeight });

      // Load EPUB and lay out the first chapter
      const res = await fetch('/book.epub');
      const epub = await parseEpub(await res.arrayBuffer());
      const layout = await book.layoutChapter(epub.chapters[0]);

      // Get first spread
      setSpread(layout.getSpread(0));
    })();
  }, []);

  if (!spread) return <div ref={surfaceRef} style={{ width: '100%', height: '100vh' }} />;

  const style = {
    width: pageSize.w,
    height: pageSize.h,
    fontSize: 16,
    fontFamily: '"Noto Serif JP", serif',
    lineHeight: 1.8,
  };

  return (
    <div ref={surfaceRef} style={{ display: 'flex', justifyContent: 'center' }}>
      <MejiroPageView result={spread.right} style={style} fontFamily='"Noto Serif JP", serif' lineSpacing={1.8} />
      <MejiroPageView result={spread.left} style={style} fontFamily='"Noto Serif JP", serif' lineSpacing={1.8} />
    </div>
  );
}
```

`MejiroPageView` は `PageResult`（`layout.getSpread()` または `layout.getPage()` から取得）を受け取り、通常の CSS 縦書き表示と、画像がある場合のスロットベース表示を自動で切り替えます。

## クイックスタート: Vue

`@libraz/mejiro-vue` パッケージにも、Vue 3 向けの `MejiroPageView` コンポーネントがあります。

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { MejiroBook, DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import type { SpreadResult } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-vue';

// Create once so the cache persists
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

const surfaceEl = ref<HTMLDivElement | null>(null);
const spread = ref<SpreadResult | null>(null);
const pageW = ref(0);
const pageH = ref(0);

onMounted(async () => {
  if (!surfaceEl.value) return;

  // Compute page dimensions from container
  const { pageWidth, pageHeight } = book.computePageSize(surfaceEl.value);
  pageW.value = pageWidth;
  pageH.value = pageHeight;

  // Load EPUB and lay out the first chapter
  const res = await fetch('/book.epub');
  const epub = await parseEpub(await res.arrayBuffer());
  const layout = await book.layoutChapter(epub.chapters[0]);

  // Get first spread
  spread.value = layout.getSpread(0);
});

const fontFamily = '"Noto Serif JP", serif';
const lineSpacing = 1.8;
</script>

<template>
  <div ref="surfaceEl" style="display: flex; justify-content: center; width: 100%; height: 100vh">
    <template v-if="spread">
      <MejiroPageView
        :result="spread.right"
        :style="{ width: `${pageW}px`, height: `${pageH}px`, fontSize: '16px', fontFamily, lineHeight: lineSpacing }"
        :font-family="fontFamily"
        :line-spacing="lineSpacing"
      />
      <MejiroPageView
        :result="spread.left"
        :style="{ width: `${pageW}px`, height: `${pageH}px`, fontSize: '16px', fontFamily, lineHeight: lineSpacing }"
        :font-family="fontFamily"
        :line-spacing="lineSpacing"
      />
    </template>
  </div>
</template>
```

## クイックスタート: コアのみ

ブラウザでのフォント計測が不要な場合、たとえば Node.js スクリプトで使う場合や、すでに文字ごとの送り幅を持っている場合は、コアモジュールを直接使えます。外部依存はなく、ブラウザ API も必要ありません。

```ts
import { computeBreaks, toCodepoints, getLineRanges } from '@libraz/mejiro';

const text = toCodepoints('吾輩は猫である。名前はまだ無い。');
const advances = new Float32Array(text.length).fill(16); // 1文字あたり16px

const result = computeBreaks({
  text,
  advances,
  lineWidth: 128, // 1行あたり8文字
});

const lines = getLineRanges(result.breakPoints, text.length);
// lines: [[0, 8], [8, 16]]
```

`toCodepoints` は文字列を Unicode コードポイントの `Uint32Array` に変換します（サロゲートペアを正しく処理します）。`computeBreaks` は禁則処理とぶら下げ組みの規則を含む O(n) の貪欲法改行アルゴリズムを実行し、改行位置のインデックスを返します。`getLineRanges` はそれらの改行位置を、イテレーション可能な行範囲に変換します。

`MejiroBrowser`、`buildParagraphMeasures`、`paginate`、`buildRenderPage` などの低レベル API は [API リファレンス](10-api-reference.md) にまとめています。

## 次のステップ

- [コアコンセプト](02-core-concepts.md) -- アーキテクチャとデータフロー
- [改行処理](03-line-breaking.md) -- 禁則処理とぶら下げ組みの詳細
- [ブラウザ統合](05-browser-integration.md) -- MejiroBrowser クラスの詳細
- [React と Vue](08-react-and-vue.md) -- コンポーネントの完全な使用例
- [API リファレンス](10-api-reference.md) -- API 一覧
