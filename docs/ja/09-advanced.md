# 応用

このドキュメントでは、mejiro の応用的な使い方について解説します。カスタム禁則ルール、形態素解析連携、パフォーマンス特性、サーバーサイド利用、カスタムレンダリングを取り上げます。

---

## 1. カスタム禁則ルール

`computeBreaks()` に `KinsokuRules` オブジェクトを渡すことで、デフォルトの行頭・行末禁則ルールを上書きできます。

### デフォルトルールの拡張

`getDefaultKinsokuRules()` で組み込みの厳密ルールのコピーを取得し、それを変更します:

```ts
import { buildKinsokuRules, getDefaultKinsokuRules, computeBreaks, toCodepoints } from '@libraz/mejiro';

// デフォルトを取得してカスタマイズ
const defaults = getDefaultKinsokuRules();
const rules = buildKinsokuRules({
  lineStartProhibited: [...defaults.lineStartProhibited, 0x2026], // … を追加
  lineEndProhibited: defaults.lineEndProhibited,
});

const result = computeBreaks({
  text: toCodepoints('あいうえお…かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  kinsokuRules: rules,
});
```

### ルールをゼロから作成

デフォルトを継承せずにルールを作成する場合:

```ts
const rules = buildKinsokuRules({
  lineStartProhibited: [0x3001, 0x3002], // 、と。のみ
  lineEndProhibited: [0x300c],           // 「のみ
});
```

`computeBreaks()` に `kinsokuRules` を渡すと、組み込みルールは**完全に置き換え**られます。カスタムルールが有効な場合、`mode` オプション（`'strict'` / `'loose'`）は無視されます。

### KinsokuRules の構造

```ts
interface KinsokuRules {
  lineStartProhibited: number[];        // コードポイント配列
  lineEndProhibited: number[];
  lineStartProhibitedSet: Set<number>;  // 事前計算されたルックアップ用 Set
  lineEndProhibitedSet: Set<number>;
}
```

ルールの作成には必ず `buildKinsokuRules()` を使用してください。この関数はコードポイント配列からルックアップ用の Set を自動生成します。Set なしで `KinsokuRules` オブジェクトを手動構築すると、正しく動作しません。

---

## 2. トークン境界（形態素解析連携）

`tokenBoundaries` オプションを使うと、形態素解析器（MeCab、kuromoji、Sudachi など）を連携させ、自然な単語境界での改行を優先できます。

### 基本的な使い方

```ts
import { tokenLengthsToBoundaries, computeBreaks, toCodepoints } from '@libraz/mejiro';

// 入力: "新しいプログラミング言語" を以下のようにトークン化:
// ["新しい" (3), "プログラミング" (7), "言語" (2)]
const boundaries = tokenLengthsToBoundaries([3, 7, 2]);
// boundaries → Uint32Array [2, 9]  (インデックス 2 と 9 の後で改行を優先)

const text = toCodepoints('新しいプログラミング言語');
const result = computeBreaks({
  text,
  advances: new Float32Array(text.length).fill(16),
  lineWidth: 80,
  tokenBoundaries: boundaries,
});
```

### 動作の仕組み

1. 改行位置を後方検索する際、アルゴリズムはまず禁則的に有効**かつ**トークン境界でもある位置を探します。
2. 有効な候補の中にトークン境界が見つからない場合は、禁則的に有効な任意の位置にフォールバックします。
3. トークン境界は**優先指定**であり、厳密な制約ではありません。禁則ルールが常に優先されます。

### 配列の直接渡し

`Uint32Array` の代わりにプレーンな `number[]` を渡すこともできます:

```ts
computeBreaks({
  text,
  advances,
  lineWidth: 80,
  tokenBoundaries: [2, 9], // readonly number[] も受け付けます
});
```

### tokenLengthsToBoundaries

`tokenLengthsToBoundaries()` ヘルパーは、トークン長（コードポイント数）の配列を境界インデックスに変換します。各境界は、そのトークンの**最後のコードポイント**のインデックスです。最後のトークンの境界はテキスト末尾と一致するため省略されます。

```ts
tokenLengthsToBoundaries([3, 7, 2])
// → Uint32Array [2, 9]
```

---

## 3. パフォーマンス

### O(n) の保証

`computeBreaks()` は文字数 n に対して O(n) 時間で実行されます:

- **前方スキャン**: 各文字は1回だけ参照されます。
- **オーバーフロー時の後方検索**: 各文字は最大でもう1回だけ参照されます（償却計算量）。これは `lineStart` が単調増加するためです。
- 動的計画法やグローバル最適化は行いません。
- 10,000文字の章の場合、アルゴリズムが参照する位置は最大約20,000箇所です。

### 幅キャッシュ

`MejiroBrowser` はコードポイントレベルで文字幅をキャッシュします:

- キャッシュキー: `"${fontSize}px ${fontFamily}"` が `Map<codepoint, width>` にマッピングされます。
- 日本語テキストは通常2,000〜3,000種類のユニークな文字を使用するため、キャッシュはすぐに安定します。
- 章の初回レイアウト: `Canvas.measureText()` ですべての文字を計測します。
- 同じフォントでの以降のレイアウト: ほぼ瞬時（キャッシュヒット）。
- フォント変更時やメモリ集約的な操作の後は `clearCache()` を呼び出してください。

### ベンチマーク

```bash
yarn bench  # ベンチマークを実行
```

### ヒント

- **単一の `MejiroBrowser` インスタンスを再利用**して、レイアウト間で幅キャッシュを活用してください。
- **`layout()` をループで呼び出す代わりに `layoutChapter()` を使用**してください。段落間でフォント読み込みと計測を共有します。
- **初回レイアウト前に `preloadFont()` でフォントを事前計測**すると、体感パフォーマンスが向上します:

```ts
const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

// アプリ初期化時にプリロード
await mejiro.preloadFont();

// 以降の layout 呼び出しではフォント読み込みステップをスキップ
const result = await mejiro.layout({ text, lineWidth: 400 });
```

---

## 4. サーバーサイド利用

コアモジュール（`@libraz/mejiro`）は DOM に一切依存せず、任意の JavaScript ランタイム（Node.js、Deno、Bun、エッジワーカー）で動作します。

```ts
import { computeBreaks, toCodepoints, getLineRanges, paginate } from '@libraz/mejiro';

// Canvas が利用できないため、文字送り幅は自分で用意する必要があります
const text = toCodepoints('吾輩は猫である。名前はまだ無い。');
const advances = new Float32Array(text.length).fill(16); // 等幅の仮定

const result = computeBreaks({ text, advances, lineWidth: 128 });
const lines = getLineRanges(result.breakPoints, text.length);
const pages = paginate(400, [
  { lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 },
]);
```

サーバーでは `Canvas.measureText()` が利用できないため、文字送り幅を取得する方法には以下があります:

- **等幅の仮定** -- すべての CJK 文字が同じ文字送り幅を持つと仮定します。シンプルで、等幅フォントや固定レイアウトのシナリオでは十分な場合が多いです。
- **クライアントサイドでの事前計算** -- ブラウザで文字送り幅を計測し、サーバーに送信します。
- **フォントメトリクスライブラリ** -- fontkit や opentype.js などのライブラリを使い、フォントファイルから直接文字送り幅を計測します。

---

## 5. カスタムレンダリング

`RenderPage` データ構造はフレームワーク非依存です。提供されている React / Vue コンポーネント以外の任意のターゲットにレンダリングできます。

### RenderPage の構造

```ts
interface RenderPage {
  paragraphs: RenderParagraph[];
}

interface RenderParagraph {
  lines: RenderLine[];
  isHeading: boolean;
}

interface RenderLine {
  segments: RenderSegment[];
}

type RenderSegment =
  | { type: 'text'; text: string }
  | { type: 'ruby'; base: string; rubyText: string };
```

### Canvas レンダリング

```ts
function renderToCanvas(ctx: CanvasRenderingContext2D, page: RenderPage): void {
  let x = ctx.canvas.width; // 右端から開始（vertical-rl）
  const lineHeight = 28.8;  // fontSize * lineHeight

  for (const paragraph of page.paragraphs) {
    for (const line of paragraph.lines) {
      x -= lineHeight;
      let y = 0;
      for (const segment of line.segments) {
        const text = segment.type === 'text' ? segment.text : segment.base;
        for (const char of text) {
          ctx.fillText(char, x, y + 16);
          y += 16;
        }
        // ルビの描画は省略
      }
    }
  }
}
```

### 文字列出力（テスト・デバッグ用）

```ts
function renderToString(page: RenderPage): string {
  return page.paragraphs
    .map((p) =>
      p.lines
        .map((l) =>
          l.segments
            .map((s) => (s.type === 'text' ? s.text : `${s.base}(${s.rubyText})`))
            .join('')
        )
        .join('\n')
    )
    .join('\n\n');
}
```

---

## 6. 画像除外（テキスト回り込み）

mejiroは `ExclusionEngine` クラスにより、任意の矩形障害物（画像、図表など）の周りにテキストを流し込む機能をサポートしています。

### 基本的な使い方

```ts
import { ExclusionEngine, computeBreaks, toCodepoints } from '@libraz/mejiro';

const engine = new ExclusionEngine({
  lineWidth: 600,     // 列の高さ（px）
  lineCount: 12,      // 列数
  linePitch: 30.4,    // fontSize × lineHeight
  contentWidth: 380,  // 列に利用可能な幅（px）
});

// 画像を追加（コンテンツ領域座標系）
engine.addImage({ x: 100, y: 50, w: 120, h: 160 });
engine.addImage({ x: 50, y: 300, w: 80, h: 100 });

// 列スロットと行幅を計算
const { slots, lineWidths } = engine.compute();

// lineWidthsをレイアウトエンジンに渡す
const text = toCodepoints('...');
const advances = new Float32Array(text.length).fill(16);
const result = computeBreaks({
  text,
  advances,
  lineWidth: 600,
  lineWidths,   // ExclusionEngineからの列ごとの幅
});

// 各列を slots[i].xPos, slots[i].yStart の位置に
// height = slots[i].height で描画
```

### 動作原理

1. 各列について、水平方向に重なるすべての画像領域を収集する。
2. 重なる領域をマージして非重複区間にする。
3. 画像に占有されていない最大の連続ギャップが、その列のテキスト領域になる。
4. ギャップの高さがその列の実効的な `lineWidth` となり、垂直位置（`yStart`）がテキストの描画開始位置を示す。

### 座標系（縦書き）

`writing-mode: vertical-rl` の場合:
- **ブロック方向** = 水平（列は右から左に配置）
- **インライン方向** = 垂直（テキストは上から下に流れる）
- `ImageRect.x` / `.w` はブロック軸に対応
- `ImageRect.y` / `.h` はインライン軸に対応
- 座標は**コンテンツ領域**の原点（パディング後）からの相対値

### 動的な更新

`ExclusionEngine` はインタラクティブな用途（画像のドラッグ＆ドロップ配置など）向けに設計されています:

```ts
const engine = new ExclusionEngine(geometry);
const img = { x: 100, y: 50, w: 120, h: 160 };
engine.addImage(img);

// ドラッグ時: 座標を更新して再計算
img.x = 150;
img.y = 80;
const { slots, lineWidths } = engine.compute(); // サブミリ秒

// リサイズ時
engine.setGeometry({ ...geometry, lineWidth: 500 });
engine.compute();

// 画像の削除
engine.removeImage(img);
```

### 見開きレイアウト（2ページフロー）

テキストが見開き2ページにわたって流れる書籍スタイルのレイアウトには、`SpreadExclusionEngine` を使用します。ノド（背表紙側余白）の座標変換を自動で処理します:

```ts
import { SpreadExclusionEngine, computeBreaks } from '@libraz/mejiro';

const spread = new SpreadExclusionEngine({
  pageWidth: 537,
  pagePaddingX: 52,    // ノド側+小口側パディング
  pagePaddingY: 56,
  lineWidth: 676,
  linePitch: 30.4,
});

// 画像は右ページの左上を基準に配置。
// 負のx値は自動的にノドのオフセットを考慮して左ページにマッピングされる。
spread.addImage({ x: 200, y: 100, w: 120, h: 160, inlineMargin: 16 });
spread.addImage({ x: -100, y: 300, w: 80, h: 100 }); // 左ページ

const { rightSlots, leftSlots, lineWidths, rightSlotCount } = spread.compute();

// 見開き全体で1回のcomputeBreaks呼び出し
const result = computeBreaks({ text, advances, lineWidth: 676, lineWidths });

// 行をページごとに分割してレンダリング:
// 行 0..rightSlotCount-1 → rightSlotsを使って右ページに描画
// 行 rightSlotCount..     → leftSlotsを使って左ページに描画
```

`ExclusionEngine` との主な違い:
- **ノドの自動処理** — 手動の座標変換が不要
- **連続テキストフロー** — 1つの `lineWidths` 配列が両ページにまたがる
- **分割レンダリング** — `rightSlotCount` で行をページ間で分割

### ワンショット便利関数

画像が変化しない静的レイアウトには `computeExclusionSlots()` を使用:

```ts
import { computeExclusionSlots, computeBreaks } from '@libraz/mejiro';

const { slots, lineWidths } = computeExclusionSlots({
  lineWidth: 600,
  lineCount: 12,
  linePitch: 30.4,
  contentWidth: 380,
  images: [
    { x: 100, y: 50, w: 120, h: 160 },
  ],
});
```

---

## 関連ドキュメント

- [03-line-breaking.md](./03-line-breaking.md) -- 改行アルゴリズム、禁則モード、ぶら下げ組み
- [05-browser-integration.md](./05-browser-integration.md) -- MejiroBrowser、フォント計測、幅キャッシュ
- [08-react-and-vue.md](./08-react-and-vue.md) -- RenderPage 用の React / Vue コンポーネント
- [02-core-concepts.md](./02-core-concepts.md) -- アーキテクチャ、データフロー、TypedArray の規約
