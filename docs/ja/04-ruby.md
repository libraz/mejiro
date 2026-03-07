# ルビ注釈

## ルビとは

ルビ注釈（振り仮名）は、本文の文字に沿って小さく表示される文字で、読みを示すために使われます。日本語テキストでは、漢字の読みを示す目的で広く用いられています。

例えば「漢字」という語において、文字の上や横に小さく表示されるひらがな「かんじ」がルビ注釈です。縦書きレイアウトでは、ルビは親文字の右側に表示されます。

ルビは多くの場面で可読性に不可欠です。児童書、教育教材、法律文書、珍しい漢字や古い読みが使われる文学作品などがその例です。

## ルビの種類

JLReq（日本語組版処理の要件、W3C）仕様では、3種類のルビが定義されています。

### モノルビ

1つの親文字に1つ以上のルビ文字が対応します。各親文字が独立した注釈を持ちます。

例: 「字」にルビ「じ」。

モノルビでは、各注釈が独立しているため、注釈付き文字間での改行が可能です。

### グループルビ

複数の親文字が1つのルビ注釈を共有し、分割できません。注釈はすべての親文字と一緒に保持される必要があります。

例: 「東京」にルビ「とうきょう」。4つのルビ文字が2文字の熟語を1つの単位として注釈します。「東」と「京」の間で改行することはできません。

### 熟語ルビ

複数の漢字がそれぞれ独自の読みを持ちながら、視覚的には1つのまとまりを形成する熟語です。グループルビとは異なり、熟語ルビは改行時に必要に応じて指定された分割点で分割できます。

例: 「東京都」において、東=とう、京=きょう、都=と。分割点により「東」の後および「京」の後での改行が可能ですが、各サブグループのルビテキストは対応する親文字と一緒に保持されます。

## コアレベル: RubyAnnotation と preprocessRuby()

コアレベルでは、ルビはコードポイント配列と測定済みの送り幅で動作します。コアモジュールは外部依存関係がありません。

### RubyAnnotation インターフェース

```ts
interface RubyAnnotation {
  startIndex: number;        // 親文字コードポイント配列の開始位置（含む）
  endIndex: number;          // 親文字コードポイント配列の終了位置（含まない）
  rubyText: Uint32Array;     // コードポイントとしてのルビテキスト
  rubyAdvances: Float32Array; // 測定済みルビ文字幅（ピクセル単位）
  type?: 'mono' | 'group' | 'jukugo'; // デフォルト: 'mono'
  jukugoSplitPoints?: number[]; // 熟語用: 改行可能な親文字相対インデックス
}
```

### preprocessRuby()

`preprocessRuby()` は、ルビテキストの幅を親文字に分配し、ルビグループ内での不正な改行を防ぐためのクラスタIDを生成します。2つの配列を返します:

- **effectiveAdvances** -- 調整後の送り幅。ルビテキストが親文字より広い場合、超過分が親文字に分配されます。
- **clusterIds** -- 同じクラスタIDを持つ文字は行をまたいで分割されません。グループルビではすべての親文字に1つのクラスタIDが割り当てられます。熟語ルビでは分割点の間にサブグループクラスタが作成されます。

幅の分配はJLReqの規則に従います:

1. ルビテキストが親文字より広い場合、隣接するかな文字を確認します。
2. 隣接するかな文字の送り幅の最大50%がルビのはみ出しを吸収できます（左右独立）。
3. 残りの超過分は親文字に比例配分されます。

```ts
import { preprocessRuby, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('漢字を読む');
const advances = new Float32Array([16, 16, 16, 16, 16]);

const annotations: RubyAnnotation[] = [{
  startIndex: 0,
  endIndex: 2,
  rubyText: toCodepoints('かんじ'),
  rubyAdvances: new Float32Array([8, 8, 8]), // ルビ3文字 x 8px = 24px
  type: 'group',
}];

const { effectiveAdvances, clusterIds } = preprocessRuby(text, advances, annotations);
// インデックス0-1の親文字幅: 32px (2 x 16)。ルビ幅: 24px。
// ルビは親文字より狭いため、分配する超過分はなし。
// clusterIds: [0, 0, 2, 3, 4] -- インデックス0と1が同じクラスタを共有（グループルビ）
```

実際には `preprocessRuby()` を直接呼び出すことはほとんどありません。`LayoutInput` に `rubyAnnotations` を渡して `computeBreaks()` を呼び出すと、関数内部で `preprocessRuby()` が呼ばれ、結果の実効送り幅とクラスタIDが改行処理に使用されます。

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('漢字を読む');
const advances = new Float32Array([16, 16, 16, 16, 16]);

const result = computeBreaks({
  text,
  advances,
  lineWidth: 48,
  rubyAnnotations: [{
    startIndex: 0,
    endIndex: 2,
    rubyText: toCodepoints('かんじ'),
    rubyAdvances: new Float32Array([8, 8, 8]),
    type: 'group',
  }],
});
// 改行はグループクラスタリングを尊重: インデックス0と1は分割されない。
```

## ブラウザレベル: RubyInputAnnotation

ブラウザ層は、より扱いやすい文字列ベースの注釈インターフェースを提供します。コードポイント変換と送り幅の測定は自動的に行われます。

### RubyInputAnnotation インターフェース

```ts
interface RubyInputAnnotation {
  startIndex: number;   // 親文字テキスト文字列の文字インデックス
  endIndex: number;     // 終了インデックス（含まない）
  rubyText: string;     // プレーンな文字列としてのルビテキスト
  type?: 'mono' | 'group' | 'jukugo';
  jukugoSplitPoints?: number[];
}
```

`MejiroBrowser.layout()` または `layoutChapter()` に `rubyAnnotations` を渡すと、ブラウザ層が自動的に以下を行います:

1. ルビテキスト文字列を `Uint32Array` のコードポイントに変換。
2. `Canvas.measureText()` を使用してルビ文字の送り幅を測定。
3. ルビフォントサイズを導出（通常、親文字フォントサイズの50%）。
4. コアレベルの `RubyAnnotation[]` を構築し、`computeBreaks()` に渡す。

```ts
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';

const mejiro = new MejiroBrowser();

const result = await mejiro.layout({
  text: '漢字を読む',
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: 200,
  rubyAnnotations: [{
    startIndex: 0,
    endIndex: 2,
    rubyText: 'かんじ',
    type: 'group',
  }],
});
```

複数段落を含む章レベルのレイアウトには `layoutChapter()` を使用します:

```ts
const chapterResult = await mejiro.layoutChapter({
  paragraphs: [
    {
      text: '漢字を読む',
      rubyAnnotations: [{
        startIndex: 0,
        endIndex: 2,
        rubyText: 'かんじ',
        type: 'group',
      }],
    },
    {
      text: '名前はまだ無い',
      rubyAnnotations: [],
    },
  ],
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: verticalLineWidth(600, 16),
});
```

## EPUB からのルビ

EPUBファイルを解析する際、`extractRubyContent()` 関数はXHTMLコンテンツ内の `<ruby><rt>` 要素を自動的に検出し、各段落に対して `RubyInputAnnotation[]` を生成します。

```ts
import { parseEpub } from '@libraz/mejiro/epub';

const book = await parseEpub(buffer);
const paragraph = book.chapters[0].paragraphs[0];
// paragraph.text   -- ルビコンテンツを除去した親文字テキスト
// paragraph.rubyAnnotations -- テキストへの文字インデックスを持つ RubyInputAnnotation[]
```

エクストラクタは一般的なHTMLルビマークアップパターンをすべて処理します:

- シンプル: `<ruby>漢字<rt>かんじ</rt></ruby>`
- `<rp>` 付き（括弧によるフォールバック）: `<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>`
- `<rb>` 付き（明示的な親文字）: `<ruby><rb>漢字</rb><rt>かんじ</rt></ruby>`
- 複数の親文字-rtペア（熟語）: `<ruby>東<rt>とう</rt>京<rt>きょう</rt>都<rt>と</rt></ruby>`

複数の親文字-rtペアの場合、エクストラクタは各ペアに対して個別の注釈を作成し、さらに熟語全体にわたる分割点付きの熟語レベル注釈も追加します。これにより、改行アルゴリズムは必要に応じてサブグループの境界で熟語を分割できます。

## ルビのレンダリング

`buildRenderPage()` は、プレーンテキストとルビ付きテキストを区別する `RenderSegment` エントリを生成します:

```ts
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import { paginate } from '@libraz/mejiro';

// レイアウト後...
const pages = paginate(400, measures);
const page = buildRenderPage(pages[0], entries);

for (const para of page.paragraphs) {
  for (const line of para.lines) {
    for (const segment of line.segments) {
      if (segment.type === 'ruby') {
        // segment.base     -- 親文字テキスト文字列
        // segment.rubyText -- ルビテキスト文字列
        // 以下のようにレンダリング: <ruby>base<rt>rubyText</rt></ruby>
      } else {
        // segment.type === 'text'
        // segment.text -- プレーンテキスト文字列
      }
    }
  }
}
```

`mejiro.css` スタイルシート（`@libraz/mejiro/render/mejiro.css` からインポート）は、`.mejiro-page` 内の `<ruby>` および `<rt>` 要素をスタイリングします:

- `ruby-align: center` -- ルビテキストを親文字の中央に配置。
- `rt { font-size: 0.5em; font-weight: 400; }` -- ルビテキストを親文字フォントサイズの半分、標準ウェイトで表示。

React および Vue コンポーネントパッケージ（`@libraz/mejiro-react`、`@libraz/mejiro-vue`）は、ルビセグメントを適切な `<ruby><rt>` HTML要素として含め、`RenderPage` データを直接レンダリングします。

## 関連ドキュメント

- [はじめに](01-getting-started.md) -- インストールとクイックスタート
- [コアコンセプト](02-core-concepts.md) -- アーキテクチャとデータフロー
- [改行処理](03-line-breaking.md) -- 禁則処理とぶら下げ組み
- [ブラウザ統合](05-browser-integration.md) -- MejiroBrowser クラス
- [APIリファレンス](10-api-reference.md) -- 完全なAPI一覧
