# ルビ注釈

> **v0.5 で変更:** ブラウザ / book / render で扱う段落注釈は、`InlineAnnotation` 判別共用体の `kind: 'ruby'` バリアントになりました。フィールド名は `inlineAnnotations` です。ルビを直接書く場合は `kind: 'ruby'` を付けてください。`RubyInputAnnotation` は互換用に `InlineRubyAnnotation` の deprecated エイリアスとして残しています。

## ルビとは

ルビ（振り仮名）は、本文の文字に添えて小さく表示する読みです。日本語では、漢字の読みを示すためによく使われます。

たとえば「漢字」に添える「かんじ」がルビです。縦書きでは、ルビは親文字の右側に表示されます。

児童書、教材、法律文書、古い読みや珍しい漢字を含む文学作品などでは、ルビが読みやすさに大きく効きます。

## ルビの種類

JLReq（日本語組版処理の要件、W3C）仕様では、3種類のルビが定義されています。

### モノルビ

1 つの親文字に 1 つ以上のルビ文字が対応します。各親文字が独立した注釈を持ちます。

例: 「字」にルビ「じ」。

モノルビでは、各注釈が独立しているため、注釈付き文字間での改行が可能です。

### グループルビ

複数の親文字が 1 つのルビ注釈を共有します。まとまりとして扱うため、途中で分割できません。

例: 「東京」にルビ「とうきょう」。4つのルビ文字が2文字の熟語を1つの単位として注釈します。「東」と「京」の間で改行することはできません。

### 熟語ルビ

複数の漢字がそれぞれの読みを持ちながら、見た目としては 1 つのまとまりになる形式です。グループルビと違い、熟語ルビは指定した分割点で改行できます。

例: 「東京都」において、東=とう、京=きょう、都=と。分割点により「東」の後および「京」の後での改行が可能ですが、各サブグループのルビテキストは対応する親文字と一緒に保持されます。

## コアレベル: RubyAnnotation と preprocessRuby()

コアレベルでは、ルビもコードポイント配列と計測済みの送り幅で扱います。コアモジュールに外部依存はありません。

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

`preprocessRuby()` は、ルビテキストの幅を親文字へ分配し、ルビの途中で不自然に改行されないようにクラスタ ID を生成します。返す主な値は次の 2 つです。

- **effectiveAdvances** -- 調整後の送り幅。ルビテキストが親文字より広い場合、はみ出す分を親文字側へ分配します。
- **clusterIds** -- 同じクラスタ ID を持つ文字は行をまたいで分割されません。グループルビではすべての親文字に同じクラスタ ID が付きます。熟語ルビでは、分割点ごとにサブグループを作ります。

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

実際には `preprocessRuby()` を直接呼び出すことはほとんどありません。`LayoutInput` にコアレベルの `rubyAnnotations` を渡して `computeBreaks()` を呼び出すと、関数内部で `preprocessRuby()` が呼ばれ、結果の実効送り幅とクラスタIDが改行処理に使用されます。

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

## ブラウザレベル: InlineRubyAnnotation

ブラウザ層では、文字列ベースの注釈インターフェースを使えます。コードポイントへの変換と送り幅の測定は自動で行われます。

### InlineRubyAnnotation インターフェース

```ts
interface InlineRubyAnnotation {
  kind: 'ruby';
  startIndex: number;   // 親文字テキスト文字列の文字インデックス
  endIndex: number;     // 終了インデックス（含まない）
  rubyText: string;     // プレーンな文字列としてのルビテキスト
  type?: 'mono' | 'group' | 'jukugo';
  jukugoSplitPoints?: number[];
}
```

`MejiroBrowser.layout()` または `layoutChapter()` に `inlineAnnotations` を渡すと、ブラウザ層が自動的に以下を行います:

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
  inlineAnnotations: [{
    kind: 'ruby',
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
      inlineAnnotations: [{
        kind: 'ruby',
        startIndex: 0,
        endIndex: 2,
        rubyText: 'かんじ',
        type: 'group',
      }],
    },
    {
      text: '名前はまだ無い',
      inlineAnnotations: [],
    },
  ],
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: verticalLineWidth(600, 16),
});
```

## EPUB からのルビ

EPUBファイルを解析する際、`extractRubyContent()` 関数はXHTMLコンテンツ内の `<ruby><rt>` 要素を自動的に検出し、各段落の `inlineAnnotations` にルビ用の `InlineAnnotation` を追加します。

```ts
import { parseEpub } from '@libraz/mejiro/epub';

const book = await parseEpub(buffer);
const paragraph = book.chapters[0].paragraphs[0];
// paragraph.text   -- ルビコンテンツを除去した親文字テキスト
// paragraph.inlineAnnotations -- テキストへの文字インデックスを持つ InlineAnnotation[]
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
- [API リファレンス](10-api-reference.md) -- 公開 API 一覧
