# APIリファレンス

> **注意:** 本ドキュメントは公開APIの全体を網羅しています。パラメータの詳細やデフォルト値については、パッケージに含まれるTypeScript型定義も参照してください。

---

## `@libraz/mejiro` — コア

### 行分割

| エクスポート | シグネチャ |
|---|---|
| `computeBreaks` | `(input: LayoutInput) => BreakResult` |

行分割位置を計算します。禁則処理のバックトラッキングとオプションのぶら下げ組みを備えた貪欲法O(n)アルゴリズムです。

| エクスポート | シグネチャ |
|---|---|
| `canBreakAt` | `(text: Uint32Array, pos: number, clusterIds?: Uint32Array, mode?: KinsokuMode, rules?: KinsokuRules) => boolean` |

指定位置の後ろで行分割が許可されるかどうかを判定します。

| エクスポート | シグネチャ |
|---|---|
| `toCodepoints` | `(str: string) => Uint32Array` |

文字列をUnicodeコードポイントの`Uint32Array`に変換します。`computeBreaks()`で使用します。

### 禁則処理

| エクスポート | シグネチャ |
|---|---|
| `isLineStartProhibited` | `(cp: number, mode?: KinsokuMode, rules?: KinsokuRules) => boolean` |

コードポイントが行頭禁則文字かどうかを判定します。カスタムルールが指定された場合はそれを使用し、それ以外はモードに応じた組み込みルールを使用します。

| エクスポート | シグネチャ |
|---|---|
| `isLineEndProhibited` | `(cp: number, rules?: KinsokuRules) => boolean` |

コードポイントが行末禁則文字かどうかを判定します。

| エクスポート | シグネチャ |
|---|---|
| `getDefaultKinsokuRules` | `() => KinsokuRules` |

事前計算済みルックアップセットを含むデフォルトの厳密禁則ルールセットのコピーを返します。

| エクスポート | シグネチャ |
|---|---|
| `buildKinsokuRules` | `(raw: { lineStartProhibited: number[]; lineEndProhibited: number[] }) => KinsokuRules` |

生のコードポイント配列から事前計算済みルックアップセットを含む`KinsokuRules`オブジェクトを作成します。

### ぶら下げ組み

| エクスポート | シグネチャ |
|---|---|
| `isHangingTarget` | `(cp: number) => boolean` |

コードポイントがぶら下げ対象かどうかを判定します（U+3002, U+3001, U+FF0C, U+FF0E）。

| エクスポート | シグネチャ |
|---|---|
| `computeHangingAdjustment` | `(cp: number, advance: number) => number` |

ぶら下げの突出量を計算します。ぶら下げ対象文字の場合はadvanceを返し、それ以外は0を返します。

### ルビ（振り仮名）前処理

| エクスポート | シグネチャ |
|---|---|
| `preprocessRuby` | `(text: Uint32Array, advances: Float32Array, annotations: RubyAnnotation[], clusterIds?: Uint32Array) => RubyPreprocessResult` |

ルビテキストの幅を親文字に分配し、クラスタIDを生成します。JLReqの隣接仮名へのはみ出し（50%）を適用します。

| エクスポート | シグネチャ |
|---|---|
| `isKana` | `(cp: number) => boolean` |

コードポイントがひらがな（U+3040--U+309F）またはカタカナ（U+30A0--U+30FF）かどうかを判定します。

### クラスタサポート

| エクスポート | シグネチャ |
|---|---|
| `resolveClusterBoundaries` | `(text: Uint32Array, clusterIds?: Uint32Array) => Uint8Array` |

1がその位置の後ろでの分割禁止を意味するビットマスクを返します。

| エクスポート | シグネチャ |
|---|---|
| `isClusterBreakAllowed` | `(clusterIds: Uint32Array | undefined, pos: number, textLength: number) => boolean` |

クラスタ境界を考慮して、指定位置での分割が許可されるかどうかを判定します。

### ページネーション

| エクスポート | シグネチャ |
|---|---|
| `paginate` | `(pageBlockSize: number, paragraphs: ParagraphMeasure[]) => PageSlice[][]` |

段落の行を固定サイズのページに分配し、ページ境界で分割します。

| エクスポート | シグネチャ |
|---|---|
| `getLineRanges` | `(breakPoints: Uint32Array, charCount: number) => [number, number][]` |

分割点を行ごとの`[start, end)`文字インデックスペアに変換します。

### トークン境界

| エクスポート | シグネチャ |
|---|---|
| `tokenLengthsToBoundaries` | `(tokenLengths: number[]) => Uint32Array` |

形態素解析器のトークン長を`LayoutInput.tokenBoundaries`用の境界インデックスに変換します。

### 型定義

**`LayoutInput`** -- `computeBreaks()`の入力:

- `text: Uint32Array` -- Unicodeコードポイント
- `advances: Float32Array` -- 文字ごとの送り幅（px）
- `lineWidth: number` -- 利用可能な行幅（px）
- `mode?: KinsokuMode` -- `'strict'`（デフォルト）または`'loose'`
- `enableHanging?: boolean` -- ぶら下げ組みを有効にする（デフォルト: `true`）
- `clusterIds?: Uint32Array` -- 不可分文字グループ
- `rubyAnnotations?: RubyAnnotation[]` -- ルビ注釈
- `tokenBoundaries?: Uint32Array | readonly number[]` -- 優先分割位置
- `kinsokuRules?: KinsokuRules` -- カスタム禁則ルール

**`BreakResult`** -- `computeBreaks()`の出力:

- `breakPoints: Uint32Array` -- 各分割前の最後の文字のインデックス
- `hangingAdjustments?: Float32Array` -- 行ごとのぶら下げ突出量（px）
- `effectiveAdvances?: Float32Array` -- ルビ分配後の文字ごとの送り幅

**`KinsokuMode`** -- `'strict' | 'loose'`

**`KinsokuRules`** -- カスタム禁則ルール:

- `lineStartProhibited: number[]` / `lineEndProhibited: number[]`
- `lineStartProhibitedSet: Set<number>` / `lineEndProhibitedSet: Set<number>`

**`RubyAnnotation`** -- コアレベルのルビ注釈:

- `startIndex: number` / `endIndex: number` -- 親文字中の範囲
- `rubyText: Uint32Array` / `rubyAdvances: Float32Array`
- `type?: 'mono' | 'group' | 'jukugo'`
- `jukugoSplitPoints?: number[]`

**`ParagraphMeasure`** -- ページネーション入力:

- `lineCount: number` / `linePitch: number` / `gapBefore: number`

**`PageSlice`** -- ページネーション出力:

- `paragraphIndex: number` / `lineStart: number` / `lineEnd: number`

---

## `@libraz/mejiro/browser` — ブラウザ統合

### 高レベルAPI

**`MejiroBrowser`** -- メインクラス:

- `constructor(options?: MejiroBrowserOptions)`
- `layout(options: LayoutOptions): Promise<BreakResult>` -- 単一段落のレイアウト
- `layoutChapter(options: ChapterLayoutOptions): Promise<ChapterLayoutResult>` -- 複数段落のレイアウト
- `preloadFont(fontFamily?: string, fontSize?: number): Promise<void>` -- フォントの先読み
- `verticalLineWidth(containerHeight: number, fontSize?: number): number` -- 有効な行幅を計算
- `clearCache(fontKey?: string): void` -- 幅キャッシュをクリア

| エクスポート | シグネチャ |
|---|---|
| `layoutText` | `(options: { text, fontFamily, fontSize, lineWidth, mode?, enableHanging?, rubyAnnotations? }) => Promise<BreakResult>` |

スタンドアロンのワンショットレイアウト関数。一時的な`MejiroBrowser`インスタンスを作成し、テキストを計測し、分割を計算します。

| エクスポート | シグネチャ |
|---|---|
| `verticalLineWidth` | `(containerHeight: number, fontSize: number) => number` |

縦書きテキストの有効な行幅を計算します。計算式: `containerHeight - fontSize * 0.5`。

### フォントと計測

- `FontLoader` -- FontFace APIによるフォント読み込み
- `CharMeasurer` -- Canvas.measureTextによる文字計測（コードポイントキャッシュ付き）
- `WidthCache` -- `Map<fontKey, Map<codepoint, width>>`
- `deriveRubyFont(fontFamily: string, fontSize: number): string` -- ルビフォント仕様（半分サイズ）
- `toFontSpec(fontFamily: string, fontSize: number): string` -- CSSフォント仕様

### 型定義

**`MejiroBrowserOptions`**:

- `fixedFontFamily?: string`
- `fixedFontSize?: number`
- `strictFontCheck?: boolean`

**`LayoutOptions`**:

- `text: string`
- `fontFamily?: string`
- `fontSize?: number`
- `lineWidth: number`
- `mode?: KinsokuMode`
- `enableHanging?: boolean`
- `rubyAnnotations?: RubyInputAnnotation[]`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`ChapterLayoutOptions`**:

- `paragraphs: ParagraphInput[]`
- `fontFamily?: string`
- `fontSize?: number`
- `lineWidth: number`
- `mode?: KinsokuMode`
- `enableHanging?: boolean`

**`ChapterLayoutResult`**:

- `paragraphs: ParagraphLayoutResult[]`

**`ParagraphLayoutResult`**:

- `breakResult: BreakResult`
- `chars: string[]`

**`ParagraphInput`**:

- `text: string`
- `rubyAnnotations?: RubyInputAnnotation[]`
- `fontFamily?: string`
- `fontSize?: number`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`RubyInputAnnotation`**:

- `startIndex: number`
- `endIndex: number`
- `rubyText: string`
- `type?: 'mono' | 'group' | 'jukugo'`
- `jukugoSplitPoints?: number[]`

---

## `@libraz/mejiro/epub` — EPUB解析

| エクスポート | シグネチャ |
|---|---|
| `parseEpub` | `(buffer: ArrayBuffer) => Promise<EpubBook>` |

EPUBファイルをルビ注釈付きの構造化されたチャプターに解析します。

| エクスポート | シグネチャ |
|---|---|
| `extractRubyContent` | `(xhtml: string) => AnnotatedParagraph[]` |

XHTMLドキュメント文字列から段落とルビ注釈を抽出します。

### 型定義

**`EpubBook`**:

- `title: string`
- `author?: string`
- `chapters: EpubChapter[]`

**`EpubChapter`**:

- `title?: string`
- `paragraphs: AnnotatedParagraph[]`

**`AnnotatedParagraph`**:

- `text: string`
- `rubyAnnotations: RubyInputAnnotation[]`
- `headingLevel?: number`

---

## `@libraz/mejiro/render` — レンダーデータ

| エクスポート | シグネチャ |
|---|---|
| `buildParagraphMeasures` | `(entries: RenderEntry[], options: MeasureOptions) => ParagraphMeasure[]` |

ページネーション用の段落計測値を計算します。

| エクスポート | シグネチャ |
|---|---|
| `buildRenderPage` | `(slices: PageSlice[], entries: RenderEntry[]) => RenderPage` |

ページスライスとエントリをレンダリング可能なページ構造に変換します。

### CSS

```ts
import '@libraz/mejiro/render/mejiro.css';
```

### 型定義

**`RenderEntry`**:

- `chars: string[]`
- `breakPoints: Uint32Array`
- `rubyAnnotations: RubyInputAnnotation[]`
- `isHeading: boolean`

**`RenderPage`**:

- `paragraphs: RenderParagraph[]`

**`RenderParagraph`**:

- `lines: RenderLine[]`
- `isHeading: boolean`

**`RenderLine`**:

- `segments: RenderSegment[]`

**`RenderSegment`**:

- `{ type: 'text'; text: string } | { type: 'ruby'; base: string; rubyText: string }`

**`MeasureOptions`**:

- `fontSize: number`
- `lineHeight: number`
- `headingScale?: number`（デフォルト: 1.4）
- `paragraphGapEm?: number`（デフォルト: 0.4）
- `headingGapEm?: number`（デフォルト: 1.2）

---

## `@libraz/mejiro-react` — Reactコンポーネント（実験的）

```bash
npm install @libraz/mejiro-react  # peerDep: react >=18
```

**`MejiroPage`** -- `(props: MejiroPageProps) => ReactNode`

Props:

- `page: RenderPage` -- 必須
- `className?: string`
- `style?: CSSProperties`

---

## `@libraz/mejiro-vue` — Vueコンポーネント（実験的）

```bash
npm install @libraz/mejiro-vue  # peerDep: vue >=3.3
```

**`MejiroPage`** -- Vueコンポーネント（defineComponent）

Props:

- `page: RenderPage` -- 必須

---

[ドキュメント目次に戻る](./README.md)
