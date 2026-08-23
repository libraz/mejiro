# mejiro

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/mejiro/ci.yml?branch=main&label=CI)](https://github.com/libraz/mejiro/actions)
[![npm](https://img.shields.io/npm/v/@libraz/mejiro)](https://www.npmjs.com/package/@libraz/mejiro)
[![codecov](https://codecov.io/gh/libraz/mejiro/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/mejiro)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/mejiro/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)

**mejiro は、日本語の縦書きを組版として正しく折り返し、その結果をデータとして返すライブラリです。** 文字列か EPUB を渡すと、禁則処理・ぶら下げ・ルビ・縦中横を踏まえた改行位置が返り、ページ構造として受け取れます。表示方法は呼び出し側が自由に決められます。コアエンジンは TypedArray 上の数値計算だけで動き、DOM にも Canvas にも外部パッケージにも依存しません。そのためブラウザ、Node、サーバーサイドレンダリングのいずれでも同じ改行結果が得られます。

**こんなときに使えます**

- **日本語の改行を正しく処理したい** — JIS X 4051 / JLREQ に基づく禁則処理、ぶら下げ、本文を欠けさせないルビ、列内で分割されない縦中横。
- **EPUB を読み書きしたい** — ファイルを本文とインライン注釈に解析し、その場で編集して書き戻せます。プレーンテキストの原稿から EPUB を生成することもできます。信頼できない EPUB はリソース上限で保護されます。
- **画像に本文を回り込ませたい** — 単ページでも見開きでも列単位で回避領域を計算し、読者が画像をドラッグしている最中も再計算します。
- **リーダーやエディタを作りたい** — React / Vue のコンポーネントが同じエンジンの上に載っています。hooks だけを使って表示は自分で書くこともできます。

📖 **[ドキュメント](docs/ja/)** &nbsp;·&nbsp; **[はじめかた](docs/ja/01-getting-started.md)** &nbsp;·&nbsp; **[API リファレンス](docs/ja/10-api-reference.md)**

<p align="center">
  <img src="docs/images/wagahai.jpg" alt="mejiro デモ — 夏目漱石「吾輩は猫である」縦書き表示" width="640">
</p>

## これで何が作れる？

ブラウザ上の縦書きリーダーや原稿エディタ、サーバー側で事前生成する静的ページなどが作れます。`examples/` には形態ごとに動かせるスターターを置いてあります。ページ送り式のリーダー、見開きの EPUB エディタ、原稿執筆ツール、本棚、hooks だけを使うヘッドレス構成、フレームワークを使わない iframe 埋め込みの 6 種類です。各スターターはワークスペースの一部なので、コピーしてから依存を解決してください。

```bash
npx degit libraz/mejiro/examples/react my-reader
```

コピーした `package.json` には `workspace:*` が残ります。公開版に置き換えるワンライナーは、各スターターの README に載せてあります。

## できること

| サブパス | 内容 |
|---|---|
| `@libraz/mejiro` | コア: `computeBreaks()`、禁則、ぶら下げ、`preprocessRuby()`、`preprocessTcy()`（縦中横）、`normalizeText()` による NFC 正規化、`ExclusionEngine`、`paginate()`、読書位置の永続化 |
| `@libraz/mejiro/browser` | ブラウザ: `MejiroBrowser`、フォント計測と文字幅キャッシュ、ルビ用フォントの導出、画像のドラッグ・リサイズを扱う `createOverlayDragSession()` |
| `@libraz/mejiro/epub` | EPUB: 信頼できない入力に `EpubParseOptions.limits` を適用できる `parseEpub()`、`EditableEpub`、`cloneEditableEpubBook()`、`EpubProject`、`parseManuscript()` |
| `@libraz/mejiro/render` | レンダリング: `buildRenderPage()`、`buildParagraphMeasures()`、`segmentToInlineNode()`、`paragraphClassName()`、`renderEpubStatic()`、および `mejiro.css` / `mejiro-reader.css` / `mejiro-editor.css` / `mejiro-fonts.css` / `mejiro-print.css` |
| `@libraz/mejiro/book` | ブック: `MejiroBook`、`ChapterLayout`、`estimateReadingTime()` — レイアウト、ページ分割、画像回り込み、本文検索、アンカー、スナップショットをまとめた高レベル API |
| `@libraz/mejiro/image` | `prepareImage(file, opts?)` — 埋め込み前の画像のデコード、縮小、再エンコード |
| `@libraz/mejiro-react` | React: `<MejiroReader>`、`<MejiroEditor>`、`<MejiroManuscriptEditor>`、`<MejiroShelf>`、`<MejiroToc>`、`<MejiroPage>` と `useEpub` / `useMejiroBook` / `useChapterLayout` / `useSpread` / `useReadingPosition` / `useAnnotations` などの hooks |
| `@libraz/mejiro-vue` | Vue: React と同じコンポーネント / composable 一式 |

React 版と Vue 版は experimental です。一次 API は hooks と低レベルコンポーネントで、組み上げ済みのコンポーネントはそのリファレンス実装として提供しています。

## インストール

```bash
npm install @libraz/mejiro                     # コア、ブラウザ、EPUB、レンダリング、ブック、画像
npm install @libraz/mejiro-react react react-dom   # React コンポーネント（experimental）
npm install @libraz/mejiro-vue vue                 # Vue コンポーネント（experimental）
```

## クイックスタート

### コアのレイアウト

```ts
import { getLineRanges, paginate } from '@libraz/mejiro';
import { MejiroBrowser } from '@libraz/mejiro/browser';

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

const text = '吾輩は猫である。名前はまだ無い。';

// 1. テキストをレイアウト（fontFamily / fontSize はインスタンスの既定値）
const result = await mejiro.layout({
  text,
  lineWidth: mejiro.verticalLineWidth(600), // コンテナ高さから実効行長を求める
});

// 2. 行範囲を取得 → [[start, end), ...]
const lines = getLineRanges(result.breakPoints, text.length);

// 3. 幅 400px のページに分割
const pages = paginate(400, [
  { lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 },
]);
```

### EPUB と MejiroBook

`MejiroBook` は高レベルの入口です。計測、改行計算、ページ分割をまとめて引き受けるため、リーダー側は章と見開きだけを扱えば済みます。

```ts
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

// コンテナ要素からページサイズを自動計算
book.computePageSize(document.querySelector('.reading-surface')!);

const epub = await parseEpub(epubArrayBuffer);
const layout = await book.layoutChapter(epub.chapters[0]);

// 見開きを取得
const spread = layout.getSpread(0);
// spread.right.page → RenderPage（段落 → 行 → セグメント）
// spread.right.lines / spread.right.slots → 絶対配置用
// spread.totalPages → 総ページ数

// 画像を配置して本文を回り込ませる（更新後の見開きが返る）
const updated = layout.syncImages(0, [{ x: 80, y: 100, w: 120, h: 160 }]);
```

### React

```tsx
import { MejiroReader } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro-reader.css';

<MejiroReader file={epubFile} theme="sepia" />;
```

Vue でも `@libraz/mejiro-vue` から同じコンポーネントを使えます。props、テーマ、controlled な使い方、SSR は [React / Vue ガイド](docs/ja/08-react-and-vue.md) を参照してください。

## 日本語組版

**禁則処理**は、句読点や括弧などが行頭・行末に来ないようにする日本語組版のルールで、[JIS X 4051](https://www.jisc.go.jp/app/jis/general/GnrJISNumberNameSearchList?show&jisStdNo=X4051) や [JLREQ](https://www.w3.org/TR/jlreq/) で整理されています。mejiro には 2 つのモードがあります。

- **Strict**（既定）— 閉じ括弧、句読点、小書き仮名、長音記号、踊り字が行頭に来ないようにし、開き括弧が行末に来ないようにします。
- **Loose** — Strict を少し緩め、小書き仮名と長音記号（`ー`）の行頭配置を許可します。狭い段組みで詰まりを減らしたい場合に向いています。

**ぶら下げ組み**では、`。` `、` `，` `．` を次の行へ送らず、行末の外側へはみ出して配置します。

**ルビ**は改行計算の前に解決します。ルビの付いた範囲は本文の幅とルビの幅の広いほうを確保するため、載っている行によってルビが欠けることはありません。**縦中横**は、縦組みの列の中で横に並ぶ範囲を 1 つの正立したボックスにまとめ、改行アルゴリズムからは分割不可の塊として扱います。

独自の禁則ルールを使いたい場合は、コアの `computeBreaks()` に `LayoutInput.kinsokuRules` を渡してください。禁則文字の一覧、規格との対応、実例は [改行処理](docs/ja/03-line-breaking.md) にまとめてあります。

## アーキテクチャ

<p align="center">
  <img src="docs/assets/architecture-layers-ja.svg" alt="mejiro のレイヤ構成図 — book / epub / image が render の上に並び、render は browser とコアエンジンの上に載る" width="640">
</p>

- **コア** — 改行、禁則、ぶら下げ、ルビと縦中横の前処理、画像回り込み。外部依存はなく、DOM も使いません。
- **ブラウザ** — Canvas API と FontFace API による文字幅計測、ルビ用フォントの導出、オーバーレイのドラッグ操作。
- **レンダリング** — レイアウト結果を、フレームワークに依存しない `RenderPage` 構造と同梱スタイルシートに変換します。
- **ブック**と **EPUB** は積み重なった関係ではなく、レンダリング層の上に並ぶ兄弟です。`MejiroBook` が計測・改行・ページ分割をまとめ、EPUB 層はファイルの解析と生成を担当します（外部依存は `jszip` のみ）。互いを import しません。
- **画像**は独立しています。配置前の画像を整えるだけなので、単体でも使えます。

## ドキュメント

ガイドと API リファレンスは [`docs/ja/`](docs/ja/) にあります。

- **学ぶ** — [はじめかた](docs/ja/01-getting-started.md) · [コアの考え方](docs/ja/02-core-concepts.md) · [改行処理](docs/ja/03-line-breaking.md) · [ルビ](docs/ja/04-ruby.md)
- **組み込む** — [ブラウザ連携](docs/ja/05-browser-integration.md) · [EPUB](docs/ja/06-epub.md) · [ページ分割とレンダリング](docs/ja/07-pagination-and-rendering.md) · [React と Vue](docs/ja/08-react-and-vue.md)
- **詳細** — [応用](docs/ja/09-advanced.md) · [API リファレンス](docs/ja/10-api-reference.md)

## 設計方針

- **TypedArray ベースのコア** — コードポイントは `Uint32Array`、文字送りは `Float32Array` で扱い、改行計算のホットパスでは文字列処理を避けています。
- **O(n) の改行アルゴリズム** — 禁則処理のためのバックトラックを含む単一パスの貪欲法で、動的計画法は使っていません。
- **ルビと縦中横は前処理** — どちらも実効的な文字送りとクラスタ ID に変換してから改行計算に渡すため、改行アルゴリズム本体は変わりません。
- **決定的な出力** — 同じ入力からは常に同じ結果を返します。サーバーサイドレンダリングやスナップショットの再生が成り立つのはこのためです。
- **役割を分ける** — コアは計算だけ、ブラウザ層は計測、EPUB 層は読み書き、レンダリング層は表示用データの生成を担当します。最終的な DOM の出力は呼び出し側の役割です。

## 含まないもの（Non-goals）

mejiro が扱うのは組版の計算までで、描画そのものは行いません。独自のレンダラー、横組みのレイアウトエンジン、フォントファイルの解析（計測は Canvas 経由です）、スタイルシート以上の PDF / 印刷パイプラインは持ちません。EPUB 対応も、日本語縦書きリーダーに必要な範囲を対象としており、固定レイアウト EPUB、音声オーバーレイ、DRM は対象外です。React / Vue パッケージは hooks のリファレンス実装であり、デザインシステムではありません。

## セキュリティ

脆弱性の報告は公開 issue ではなく [`SECURITY.md`](SECURITY.md) の手順でお願いします。EPUB の解析は信頼できないアーカイブを受け取る前提で、`EpubParseOptions.limits` により上限を設けています。既定値は [`DEFAULT_EPUB_PARSE_LIMITS`](docs/ja/06-epub.md) を参照してください。

## ライセンス

[Apache-2.0](LICENSE)
