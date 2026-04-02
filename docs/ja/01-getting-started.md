# はじめに

このガイドでは、mejiro のインストールから最初の日本語縦書きテキストの表示までを説明します。推奨アプローチは高レベルの `MejiroBook` API で、フォント読み込み・改行処理・ページ分割・レンダリングをわずか数ステップで実現できます。React と Vue 向けのフレームワークコンポーネントも用意されており、ブラウザ API 不要のヘッドレスコアも利用可能です。

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

React または Vue を使用する場合は、対応するコンポーネントパッケージも合わせてインストールしてください:

```bash
# React
npm install @libraz/mejiro-react

# Vue
npm install @libraz/mejiro-vue
```

## クイックスタート: EPUB リーダー（推奨）

この例では `MejiroBook` を使って EPUB ファイルを読み込み、見出しスタイル付きで章をレイアウトし、見開きページをレンダリングします。mejiro を始める最もシンプルな方法です。

```ts
import { MejiroBook, DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import '@libraz/mejiro/render/mejiro.css';

// 1. Create a MejiroBook instance
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

// 2. Compute page size from a container element
const container = document.getElementById('reader')!;
const { pageWidth, pageHeight } = book.computePageSize(container);

// 3. Load and parse an EPUB file
const response = await fetch('/book.epub');
const epub = await parseEpub(await response.arrayBuffer());

// 4. Lay out the first chapter
const layout = await book.layoutChapter(epub.chapters[0]);

// 5. Get a two-page spread (right page + left page)
const spread = layout.getSpread(0);

// spread.right  — PageResult for the right page
// spread.left   — PageResult for the left page
// spread.totalPages — total page count

// 6. Render with DOM (example for the right page)
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
      if (seg.type === 'text') {
        p.appendChild(document.createTextNode(seg.text));
      } else {
        // Ruby annotation
        const ruby = document.createElement('ruby');
        ruby.textContent = seg.base;
        const rt = document.createElement('rt');
        rt.textContent = seg.rubyText;
        ruby.appendChild(rt);
        p.appendChild(ruby);
      }
    }
  }
  pageEl.appendChild(p);
}

container.appendChild(pageEl);
```

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
| `layout.syncImages(index, images)` | 画像除外ゾーンを設定しテキストをリフロー |
| `layout.resize({ pageWidth, lineWidth })` | ウィンドウリサイズ時のリフロー |

## クイックスタート: React

`@libraz/mejiro-react` パッケージは、高レベル API の `PageResult` をレンダリングする `MejiroPageView` コンポーネントを提供します。

```tsx
import { useEffect, useRef, useState } from 'react';
import { MejiroBook, DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro.css';

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

`MejiroPageView` は `PageResult`（`layout.getSpread()` または `layout.getPage()` から取得）を受け取り、CSS 縦書きモードと画像がある場合のスロットベースレンダリングを自動的に切り替えます。

## クイックスタート: Vue

`@libraz/mejiro-vue` パッケージは、Vue 3 向けの同等の `MejiroPageView` コンポーネントを提供します。

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { MejiroBook, DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import type { SpreadResult } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-vue';
import '@libraz/mejiro/render/mejiro.css';

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

ブラウザベースのフォント計測が不要な場合（例: Node.js スクリプトや、すでに文字の送り幅を持っている場合）は、コアモジュールを直接使用できます。外部依存はゼロで、ブラウザ API も必要ありません。

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

`MejiroBrowser`、`buildParagraphMeasures`、`paginate`、`buildRenderPage` などの低レベル API については、[API リファレンス](10-api-reference.md)を参照してください。

## 次のステップ

- [コアコンセプト](02-core-concepts.md) -- アーキテクチャとデータフロー
- [改行処理](03-line-breaking.md) -- 禁則処理とぶら下げ組みの詳細
- [ブラウザ統合](05-browser-integration.md) -- MejiroBrowser クラスの詳細
- [React と Vue](08-react-and-vue.md) -- コンポーネントの完全な使用例
- [API リファレンス](10-api-reference.md) -- API 一覧
