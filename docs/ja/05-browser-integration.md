# ブラウザ統合

このページでは、ブラウザ向けのレイヤーである `@libraz/mejiro/browser` を説明します。フォントの読み込み、文字幅の計測、ブラウザ上での縦書きレイアウト補助を担当します。

## 1. MejiroBrowserクラス

`MejiroBrowser` は、ブラウザ上でレイアウトするときの基本 API です。フォント読み込み、文字幅キャッシュ、改行計算への橋渡しを行います。インスタンスを使い回すと、文字幅キャッシュも再利用できます。

```ts
import { MejiroBrowser } from '@libraz/mejiro/browser';

const mejiro = new MejiroBrowser();
```

コンストラクタオプションを渡すと、以降のレイアウト呼び出しで使うデフォルト値を設定できます。

```ts
const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
  strictFontCheck: false,
});
```

### コンストラクタオプション (`MejiroBrowserOptions`)

| オプション | 型 | 説明 |
|--------|------|-------------|
| `fixedFontFamily` | `string` | すべてのレイアウトに適用されるデフォルトのフォントファミリー。 |
| `fixedFontSize` | `number` | すべてのレイアウトに適用されるデフォルトのフォントサイズ（px単位）。 |
| `strictFontCheck` | `boolean` | `true`の場合、フォント読み込み時にフォールバックが検出されるとエラーをスローします。 |

`fixedFontFamily` と `fixedFontSize` を設定しておくと、個別の `layout()` や `layoutChapter()` ではそれらを省略できます。

## 2. フォント読み込み

正確に文字幅を測るには、対象フォントが読み込まれている必要があります。`MejiroBrowser` は `layout()` / `layoutChapter()` の中でフォントを自動読み込みしますが、初回レイアウトの待ち時間を減らしたい場合は、事前にプリロードできます。

```ts
await mejiro.preloadFont('"Noto Serif JP"', 16);
```

インスタンスに固定フォント値がすでに設定されている場合は、引数なしで`preloadFont()`を呼び出せます:

```ts
await mejiro.preloadFont();
```

内部的には、`preloadFont()`は`FontLoader`クラスに処理を委譲し、`document.fonts.load()`を呼び出して指定されたフォントがCanvas計測で利用可能であることを保証します。

## 3. 文字幅計測

`CharMeasurer`は`Canvas.measureText()`を使用して文字幅を計測します。計測された幅は2階層のマップ構造を持つ`WidthCache`に保存されます:

```
Map<fontKey, Map<codepoint, width>>
```

- 指定フォントでの文字の初回計測時に`Canvas.measureText()`が呼び出されます。
- 同じ文字とフォントの後続の参照では、キャッシュされた値が即座に返されます。
- `fontKey`は`'16px "Noto Serif JP"'`のようなCSSフォント指定文字列です。

フォントの変更時やメモリ解放のためにキャッシュをクリアできます:

```ts
mejiro.clearCache();                          // すべてのキャッシュされた幅をクリア
mejiro.clearCache('16px "Noto Serif JP"');    // 特定のフォントのみクリア
```

## 4. layout() -- 単一段落

`layout()`は単一の段落テキストをレイアウトします。フォントを読み込み（まだ読み込まれていない場合）、文字幅を計測し、改行位置を計算します。

```ts
const result = await mejiro.layout({
  text: '吾輩は猫である。名前はまだ無い。',
  fontFamily: '"Noto Serif JP"',  // fixedFontFamilyが設定済みなら省略可
  fontSize: 16,                    // fixedFontSizeが設定済みなら省略可
  lineWidth: verticalLineWidth(600, 16),
  mode: 'strict',
  enableHanging: true,
  inlineAnnotations: [],
  tokenBoundaries: undefined,
});
// result: BreakResult { breakPoints, hangingAdjustments?, effectiveAdvances? }
```

### LayoutOptions

| フィールド | 型 | デフォルト | 説明 |
|-------|------|---------|-------------|
| `text` | `string` | (必須) | レイアウトするテキスト。 |
| `fontFamily` | `string` | `fixedFontFamily` | CSSフォントファミリー。インスタンスのデフォルトを上書きします。 |
| `fontSize` | `number` | `fixedFontSize` | フォントサイズ（px単位）。インスタンスのデフォルトを上書きします。 |
| `lineWidth` | `number` | (必須) | 利用可能な行幅（px単位）。 |
| `mode` | `'strict' \| 'loose'` | `'strict'` | 禁則処理モード。 |
| `enableHanging` | `boolean` | `true` | ぶら下げ組みを有効にする。 |
| `inlineAnnotations` | `InlineAnnotation[]` | `[]` | 文字列ベースのインデックスを使用したルビ・圏点・縦中横・リンク等の注釈。 |
| `tokenBoundaries` | `Uint32Array \| readonly number[]` | `undefined` | 改行改善のためのトークン境界インデックス。 |

## 5. layoutChapter() -- 複数段落

`layoutChapter()`は章全体を段落の列としてレイアウトします。各段落はベースのフォントファミリーとフォントサイズを上書きでき、見出しやその他のスタイルバリエーションに便利です。

```ts
const result = await mejiro.layoutChapter({
  paragraphs: [
    { text: '第一章', fontSize: 22 },
    { text: '吾輩は猫である。名前はまだ無い。' },
    {
      text: '漢字を読む',
      inlineAnnotations: [{ kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ' }],
    },
  ],
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: verticalLineWidth(600, 16),
  mode: 'strict',
  enableHanging: true,
});

// result.paragraphs[i].breakResult -- 段落iのBreakResult
// result.paragraphs[i].chars       -- string[]の文字配列
```

### ChapterLayoutOptions

| フィールド | 型 | デフォルト | 説明 |
|-------|------|---------|-------------|
| `paragraphs` | `ParagraphInput[]` | (必須) | レイアウトする段落の配列。 |
| `fontFamily` | `string` | `fixedFontFamily` | すべての段落に適用されるベースのフォントファミリー。 |
| `fontSize` | `number` | `fixedFontSize` | すべての段落に適用されるベースのフォントサイズ。 |
| `lineWidth` | `number` | (必須) | 行幅（px単位）。 |
| `mode` | `'strict' \| 'loose'` | `'strict'` | 禁則処理モード。 |
| `enableHanging` | `boolean` | `true` | ぶら下げ組みを有効にする。 |

### ParagraphInput

| フィールド | 型 | デフォルト | 説明 |
|-------|------|---------|-------------|
| `text` | `string` | (必須) | 段落テキスト。 |
| `inlineAnnotations` | `InlineAnnotation[]` | `[]` | この段落のインライン注釈。 |
| `fontFamily` | `string` | (継承) | この段落のベースフォントファミリーを上書きする。 |
| `fontSize` | `number` | (継承) | この段落のベースフォントサイズを上書きする。 |
| `tokenBoundaries` | `Uint32Array \| readonly number[]` | `undefined` | トークン境界インデックス。 |

## 6. verticalLineWidth()

縦書きレイアウトで実際に使う行幅を計算します。Canvas の水平計測と CSS 縦書き表示の差を吸収するため、コンテナの高さからフォントサイズの半分を安全マージンとして差し引きます。

```ts
import { verticalLineWidth } from '@libraz/mejiro/browser';

const lineWidth = verticalLineWidth(600, 16);
// 返却値: 600 - 16 * 0.5 = 592
```

**計算式:** `containerHeight - fontSize * 0.5`

`MejiroBrowser`インスタンスは、`fixedFontSize`が設定されている場合にそれを使用するメソッドとしてもこれを公開しています:

```ts
const lineWidth = mejiro.verticalLineWidth(600);
```

## 7. layoutText() -- スタンドアロン関数

`layoutText()`は`MejiroBrowser`インスタンスの作成を必要としないワンショットのレイアウト関数です。内部で独自のメジャラーを作成するため、呼び出し間でのキャッシュはありません。

```ts
import { layoutText } from '@libraz/mejiro/browser';

const result = await layoutText({
  text: '吾輩は猫である。',
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: 128,
});
```

一度だけレイアウトしたい場合に便利です。何度もレイアウトする場合は `MejiroBrowser` を使ってください。幅キャッシュを再利用でき、フォント読み込みや計測の重複を避けられます。

## 8. その他のエクスポート

`@libraz/mejiro/browser`サブパスは、より低レベルのビルディングブロックもエクスポートしています:

| エクスポート | 説明 |
|--------|-------------|
| `FontLoader` | FontFace API（`document.fonts.load`）を使用した低レベルのフォント読み込み。 |
| `CharMeasurer` | `Canvas.measureText()`を使用した低レベルの文字幅計測。 |
| `WidthCache` | `Map<fontKey, Map<codepoint, width>>`構造の幅キャッシュ。 |
| `deriveRubyFont(fontFamily, fontSize)` | ルビ用フォント指定を導出する（通常はベースフォントサイズの半分）。 |
| `toFontSpec(fontFamily, fontSize)` | CSSフォント指定文字列を生成する（例: `'16px "Noto Serif JP"'`）。 |

---

## 関連ドキュメント

- [はじめに](./01-getting-started.md)
- [コアコンセプト](./02-core-concepts.md)
