# mejiro

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/mejiro/ci.yml?branch=main&label=CI)](https://github.com/libraz/mejiro/actions)
[![npm](https://img.shields.io/npm/v/@libraz/mejiro)](https://www.npmjs.com/package/@libraz/mejiro)
[![codecov](https://codecov.io/gh/libraz/mejiro/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/mejiro)
[![License](https://img.shields.io/github/license/libraz/mejiro)](https://github.com/libraz/mejiro/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)

Web向け日本語縦書き組版エンジン。改行処理、禁則処理、ぶら下げ組み、ルビ（振り仮名）前処理、画像除外（テキスト回り込み）、ページネーションを提供します。コアエンジンはDOM非依存です。

<p align="center">
  <img src="docs/images/wagahai.jpg" alt="mejiro デモ — 夏目漱石「吾輩は猫である」縦書き表示" width="640">
</p>

## インストール

```bash
npm install @libraz/mejiro   # or yarn / pnpm / bun
```

## 概要

mejiroは、ブラウザでの日本語縦書きテキスト（`writing-mode: vertical-rl`）レンダリングに必要な構成要素を提供します。コアエンジンはTypedArrayと純粋な数値計算で動作するため、高速・決定的・ポータブルです。ブラウザ固有の処理（フォント計測、Canvas API）は別サブパスに分離し、EPUB解析は第3のサブパスとして利用できます。

```
@libraz/mejiro          コア: 改行・禁則・ぶら下げ・ルビ・画像除外・ページネーション
@libraz/mejiro/browser  ブラウザ: フォント計測・幅キャッシュ・レイアウト統合
@libraz/mejiro/epub     EPUB: 解析・ルビ抽出
@libraz/mejiro/render   レンダー: レイアウトデータ → フレームワーク非依存のページ構造 + CSS
@libraz/mejiro/book     ブック: 高レベルAPI — レイアウト・ページネーション・画像除外を1クラスに統合
```

## アーキテクチャ

```
アプリケーション（React / Vue / vanilla DOM）
       ↓
  @libraz/mejiro/book     高レベル: MejiroBook → レイアウト・ページネーション・画像除外
       ↓
  @libraz/mejiro/render   レイアウトデータ → RenderPage構造 + CSS
       ↓
  @libraz/mejiro/epub     EPUB → テキスト + ルビ注釈
       ↓
  @libraz/mejiro/browser  フォント計測 + ルビフォント導出
       ↓
  @libraz/mejiro          改行 + 禁則 + ぶら下げ + ルビ + ページネーション
```

- **コア**は外部依存ゼロ
- **ブラウザ**はCanvas APIとFontFace APIを使用
- **EPUB**は`jszip`に依存
- **レンダー**はレイアウト結果をフレームワーク非依存の`RenderPage`データ構造に変換
- **ブック**は全レイヤーを `MejiroBook` → `ChapterLayout` → `SpreadResult` のシンプルなワークフローに統合

## クイックスタート

```ts
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { getLineRanges, paginate } from '@libraz/mejiro';

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

const text = '吾輩は猫である。名前はまだ無い。';

// 1. テキストをレイアウト（fontFamily/fontSizeはインスタンスのデフォルトを使用）
const result = await mejiro.layout({
  text,
  lineWidth: mejiro.verticalLineWidth(600), // コンテナ高さから実効行幅を算出
});

// 2. 行範囲を取得 → [[start, end), ...]
const lines = getLineRanges(result.breakPoints, text.length);

// 3. 幅400pxのページに分割
const pages = paginate(400, [
  { lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 },
]);
```

### EPUB + MejiroBook（推奨）

```ts
import { MejiroBook } from '@libraz/mejiro/book';
import { verticalLineWidth } from '@libraz/mejiro/browser';
import { parseEpub } from '@libraz/mejiro/epub';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: { 1: { scale: 1.6, gapAfterEm: 1.4 } },
});

book.setPageSize({
  pageWidth: 400,
  lineWidth: verticalLineWidth(600, 16),
});

const epub = await parseEpub(epubArrayBuffer);
const layout = await book.layoutChapter(epub.chapters[0]);

// 見開きページを取得
const spread = layout.getSpread(0);
// spread.right.page → RenderPage（段落 → 行 → セグメント）
// spread.right.lines / spread.right.slots → 絶対配置用
// spread.totalPages → 総ページ数

// 画像配置とテキスト回り込み
layout.setImages(0, [{ x: 80, y: 100, w: 120, h: 160 }]);
const updated = layout.getSpread(0); // リフロー反映済み
```

## API

完全なAPIリファレンスは [APIリファレンス](docs/ja/10-api-reference.md) を参照してください。
詳細なガイドと使用例は [ドキュメント](docs/ja/) を参照してください。

| サブパス | 説明 |
|---|---|
| `@libraz/mejiro` | コア: `computeBreaks()`、`ExclusionEngine`、`toCodepoints()`、禁則、ぶら下げ、ルビ、ページネーション |
| `@libraz/mejiro/browser` | ブラウザ: `MejiroBrowser`クラス、フォント計測、幅キャッシュ |
| `@libraz/mejiro/epub` | EPUB: `parseEpub()`、ルビ抽出 |
| `@libraz/mejiro/render` | レンダー: `buildRenderPage()`、`buildParagraphMeasures()`、`mejiro.css` |
| `@libraz/mejiro/book` | ブック: `MejiroBook`、`ChapterLayout` — 高レベルのレイアウト・ページネーション・画像除外 |
| `@libraz/mejiro-react` | React: `<MejiroPage>`コンポーネント（実験的） |
| `@libraz/mejiro-vue` | Vue: `<MejiroPage>`コンポーネント（実験的） |

## 禁則処理

禁則処理は、特定の文字が行頭・行末に配置されることを禁止する日本語組版ルールです。[JIS X 4051](https://www.jisc.go.jp/app/jis/general/GnrJISNumberNameSearchList?show&jisStdNo=X4051)（日本語文書の組版方法）および[JLREQ](https://www.w3.org/TR/jlreq/)（日本語組版処理の要件）で定義されています。

mejiroは2つのモードでこれを実装しています。

- **Strict**（デフォルト）— 閉じ括弧、句読点、小書き仮名、長音記号、踊り字の行頭配置を禁止。開き括弧の行末配置を禁止。
- **Loose** — Strictと同じですが、小書き仮名と長音記号（`ー`）の行頭配置を許可。狭い段組みに有用。

**ぶら下げ組み**（`。` `、` `，` `．`）は、次の行に送る代わりに行末外側にはみ出すことができます。

カスタム禁則ルールはコアの `computeBreaks()` APIを直接使用する場合に `LayoutInput.kinsokuRules` で指定可能です。禁則文字一覧、JIS X 4051 / JLREQ対応状況表、カスタムルールの例は[改行処理](docs/ja/03-line-breaking.md)を参照してください。

## 設計方針

- **TypedArrayベースのコア** — コードポイントに`Uint32Array`、アドバンスに`Float32Array`を使用。ホットパスでの文字列操作を排除。
- **O(n)改行アルゴリズム** — 禁則バックトラック付きの単一パス貪欲法。動的計画法のオーバーヘッドなし。
- **前処理としてのルビ** — ルビ注釈をメインループ前に実効アドバンスとクラスタIDに解決。改行アルゴリズム本体は変更不要。
- **画像除外** — `ExclusionEngine` と `SpreadExclusionEngine` が任意配置の画像に対する列ごとのテキスト配置を計算。単一ページまたは見開き2ページにわたるノド自動処理とリアルタイムのドラッグ＆ドロップをサポート。
- **決定的** — 同一入力に対して常に同一出力。
- **関心の分離** — コアは純粋な計算（DOM・Canvas不要）。ブラウザ層が計測を担当。EPUB層が解析を担当。レンダー層がフレームワーク非依存のデータを生成。最終的なDOM出力は利用者の責務。

## ライセンス

[Apache License 2.0](LICENSE)

## 作者

- libraz <libraz@libraz.net>

