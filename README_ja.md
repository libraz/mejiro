# mejiro

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/mejiro/ci.yml?branch=main&label=CI)](https://github.com/libraz/mejiro/actions)
[![npm](https://img.shields.io/npm/v/@libraz/mejiro)](https://www.npmjs.com/package/@libraz/mejiro)
[![codecov](https://codecov.io/gh/libraz/mejiro/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/mejiro)
[![License](https://img.shields.io/github/license/libraz/mejiro)](https://github.com/libraz/mejiro/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)

Web向け日本語縦書き組版エンジン。改行処理、禁則処理、ぶら下げ組み、ルビ（振り仮名）前処理、ページネーションを提供します。コアエンジンはDOM非依存です。

<p align="center">
  <img src="docs/images/wagahai.jpg" alt="mejiro デモ — 夏目漱石「吾輩は猫である」縦書き表示" width="640">
</p>

## インストール

```bash
npm install @libraz/mejiro
# or
yarn add @libraz/mejiro
# or
pnpm add @libraz/mejiro
# or
bun add @libraz/mejiro
```

## 概要

mejiroは、ブラウザでの日本語縦書きテキスト（`writing-mode: vertical-rl`）レンダリングに必要な構成要素を提供します。コアエンジンはTypedArrayと純粋な数値計算で動作するため、高速・決定的・ポータブルです。ブラウザ固有の処理（フォント計測、Canvas API）は別サブパスに分離し、EPUB解析は第3のサブパスとして利用できます。

```
@libraz/mejiro          コア: 改行・禁則・ぶら下げ・ルビ・ページネーション
@libraz/mejiro/browser  ブラウザ: フォント計測・幅キャッシュ・レイアウト統合
@libraz/mejiro/epub     EPUB: 解析・ルビ抽出
@libraz/mejiro/render   レンダー: レイアウトデータ → フレームワーク非依存のページ構造 + CSS
```

## アーキテクチャ

```
アプリケーション（React / Vue / vanilla DOM）
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

## クイックスタート

```ts
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { getLineRanges, paginate } from '@libraz/mejiro';

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

// 1. テキストをレイアウト（fontFamily/fontSizeはインスタンスのデフォルトを使用）
const result = await mejiro.layout({
  text: '吾輩は猫である。名前はまだ無い。',
  lineWidth: mejiro.verticalLineWidth(600), // コンテナ高さからfontSizeを自動適用
});

// 2. 行範囲を取得
const lines = getLineRanges(result.breakPoints, 16); // [[0, 8], [8, 16]]

// 3. ページネーション
const pages = paginate(400, [
  { lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 },
]);
```

### EPUB + 章レイアウト + レンダー

```ts
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderEntry } from '@libraz/mejiro/render';
import '@libraz/mejiro/render/mejiro.css';

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});
const book = await parseEpub(epubArrayBuffer);
const chapter = book.chapters[0];

// 1. 全段落を一括レイアウト（fontFamily/fontSizeはインスタンスのデフォルトを使用）
const result = await mejiro.layoutChapter({
  paragraphs: chapter.paragraphs.map((p) => ({
    text: p.text,
    rubyAnnotations: p.rubyAnnotations,
  })),
  lineWidth: mejiro.verticalLineWidth(600),
});

// 2. レンダーエントリを構築
const entries: RenderEntry[] = chapter.paragraphs.map((p, i) => ({
  chars: result.paragraphs[i].chars,
  breakPoints: result.paragraphs[i].breakResult.breakPoints,
  rubyAnnotations: p.rubyAnnotations,
  isHeading: !!p.headingLevel,
}));

// 3. ページネーション
const measures = buildParagraphMeasures(entries, { fontSize: 16, lineHeight: 1.8 });
const pages = paginate(400, measures);

// 4. ページをレンダー（フレームワーク非依存データ）
const renderPage = buildRenderPage(pages[0], entries);
// renderPage.paragraphs → lines → segments (テキスト or ルビ)
```

## APIリファレンス

### `@libraz/mejiro` — コア

#### 改行処理

| エクスポート | 説明 |
|---|---|
| `computeBreaks(input: LayoutInput): BreakResult` | 改行位置を計算。禁則バックトラック付きの貪欲O(n)アルゴリズム。ぶら下げ組みに対応。 |
| `canBreakAt(text, pos, clusterIds?, mode?): boolean` | 指定位置での改行が許可されるかを判定。 |

#### 禁則処理

| エクスポート | 説明 |
|---|---|
| `isLineStartProhibited(cp, mode?): boolean` | コードポイントが行頭禁則文字かを判定。 |
| `isLineEndProhibited(cp): boolean` | コードポイントが行末禁則文字かを判定。 |
| `getDefaultKinsokuRules(): KinsokuRules` | デフォルトの禁則ルールセットを返す。 |
| `setKinsokuRules(rules): void` | アクティブな禁則ルールをグローバルに置換。 |

#### ぶら下げ組み

| エクスポート | 説明 |
|---|---|
| `isHangingTarget(cp): boolean` | コードポイントがぶら下げ対象か（例: `。` `、`）を判定。 |
| `computeHangingAdjustment(cp, advance): number` | 句読点のぶら下げ量を計算。 |

#### ルビ（振り仮名）前処理

| エクスポート | 説明 |
|---|---|
| `preprocessRuby(text, advances, annotations, clusterIds?): { effectiveAdvances, clusterIds }` | ルビ文字幅を親文字に分配し、クラスタIDを生成。 |
| `isKana(cp): boolean` | コードポイントがひらがな・カタカナかを判定。 |

#### クラスタサポート

| エクスポート | 説明 |
|---|---|
| `resolveClusterBoundaries(clusterIds): Uint32Array` | クラスタIDを連続した境界に正規化。 |
| `isClusterBreakAllowed(clusterIds, pos, len): boolean` | クラスタ境界を考慮して改行が許可されるかを判定。 |

#### ページネーション

| エクスポート | 説明 |
|---|---|
| `paginate(pageBlockSize, paragraphs): PageSlice[][]` | 段落の行を固定サイズのページに分配。ページ境界での分割に対応。 |
| `getLineRanges(breakPoints, charCount): [number, number][]` | 改行位置を行ごとの`[開始, 終了)`文字インデックスペアに変換。 |

#### 型定義

| 型 | 説明 |
|---|---|
| `LayoutInput` | 入力パラメータ: text (`Uint32Array`), advances (`Float32Array`), lineWidth, mode 等。 |
| `BreakResult` | 出力: breakPoints (`Uint32Array`), hangingAdjustments, effectiveAdvances。 |
| `KinsokuMode` | `'strict'` または `'loose'`。looseは小書き仮名の行頭配置を許可。 |
| `KinsokuRules` | カスタム行頭・行末禁則コードポイントセット。 |
| `RubyAnnotation` | 計測済みアドバンス付きルビ注釈（コアレベル、コードポイントベース）。 |
| `ParagraphMeasure` | ページネーション用の段落計測値: lineCount, linePitch, gapBefore。 |
| `PageSlice` | ページに割り当てられた段落スライス: paragraphIndex, lineStart, lineEnd。 |

---

### `@libraz/mejiro/browser` — ブラウザ統合

#### 高レベルAPI

| エクスポート | 説明 |
|---|---|
| `MejiroBrowser` | メインクラス。フォント読み込み・幅キャッシュ・レイアウト計算を管理。 |
| `MejiroBrowser.layout(options): Promise<BreakResult>` | 単一段落のレイアウト: フォント読み込み→文字計測→改行計算。 |
| `MejiroBrowser.layoutChapter(options): Promise<ChapterLayoutResult>` | 複数段落の一括レイアウト。段落ごとのフォント指定（見出し等）に対応。 |
| `MejiroBrowser.preloadFont(fontFamily?, fontSize?): Promise<void>` | フォントを事前読み込み。省略時はインスタンスのデフォルトを使用。 |
| `MejiroBrowser.verticalLineWidth(containerHeight, fontSize?): number` | 縦書きテキスト用の有効行幅を計算。fontSizeはインスタンスのデフォルトにフォールバック。 |
| `MejiroBrowser.clearCache(fontKey?): void` | 幅計測キャッシュをクリア。 |
| `layoutText(options): Promise<BreakResult>` | スタンドアロンの単発レイアウト関数（内部で計測器を生成）。 |
| `verticalLineWidth(containerHeight, fontSize): number` | 縦書きテキスト用の有効行幅を計算。CSS縦書きとCanvas計測の差異を補正。 |

#### フォント・計測

| エクスポート | 説明 |
|---|---|
| `FontLoader` | FontFace APIによるフォント読み込み保証。 |
| `CharMeasurer` | Canvas.measureTextによる文字幅計測。コードポイント単位のキャッシュ付き。 |
| `WidthCache` | `Map<fontKey, Map<codepoint, width>>` 形式の文字幅キャッシュ。 |
| `deriveRubyFont(fontFamily, fontSize): string` | フォントファミリーとサイズからルビ用フォント指定（半分サイズ）を導出。 |
| `toFontSpec(fontFamily, fontSize): string` | フォントファミリーとサイズからCSSフォント指定を合成。 |

#### 型定義

| 型 | 説明 |
|---|---|
| `MejiroBrowserOptions` | コンストラクタオプション: fixedFontFamily, fixedFontSize, strictFontCheck。 |
| `LayoutOptions` | 段落レイアウトオプション: text, fontFamily, fontSize, lineWidth, mode, enableHanging, rubyAnnotations。 |
| `ChapterLayoutOptions` | 一括レイアウトオプション: paragraphs, fontFamily?, fontSize?, lineWidth, mode, enableHanging。fontFamily/fontSizeはインスタンスのデフォルトにフォールバック。 |
| `ChapterLayoutResult` | 段落ごとの`ParagraphLayoutResult`を含む結果。 |
| `ParagraphLayoutResult` | 段落ごとの結果: breakResult, chars。 |
| `ParagraphInput` | レイアウト対象の段落: text, rubyAnnotations, fontFamily/fontSize指定（任意）。 |
| `RubyInputAnnotation` | 文字列ベースのルビ注釈（ブラウザレベル、コードポイント変換前）。 |

---

### `@libraz/mejiro/epub` — EPUB解析

| エクスポート | 説明 |
|---|---|
| `parseEpub(buffer: ArrayBuffer): Promise<EpubBook>` | EPUBファイルをルビ注釈付きの構造化チャプターに解析。 |
| `extractRubyContent(xhtml: string): AnnotatedParagraph[]` | XHTML文字列から段落とルビ注釈を抽出。 |

#### 型定義

| 型 | 説明 |
|---|---|
| `EpubBook` | 解析済み書籍: title, author, chapters。 |
| `EpubChapter` | チャプター: title, paragraphs。 |
| `AnnotatedParagraph` | 段落: text, rubyAnnotations, headingLevel。 |

### `@libraz/mejiro/render` — レンダーデータ

レイアウト結果をフレームワーク非依存の`RenderPage`データ構造に変換します。レイアウトに必要なCSSクラス（`mejiro-page`、`mejiro-paragraph`等）を提供する`mejiro.css`も含みます。

| エクスポート | 説明 |
|---|---|
| `buildParagraphMeasures(entries, options): ParagraphMeasure[]` | レンダーエントリから段落計測値（行ピッチ、段落間隔）を計算。`paginate()`と組み合わせて使用。 |
| `buildRenderPage(slices, entries): RenderPage` | ページスライス + エントリを、段落・行・セグメントを含む`RenderPage`構造に変換。 |

#### 型定義

| 型 | 説明 |
|---|---|
| `RenderEntry` | 入力: chars, breakPoints, rubyAnnotations, isHeading。 |
| `RenderPage` | 段落を含むページ。各段落は行のリスト、各行はセグメントのリスト。 |
| `RenderParagraph` | 行と見出しフラグを持つ段落。 |
| `RenderLine` | セグメントの配列を持つ行。 |
| `RenderSegment` | `{ type: 'text', text }` または `{ type: 'ruby', base, rubyText }`。 |
| `MeasureOptions` | `buildParagraphMeasures`のオプション: fontSize, lineHeight, headingScale, paragraphGapEm, headingGapEm。 |

#### CSS

```ts
import '@libraz/mejiro/render/mejiro.css';
```

必須レイアウトクラスを提供: `.mejiro-page`（vertical-rlコンテナ）、`.mejiro-paragraph`（インラインブロックカラム）、`.mejiro-paragraph--heading`、ルビスタイル。

---

### `@libraz/mejiro-react` / `@libraz/mejiro-vue` — フレームワークコンポーネント（実験的）

> **注意:** これらのパッケージは実験的であり、APIは変更される可能性があります。

```bash
npm install @libraz/mejiro-react    # peerDep: react >=18
npm install @libraz/mejiro-vue      # peerDep: vue >=3.3
```

`RenderPage`を`mejiro-` CSSクラスを使ってDOMにレンダリングするコンポーネントです。

#### React

```tsx
import { MejiroPage } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro.css';

<MejiroPage page={renderPage} className="my-page" />
```

#### Vue

```vue
<script setup lang="ts">
import { MejiroPage } from '@libraz/mejiro-vue';
import '@libraz/mejiro/render/mejiro.css';

defineProps<{ page: RenderPage }>();
</script>

<template>
  <MejiroPage :page="page" />
</template>
```

---

## 禁則処理

禁則処理は、特定の文字が行頭・行末に配置されることを禁止する日本語組版ルールです。[JIS X 4051](https://www.jisc.go.jp/app/jis/general/GnrJISNumberNameSearchList?show&jisStdNo=X4051)（日本語文書の組版方法）で定義され、W3Cの[JLREQ](https://www.w3.org/TR/jlreq/)（日本語組版処理の要件）でさらに詳述されています。

mejiroは2つのモードでこれを実装しています。

### Strictモード（デフォルト）

**行頭禁則** — 以下の文字は行頭に配置できません。自然な改行位置がこれらの文字を行頭に置く場合、改行位置を前方に移動します。

| 分類 | 文字 |
|---|---|
| 閉じ括弧 | `）` `〕` `］` `｝` `〉` `》` `」` `』` `】` |
| 句読点・記号 | `、` `。` `，` `．` `・` `：` `；` `？` `！` |
| 小書き仮名 | `ぁ` `ぃ` `ぅ` `ぇ` `ぉ` `っ` `ゃ` `ゅ` `ょ` `ゎ` `ァ` `ィ` `ゥ` `ェ` `ォ` `ッ` `ャ` `ュ` `ョ` `ヮ` |
| 長音記号 | `ー` |
| 踊り字 | `々` `〻` `ヽ` `ヾ` `ゝ` `ゞ` |

**行末禁則** — 以下の文字は行末に配置できません（後続の文字と分離してはいけません）。

| 分類 | 文字 |
|---|---|
| 開き括弧 | `（` `〔` `［` `｛` `〈` `《` `「` `『` `【` |

### Looseモード

Strictと同じですが、**小書き仮名と長音記号**（`ー`）の行頭配置を許可します。狭い段組みなど、改行位置の自由度が必要な場合に有用です。

### ぶら下げ組み

句読点（`。` `、` `，` `．`）が行末からはみ出す場合、次の行に送る代わりに行末外側に「ぶら下げ」ることができます。句読点1文字のために不自然な改行が発生するのを防ぎます。

```mermaid
block-beta
  columns 2
  block:noHang:1
    columns 1
    a1["あいうえお"]
    a2["、かきくけ"]
  end
  block:hang:1
    columns 1
    b1["あいうえお、← はみ出し"]
    b2["かきくけこ"]
  end
```

### JIS X 4051 / JLREQ 対応状況

| 機能 | JIS X 4051 | JLREQ | mejiro |
|---|---|---|---|
| 行頭禁則 | §9.1 | §3.1.7 | 対応 |
| 行末禁則 | §9.2 | §3.1.8 | 対応 |
| ぶら下げ組み | §9.3 | §3.1.9 | 対応（`。` `、` `，` `．`） |
| 分離禁止 | §9.4 | §3.1.10 | 対応（クラスタIDによる実装） |
| ルビ配置 | §12 | §3.3 | 部分対応（モノ・グループルビ、幅分配） |
| Strict/Looseモード切替 | — | §3.1.7 注 | 対応 |
| 段落先頭の全角空白 | §8 | §3.1.5 | 未対応（描画層の責務） |
| アキ調整 | §8, §10 | §3.1.3, §3.1.6 | 未実装 |
| 字取り・詰め組み | §10 | §3.8 | 未実装 |

> **注:** mejiroは改行処理とページネーションに注力しています。アキ調整や視覚的整形（字下げ、均等割り付け等）は描画層の責務です。

### カスタムルール

組み込みルールを独自のものに置換できます:

```ts
import { setKinsokuRules, getDefaultKinsokuRules } from '@libraz/mejiro';

// デフォルトを取得して変更
const rules = getDefaultKinsokuRules();
rules.lineStartProhibited.push(0x2026); // … を追加
setKinsokuRules(rules);

// デフォルトに戻す
setKinsokuRules(null);
```

## 設計方針

- **TypedArrayベースのコア** — コードポイントに`Uint32Array`、アドバンスに`Float32Array`を使用。ホットパスでの文字列操作を排除。
- **O(n)改行アルゴリズム** — 禁則バックトラック付きの単一パス貪欲法。動的計画法のオーバーヘッドなし。
- **前処理としてのルビ** — ルビ注釈をメインループ前に実効アドバンスとクラスタIDに解決。改行アルゴリズム本体は変更不要。
- **決定的** — 同一入力に対して常に同一出力。
- **関心の分離** — コアは純粋な計算（DOM・Canvas不要）。ブラウザ層が計測を担当。EPUB層が解析を担当。描画は利用者の責務。

## ライセンス

[Apache License 2.0](LICENSE)

## 作者

- libraz <libraz@libraz.net>

