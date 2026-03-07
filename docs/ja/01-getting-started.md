# はじめに

このガイドでは、mejiro のインストールから最初の日本語縦書きテキストの表示までを説明します。Vanilla JS、React、Vue、またはヘッドレス（コアのみ、ブラウザ API 不要）の中から、お使いの技術スタックに合ったアプローチを選んでください。

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

## クイックスタート: ブラウザ（Vanilla JS）

この例では、`MejiroBrowser` を使って実際のフォントでテキストを計測し、禁則処理を含む改行位置を計算し、結果をページ分割して、レンダリング可能なページデータを構築します。

```ts
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import { getLineRanges, paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import '@libraz/mejiro/render/mejiro.css';

const mejiro = new MejiroBrowser();

// 1. テキストを組版する
const result = await mejiro.layout({
  text: '吾輩は猫である。名前はまだ無い。',
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: verticalLineWidth(600, 16),
});

// 2. 行範囲を取得する
const lines = getLineRanges(result.breakPoints, 16);

// 3. ページ分割する
const entries = [{
  chars: [...'吾輩は猫である。名前はまだ無い。'],
  breakPoints: result.breakPoints,
  rubyAnnotations: [],
  isHeading: false,
}];
const measures = buildParagraphMeasures(entries, { fontSize: 16, lineHeight: 1.8 });
const pages = paginate(400, measures);

// 4. レンダリングする
const page = buildRenderPage(pages[0], entries);
// page.paragraphs -> lines -> segments（テキストまたはルビ）
```

`verticalLineWidth` は、コンテナの高さとフォントサイズから、最大行幅（ピクセル単位）を算出します。`getLineRanges` は、各行を表す `[start, end)` のインデックスペアの配列を返します。`buildRenderPage` は、フレームワーク非依存の `RenderPage` 構造体を生成します。これを使って DOM ノードを構築するか、以下の React/Vue コンポーネントにそのまま渡すことができます。

## クイックスタート: React

`@libraz/mejiro-react` パッケージは、`RenderPage` オブジェクトをレンダリングする `MejiroPage` コンポーネントを提供します。

```tsx
import { useEffect, useState } from 'react';
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderPage } from '@libraz/mejiro/render';
import { MejiroPage } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro.css';

const mejiro = new MejiroBrowser();

function VerticalText() {
  const [page, setPage] = useState<RenderPage | null>(null);

  useEffect(() => {
    (async () => {
      const result = await mejiro.layout({
        text: '吾輩は猫である。名前はまだ無い。',
        fontFamily: '"Noto Serif JP"',
        fontSize: 16,
        lineWidth: verticalLineWidth(600, 16),
      });

      const entries = [{
        chars: [...'吾輩は猫である。名前はまだ無い。'],
        breakPoints: result.breakPoints,
        rubyAnnotations: [],
        isHeading: false,
      }];
      const measures = buildParagraphMeasures(entries, { fontSize: 16, lineHeight: 1.8 });
      const pages = paginate(400, measures);
      setPage(buildRenderPage(pages[0], entries));
    })();
  }, []);

  if (!page) return null;
  return <MejiroPage page={page} />;
}
```

`MejiroBrowser` はコンポーネントの外側で一度だけ生成してください。そうすることで、内部の文字幅キャッシュがレンダリングをまたいで保持されます。

## クイックスタート: Vue

`@libraz/mejiro-vue` パッケージは、Vue 3 向けの同等の `MejiroPage` コンポーネントを提供します。

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderPage } from '@libraz/mejiro/render';
import { MejiroPage } from '@libraz/mejiro-vue';
import '@libraz/mejiro/render/mejiro.css';

const mejiro = new MejiroBrowser();
const page = ref<RenderPage | null>(null);

onMounted(async () => {
  const result = await mejiro.layout({
    text: '吾輩は猫である。名前はまだ無い。',
    fontFamily: '"Noto Serif JP"',
    fontSize: 16,
    lineWidth: verticalLineWidth(600, 16),
  });

  const entries = [{
    chars: [...'吾輩は猫である。名前はまだ無い。'],
    breakPoints: result.breakPoints,
    rubyAnnotations: [],
    isHeading: false,
  }];
  const measures = buildParagraphMeasures(entries, { fontSize: 16, lineHeight: 1.8 });
  const pages = paginate(400, measures);
  page.value = buildRenderPage(pages[0], entries);
});
</script>

<template>
  <MejiroPage v-if="page" :page="page" />
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

## 次のステップ

- [コアコンセプト](02-core-concepts.md) -- アーキテクチャとデータフロー
- [改行処理](03-line-breaking.md) -- 禁則処理とぶら下げ組みの詳細
- [ブラウザ統合](05-browser-integration.md) -- MejiroBrowser クラスの詳細
- [React と Vue](08-react-and-vue.md) -- コンポーネントの完全な使用例
- [API リファレンス](10-api-reference.md) -- API 一覧
