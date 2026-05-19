# mejiro

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/mejiro/ci.yml?branch=main&label=CI)](https://github.com/libraz/mejiro/actions)
[![npm](https://img.shields.io/npm/v/@libraz/mejiro)](https://www.npmjs.com/package/@libraz/mejiro)
[![codecov](https://codecov.io/gh/libraz/mejiro/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/mejiro)
[![License](https://img.shields.io/github/license/libraz/mejiro)](https://github.com/libraz/mejiro/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)

mejiro は、Web で日本語の縦書きを扱うための組版エンジンです。改行、禁則処理、ぶら下げ、ルビ、画像の回り込み、ページ分割、EPUB の読み書きに対応し、React / Vue 向けのリーダー・エディタコンポーネントも提供します。コア部分は DOM に依存しないため、ブラウザ以外の環境でも使えます。

<p align="center">
  <img src="docs/images/wagahai.jpg" alt="mejiro デモ — 夏目漱石「吾輩は猫である」縦書き表示" width="640">
</p>

## インストール

```bash
npm install @libraz/mejiro   # or yarn / pnpm / bun
```

## 概要

mejiro は、日本語縦書き（`writing-mode: vertical-rl`）をアプリケーションに組み込むための部品をまとめたライブラリです。低レベルの改行計算だけを使うことも、EPUB を読み込んで見開きページとして表示することもできます。

コアエンジンは TypedArray と数値計算だけで動くようにしてあり、DOM や Canvas には依存しません。フォント計測などブラウザ固有の処理、EPUB の解析・生成、React / Vue コンポーネントは、それぞれ別のエントリポイントから利用できます。

```
@libraz/mejiro          コア: 改行、禁則、ぶら下げ、ルビ、画像回り込み、ページ分割
@libraz/mejiro/browser  ブラウザ: フォント計測、幅キャッシュ、レイアウト補助
@libraz/mejiro/epub     EPUB: 解析、編集、書き戻し、原稿からの EPUB 生成
@libraz/mejiro/render   レンダリング: レイアウト結果をページ構造と CSS に変換
@libraz/mejiro/book     ブック: レイアウト、ページ分割、画像回り込みをまとめた高レベル API
@libraz/mejiro/image    画像: ブラウザでのデコード、縮小、再エンコード
```

## アーキテクチャ

```
アプリケーション（React / Vue / vanilla DOM）
       ↓
  @libraz/mejiro/book     MejiroBook で章をレイアウトし、ページや見開きを取得
       ↓
  @libraz/mejiro/render   RenderPage 構造と CSS に変換
       ↓
  @libraz/mejiro/epub     EPUB から本文とルビ注釈を取り出す
       ↓
  @libraz/mejiro/browser  フォントを読み込み、文字幅を計測
       ↓
  @libraz/mejiro          改行、禁則、ぶら下げ、ルビ、ページ分割
```

- **コア**は外部依存なしで使えます。
- **ブラウザ層**は Canvas API と FontFace API を使って文字幅を計測します。
- **EPUB 層**は `jszip` を使って EPUB を読み書きします。
- **レンダリング層**はレイアウト結果を、フレームワークに依存しない `RenderPage` へ変換します。
- **ブック層**を使うと、`MejiroBook` → `ChapterLayout` → `SpreadResult` の流れで章や見開きを扱えます。

## クイックスタート

```ts
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { getLineRanges, paginate } from '@libraz/mejiro';

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

const text = '吾輩は猫である。名前はまだ無い。';

// 1. テキストをレイアウトする（fontFamily / fontSize はインスタンスの設定を使う）
const result = await mejiro.layout({
  text,
  lineWidth: mejiro.verticalLineWidth(600), // コンテナの高さから実際に使う行幅を求める
});

// 2. 行範囲を取得 → [[start, end), ...]
const lines = getLineRanges(result.breakPoints, text.length);

// 3. 幅 400px のページに分ける
const pages = paginate(400, [
  { lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 },
]);
```

### EPUB + MejiroBook（推奨）

```ts
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

// 表示領域からページサイズを計算する
book.computePageSize(document.querySelector('.reading-surface')!);

const epub = await parseEpub(epubArrayBuffer);
const layout = await book.layoutChapter(epub.chapters[0]);

// 最初の見開きを取得する
const spread = layout.getSpread(0);
// spread.right.page → RenderPage（段落 → 行 → セグメント）
// spread.right.lines / spread.right.slots → 絶対配置用
// spread.totalPages → 総ページ数

// 画像を置いて、回り込み後の見開きを取得する
const updated = layout.syncImages(0, [{ x: 80, y: 100, w: 120, h: 160 }]);
```

## API

詳しい型やオプションは [API リファレンス](docs/ja/10-api-reference.md) を参照してください。使い方のガイドは [ドキュメント](docs/ja/) にまとめています。

| サブパス | 説明 |
|---|---|
| `@libraz/mejiro` | 改行計算、禁則、ぶら下げ、ルビ、ページ分割、画像回り込みの低レベル API |
| `@libraz/mejiro/browser` | `MejiroBrowser`、フォント計測、文字幅キャッシュ |
| `@libraz/mejiro/epub` | `parseEpub()`、`EditableEpub`、`EpubProject`、`parseManuscript` |
| `@libraz/mejiro/render` | `buildRenderPage()`、`buildParagraphMeasures()`、`renderEpubStatic()`、各種 CSS |
| `@libraz/mejiro/book` | `MejiroBook`、`ChapterLayout`、検索、アンカー、スナップショット、読書時間の推定 |
| `@libraz/mejiro/image` | `prepareImage(file, opts?)` — 画像のデコード・縮小・再エンコード |
| `@libraz/mejiro-react` | React 用のリーダー、エディタ、棚表示、TOC、各種 hooks |
| `@libraz/mejiro-vue` | Vue 用のリーダー、エディタ、棚表示、TOC、各種 composables |

## 禁則処理

禁則処理は、句読点や括弧などが行頭・行末に来ないようにする日本語組版のルールです。[JIS X 4051](https://www.jisc.go.jp/app/jis/general/GnrJISNumberNameSearchList?show&jisStdNo=X4051) や [JLREQ](https://www.w3.org/TR/jlreq/) で整理されています。

mejiro では、用途に合わせて 2 つのモードを選べます。

- **Strict**（デフォルト）— 閉じ括弧、句読点、小書き仮名、長音記号、踊り字が行頭に来ないようにし、開き括弧が行末に来ないようにします。
- **Loose** — Strict を少し緩め、小書き仮名と長音記号（`ー`）の行頭配置を許可します。狭い段組みで詰まりを減らしたい場合に向いています。

**ぶら下げ組み**にも対応しています。`。` `、` `，` `．` は、次の行に送らず、行末の外側へ少しはみ出して配置できます。

独自の禁則ルールを使いたい場合は、コアの `computeBreaks()` に `LayoutInput.kinsokuRules` を渡してください。禁則文字の一覧、JIS X 4051 / JLREQ との対応、カスタムルールの例は [改行処理](docs/ja/03-line-breaking.md) にあります。

## 設計方針

- **TypedArray ベースのコア** — コードポイントは `Uint32Array`、文字送りは `Float32Array` で扱い、改行計算のホットパスでは文字列処理を避けています。
- **O(n) の改行アルゴリズム** — 禁則処理のためのバックトラックを含む、単一パスの貪欲法です。動的計画法は使っていません。
- **ルビは前処理で扱う** — ルビの幅を本文側の文字送りへ反映してから改行計算に渡すため、改行アルゴリズム本体を複雑にしません。
- **画像回り込み** — `ExclusionEngine` と `SpreadExclusionEngine` が、ページ内または見開き内の画像位置に応じて列ごとの配置を計算します。
- **決定的な出力** — 同じ入力からは常に同じ結果を返します。
- **役割を分ける** — コアは計算だけを担当し、ブラウザ層は計測、EPUB 層は読み書き、レンダリング層は表示用データの生成を担当します。

## ライセンス

[Apache License 2.0](LICENSE)

## 作者

- libraz <libraz@libraz.net>
