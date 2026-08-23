# ページ分割とレンダリング

> **ヒント:** ほとんどのアプリケーションでは、`@libraz/mejiro/book` の [`MejiroBook`](10-api-reference.md) から使うのがおすすめです。レイアウト、ページ分割、画像回り込みを 1 つの高レベル API で扱えます。このページの手動パイプラインは、より細かく制御したい場合に使います。

行分割が終わったあとの流れは次のとおりです。

1. 段落メジャーの構築（行送り、間隔）
2. ページ分割 -- 行を固定サイズのページへ割り当てる
3. レンダーページの構築 -- ページスライスを表示用データに変換する
4. DOM への描画（vanilla JS、React、Vue）

このページではステップ 1〜3 と vanilla DOM での表示を説明します。React / Vue コンポーネントは [React と Vue](./08-react-and-vue.md) を参照してください。

## 1. RenderEntry

`RenderEntry` は、レイアウト結果をレンダリング処理へ渡すための中間データです。`layoutChapter()` の出力から段落ごとに 1 つ作ります。

```ts
import type { RenderEntry } from '@libraz/mejiro/render';

const entries: RenderEntry[] = chapter.paragraphs.map((p, i) => ({
  chars: result.paragraphs[i].chars,
  breakPoints: result.paragraphs[i].breakResult.breakPoints,
  inlineAnnotations: p.inlineAnnotations,
  kind: p.kind,
  headingLevel: p.headingLevel,
}));
```

| フィールド | 型 | 説明 |
|-------|------|-------------|
| `chars` | `string[]` | 段落テキストの文字配列（書記素クラスター）。 |
| `breakPoints` | `Uint32Array` | 行分割アルゴリズムによる分割位置。 |
| `inlineAnnotations` | `InlineAnnotation[]` | この段落のルビ・圏点・縦中横・リンク等の注釈。 |
| `kind` | `ParagraphKind \| undefined` | 段落の構造種別（`'body'` / `'heading'` / `'blockquote'` / `'sceneBreak'` / `'pre'` / `'figure'`）。ページ分割を越えて `RenderParagraph.kind` に残り、`mejiro-paragraph--*` クラスの選択に使われる。既定は `'body'`。 |
| `headingLevel` | `number \| undefined` | 見出しレベル（1〜6）。レベル別の `headingStyles` はこの値で引くため、渡さないと見出しが全て同じ大きさになり、クラスも汎用の `--heading` 修飾子に落ちる。 |
| `isHeading` | `boolean \| undefined` | 非推奨。代わりに `kind: 'heading'`（レベルが分かるなら `headingLevel` も）を設定する。`headingLevel` があるときは無視される。 |

## 2. buildParagraphMeasures()

`RenderEntry` を、`paginate()` に渡す `ParagraphMeasure[]` へ変換します。見出しと本文の違いを考慮して、行送り（フォントサイズ x 行間倍率）と段落間の間隔を計算します。

```ts
import { buildParagraphMeasures } from '@libraz/mejiro/render';

const measures = buildParagraphMeasures(entries, {
  fontSize: 16,
  lineSpacing: 1.8,
  headingScale: 1.4,
  paragraphGapEm: 0.4,
  headingGapEm: 1.2,
});
```

### MeasureOptions

| オプション | 型 | デフォルト | 説明 |
|--------|------|---------|-------------|
| `fontSize` | `number` | （必須） | 基準フォントサイズ（px）。 |
| `lineSpacing` | `number` | `1` | 行間の倍率。 |
| `lineHeight` | `number` | -- | `lineSpacing` の非推奨エイリアス。`lineSpacing` が無いときだけ使われる。 |
| `headingScale` | `number` | `1.4` | 見出しフォントサイズのスケール係数（例: `16 * 1.4 = 22.4`）。レベル別に `headingStyles` で上書きできる。 |
| `paragraphGapEm` | `number` | `0.4` | 本文段落前の間隔（em単位）。 |
| `headingGapEm` | `number` | `1.2` | 見出し段落後の間隔（em単位）。レベル別に `headingStyles` で上書きできる。 |
| `headingStyles` | `Record<number, HeadingStyle>` | -- | 見出しレベル（1〜6）をキーに `scale` と `gapAfterEm` を上書きする。 |

### ParagraphMeasure

返される各 `ParagraphMeasure` には次の情報が入ります。

| フィールド | 型 | 説明 |
|-------|------|-------------|
| `lineCount` | `number` | 行数（`breakPoints.length + 1`）。 |
| `linePitch` | `number` | ブロック方向における各行のサイズ（px）。本文は`fontSize * lineSpacing`、見出しは`headingFontSize * lineSpacing`。 |
| `gapBefore` | `number` | この段落の前の間隔（px）。*前の*段落から導出されます。前の段落が見出しの場合は`headingGap`、それ以外は`paragraphGap`。ページ先頭の段落では無視されます。 |

## 3. paginate()

固定サイズのページへ段落の行を割り当てます。ページ境界では、必要に応じて段落を途中で分割します。

```ts
import { paginate } from '@libraz/mejiro';

const pages = paginate(400, measures);
// pages[0] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 5 }, ...]
// pages[1] = [...]
```

### パラメータ

| パラメータ | 型 | 説明 |
|-----------|------|-------------|
| `pageBlockSize` | `number` | 各ページのブロック方向の利用可能サイズ（px）。vertical-rlの場合、これはページの**幅**（列は右から左に流れます）。 |
| `paragraphs` | `ParagraphMeasure[]` | 各段落のメジャー。 |

### 戻り値: `PageSlice[][]`

ページの配列で、各ページは段落スライスの配列を含みます。

```ts
interface PageSlice {
  paragraphIndex: number;  // entries配列内のインデックス
  lineStart: number;       // 開始行（0始まり）
  lineEnd: number;         // 終了行（排他的）
}
```

ページ境界をまたぐ段落は、2つの`PageSlice`エントリを生成します。各ページに1つずつ、異なる`lineStart`/`lineEnd`の範囲を持ちます。

## 4. buildRenderPage()

ページスライスと `RenderEntry` を、フレームワークに依存しない `RenderPage` データ構造へ変換します。React、Vue、vanilla DOM などからそのまま表示に使えます。

```ts
import { buildRenderPage } from '@libraz/mejiro/render';

const renderPage = buildRenderPage(pages[0], entries);
```

### RenderPage構造

```ts
interface RenderPage {
  paragraphs: RenderParagraph[];
}

interface RenderParagraph {
  lines: RenderLine[];
  isHeading: boolean;
  headingLevel?: number;
  kind?: ParagraphKind;
}

interface RenderLine {
  segments: RenderSegment[];
}

type RenderSegment =
  | { type: 'text'; text: string }
  | { type: 'ruby'; base: string; rubyText: string; children?: readonly RenderSegment[] }
  | {
      type: 'emphasis';
      text: string;
      style: 'sesame' | 'dot' | 'circle';
      children?: readonly RenderSegment[];
    }
  | { type: 'tcy'; text: string; children?: readonly RenderSegment[] }
  | { type: 'em'; text: string; children?: readonly RenderSegment[] }
  | { type: 'strong'; text: string; children?: readonly RenderSegment[] }
  | { type: 'link'; text: string; href: string; title?: string; children?: readonly RenderSegment[] }
  | { type: 'footnote-ref'; text: string; noteId: string; children?: readonly RenderSegment[] };
```

各行はセグメントに分割されます。`text` はプレーンテキスト、`ruby` はベース文字列とルビ（ふりがな）読みを表し、その他のセグメントは傍点、縦中横、意味的な強調、リンク、脚注参照を表します。

`children` は入れ子の注釈（傍点の中のルビ、リンクの中の縦中横など）を保持します。`children` がある場合は、親の `text` / `base` ではなく children を描画してください。親側にもその範囲全体のフラットなテキストが入っているので、プレーンテキストだけが必要な描画では `children` を無視して構いません。

## 5. mejiro.css

レイアウトに必要なCSSです。アプリケーションでインポートしてください。

```ts
import '@libraz/mejiro/render/mejiro.css';
```

### CSSクラス

| クラス | 用途 |
|-------|---------|
| `.mejiro-page` | ルートコンテナ。`writing-mode: vertical-rl; width: 100%`を設定。 |
| `.mejiro-paragraph` | 段落カラム。`writing-mode: vertical-rl; display: inline-block; white-space: nowrap; margin-right: 0.4em`。 |
| `.mejiro-paragraph:first-child` | 最初の段落のブロック開始側マージンを除去（`margin-right: 0`）。 |
| `.mejiro-paragraph--heading` | 見出しスタイル。`font-weight: 700; font-size: 1.4em; height: 100%`。 |
| `.mejiro-paragraph--heading + .mejiro-paragraph` | 見出し後の間隔（`margin-right: 1.2em`）。 |
| `.mejiro-page ruby` | `ruby-align: center`。 |
| `.mejiro-page rt` | `font-size: 0.5em; font-weight: 400`。 |

段落間の間隔を `margin-right` で宣言しているのは、`vertical-rl` ではブロック開始側が右側になるためです。カラムは右から左へ流れるので、段落の「前」の間隔はその右側に入ります。`margin-left` を上書きしても既存の間隔は変わらず、反対側に別の余白が足されるだけになります。

## 6. Vanilla DOM で表示する

フレームワークを使わずに、`RenderPage` を DOM へ描画する例です。`mejiro-paragraph--*` 修飾子の出所は `paragraphClassName()` に一本化されているので、これを使えばクライアント描画と `renderEpubStatic()` のクラス列が一致します。

```ts
import { paragraphClassName } from '@libraz/mejiro/render';

function renderPageToDOM(container: HTMLElement, page: RenderPage): void {
  container.innerHTML = '';
  container.classList.add('mejiro-page');

  for (const paragraph of page.paragraphs) {
    const div = document.createElement('div');
    div.className = paragraphClassName(paragraph.kind, paragraph.headingLevel);

    for (let li = 0; li < paragraph.lines.length; li++) {
      if (li > 0) div.appendChild(document.createElement('br'));
      for (const segment of paragraph.lines[li].segments) {
        appendInlineNode(div, segmentToInlineNode(segment));
      }
    }

    container.appendChild(div);
  }
}
```

`segmentToInlineNode()`（`@libraz/mejiro/render` から export）は、`RenderSegment` の全バリアントを、入れ子の `children` や安全でないリンク URL（プレーンテキストに落とします）まで含めて解決し、フレームワーク非依存の小さな要素記述に変換します。

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

セグメント種別ごとの出力は次のとおりです。

| セグメント種別 | 出力 |
|--------------|------|
| `text` | テキストノード |
| `ruby` | `<ruby>base<rt>rubyText</rt></ruby>` |
| `emphasis` | `<span class="mejiro-emphasis mejiro-emphasis--sesame">`（`--dot` / `--circle` も同様） |
| `tcy` | `<span class="mejiro-tcy">` |
| `em` | `<em>` |
| `strong` | `<strong>` |
| `link` | `<a href>`（`title` は任意）。サニタイザに弾かれた URL はテキストノードになります |
| `footnote-ref` | `<a class="mejiro-footnote-ref" href="#noteId">` |

`segment.type` で自前に分岐しても構いませんが、その分岐は全バリアントを網羅する必要があります。`text` と `ruby` の 2 分岐だけにすると、傍点・縦中横・リンク・脚注参照が `<ruby>undefined<rt>undefined</rt></ruby>` として出力されます。

## 7. 完全な例

テキストから表示用ページを作るまでの一連の流れです。

```ts
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderEntry } from '@libraz/mejiro/render';
import '@libraz/mejiro/render/mejiro.css';

// 1. MejiroBrowserインスタンスを作成
const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

// 2. チャプターをレイアウト
const result = await mejiro.layoutChapter({
  paragraphs: [
    { text: '第一章' },
    { text: '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。' },
  ],
  lineWidth: mejiro.verticalLineWidth(600),
});

// 3. RenderEntry を作る
const entries: RenderEntry[] = [
  {
    chars: result.paragraphs[0].chars,
    breakPoints: result.paragraphs[0].breakResult.breakPoints,
    inlineAnnotations: [],
    kind: 'heading',
    headingLevel: 1,
  },
  {
    chars: result.paragraphs[1].chars,
    breakPoints: result.paragraphs[1].breakResult.breakPoints,
    inlineAnnotations: [],
    kind: 'body',
  },
];

// 4. 段落メジャーを作り、ページ分割する
const measures = buildParagraphMeasures(entries, {
  fontSize: 16,
  lineSpacing: 1.8,
});
const pages = paginate(400, measures);

// 5. 各ページをレンダリング
const container = document.getElementById('reader')!;
for (let i = 0; i < pages.length; i++) {
  const pageDiv = document.createElement('div');
  const renderPage = buildRenderPage(pages[i], entries);
  renderPageToDOM(pageDiv, renderPage);
  container.appendChild(pageDiv);
}
```

---

## 関連ドキュメント

- [ブラウザ統合](./05-browser-integration.md) -- MejiroBrowser、フォント計測、layoutChapter
- [EPUB](./06-epub.md) -- EPUB解析とルビ抽出
- [React & Vue](./08-react-and-vue.md) -- レンダリング用フレームワークコンポーネント
- [コアコンセプト](./02-core-concepts.md) -- アーキテクチャ、データフロー、TypedArrays
