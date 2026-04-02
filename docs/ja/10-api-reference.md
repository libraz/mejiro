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

### 画像除外

**`ExclusionEngine`** — テキストレイアウトにおける画像除外ゾーンの管理:

- `constructor(geometry: ExclusionPageGeometry)`
- `setGeometry(geometry: ExclusionPageGeometry): void` — ページジオメトリの更新
- `getGeometry(): Readonly<ExclusionPageGeometry>` — 現在のジオメトリを取得
- `addImage(rect: ImageRect): this` — 画像を追加（チェーン可能）
- `removeImage(rect: ImageRect): boolean` — 参照による画像の削除
- `clearImages(): void` — 全画像を削除
- `getImages(): readonly ImageRect[]` — 現在の画像一覧を取得
- `imageCount: number` — 画像数（getter）
- `compute(): { slots: ColumnSlot[]; lineWidths: Float32Array }` — 列ごとのスロットと行幅を計算

**`SpreadExclusionEngine`** — 見開き2ページにわたる画像除外の管理:

- `constructor(geometry: SpreadGeometry)`
- `setGeometry(geometry: SpreadGeometry): void` — 見開きジオメトリの更新
- `getGeometry(): Readonly<SpreadGeometry>` — 現在のジオメトリを取得
- `addImage(rect: ImageRect): this` — 画像を追加（右ページ左上基準。負の`x`は左ページ）
- `removeImage(rect: ImageRect): boolean` — 参照による画像の削除
- `clearImages(): void` — 全画像を削除
- `getImages(): readonly ImageRect[]` — 現在の画像一覧を取得
- `imageCount: number` — 画像数（getter）
- `compute(): SpreadExclusionResult` — 両ページのスロットとlineWidthsを計算

ノド（ページ間余白）の座標変換を自動で処理。テキストは右ページから左ページへ連続して流れる。

| エクスポート | シグネチャ |
|---|---|
| `computeExclusionSlots` | `(options: ExclusionPageGeometry & { images: readonly ImageRect[] }) => { slots: ColumnSlot[]; lineWidths: Float32Array }` |

便利関数。`ExclusionEngine` を作成し、全画像を追加して `compute()` を呼ぶのと等価。

| エクスポート | シグネチャ |
|---|---|
| `computeLineWidths` | `(baseLineWidth: number, lineCount: number, exclusions: readonly ExclusionZone[]) => Float32Array` |

低レベルAPI。除外ゾーンを基準幅から差し引いて行ごとの幅を計算する。

### 型定義

**`LayoutInput`** -- `computeBreaks()`の入力:

- `text: Uint32Array` -- Unicodeコードポイント
- `advances: Float32Array` -- 文字ごとの送り幅（px）
- `lineWidth: number` -- 利用可能な行幅（px）
- `lineWidths?: Float32Array` -- 行ごとの幅（`lineWidth` を上書き）
- `mode?: KinsokuMode` -- `'strict'`（デフォルト）または`'loose'`
- `enableHanging?: boolean` -- ぶら下げ組みを有効にする（デフォルト: `true`）
- `clusterIds?: Uint32Array` -- 不可分文字グループ
- `rubyAnnotations?: RubyAnnotation[]` -- ルビ注釈
- `tokenBoundaries?: Uint32Array | readonly number[]` -- 優先分割位置
- `kinsokuRules?: KinsokuRules` -- カスタム禁則ルール

**`BreakResult`** -- `computeBreaks()`の出力:

- `breakPoints: Uint32Array` -- 各分割前の最後の文字のインデックス
- `hangingAdjustments?: Float32Array` -- 行ごとのぶら下げ突出量（px）
- `lineWidths?: Float32Array` -- 各行で使用された実際の幅（`lineWidths` 入力が指定された場合に存在）
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

**`ExclusionPageGeometry`** — 除外計算用のページジオメトリ:

- `lineWidth: number` — 基本行幅（px）
- `lineCount: number` — 列数
- `linePitch: number` — 列ピッチ（fontSize × lineHeight）（px）
- `contentWidth: number` — ブロック方向のコンテンツ幅（px）

**`ImageRect`** — コンテンツ領域座標系での画像矩形:

- `x: number` / `y: number` — コンテンツ領域原点からの位置（px）
- `w: number` / `h: number` — サイズ（px）

**`ColumnSlot`** — 列ごとの描画スロット:

- `xPos: number` — コンテンツ領域右端からのオフセット（px）
- `yStart: number` — コンテンツ上端からの垂直オフセット（px）
- `height: number` — テキストに利用可能な高さ（px）

**`ExclusionZone`** — 低レベル除外ゾーン:

- `blockStart: number` / `blockEnd: number` — 影響する行範囲
- `inlineSize: number` — 消費するスペース（px）

**`SpreadGeometry`** — 見開き2ページのジオメトリ:

- `pageWidth: number` — 各ページの幅（px）
- `pagePaddingX: number` — 各辺の水平パディング（px）
- `pagePaddingY: number` — 上部の垂直パディング（px）
- `lineWidth: number` — 基本行幅（px）
- `linePitch: number` — 列ピッチ（px）

**`SpreadExclusionResult`** — 見開き除外計算の結果:

- `rightSlots: ColumnSlot[]` — 右ページのスロット
- `leftSlots: ColumnSlot[]` — 左ページのスロット
- `lineWidths: Float32Array` — 結合された行幅（右+左）、`computeBreaks()` 用
- `rightSlotCount: number` — 右ページのスロット数

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

## `@libraz/mejiro/book` — 高レベルAPI

ほとんどのアプリケーションに推奨されるエントリポイントです。フォント読み込み、レイアウト、ページネーション、画像除外をシンプルなクラスベースのAPIで統合します。

### MejiroBook

**`MejiroBook`** — メインオーケストレータークラス:

- `constructor(options: BookOptions)` — フォント、行間、見出し設定で作成
- `setOptions(options: Partial<BookOptions>): void` — オプションを更新（既存のレイアウトには影響しない）
- `setPageSize(size: PageSize): void` — ページジオメトリを設定（`layoutChapter`の前に呼び出す必要あり）
- `layoutChapter(chapter: { paragraphs: BookParagraph[] }): Promise<ChapterLayout>` — 章をレイアウト（`EpubChapter`と互換）
- `clearCache(fontKey?: string): void` — 文字幅計測キャッシュをクリア

### ChapterLayout

**`ChapterLayout`** — レイアウト済みの章のページネーションと画像除外を管理:

- `totalPages: number` — 総ページ数（getter、遅延計算をトリガー）
- `hasImages: boolean` — 画像除外が設定されているか
- `resize(size: Partial<PageSize> & { lineSpacing?: number }): void` — ジオメトリを更新。`lineWidth`変更時は改行を再計算
- `setImages(spreadIndex: number, images: BookImage[]): void` — スプレッドの画像除外を設定（空配列で削除）
- `clearImages(): void` — すべての画像除外を削除
- `getSpread(spreadIndex: number): SpreadResult` — 見開きのレイアウトデータを取得
- `getPage(pageIndex: number): PageResult` — 単一ページのレイアウトデータを取得

### 型定義

**`BookOptions`**:

- `fontFamily: string` — CSSフォントファミリー
- `fontSize: number` — 基本フォントサイズ（px）
- `lineSpacing?: number` — 行間倍率（デフォルト: 1.8）
- `mode?: 'strict' | 'loose'` — 禁則モード（デフォルト: `'strict'`）
- `enableHanging?: boolean` — ぶら下げ組み（デフォルト: `true`）
- `headingStyles?: Record<number, HeadingStyle>` — レベル別見出しスタイル
- `headingScale?: number` — デフォルトの見出しスケール（デフォルト: 1.4）

**`PageSize`**:

- `pageWidth: number` — ページ幅（px）
- `lineWidth: number` — 行幅/カラム高さ（px）
- `pagePaddingX?: number` — 水平パディング（デフォルト: 0）
- `pagePaddingY?: number` — 垂直パディング（デフォルト: 0）

**`BookParagraph`**:

- `text: string`
- `rubyAnnotations?: RubyInputAnnotation[]`
- `headingLevel?: number`

**`BookImage`**:

- `x: number` / `y: number` — 右ページ左上からの位置（px）
- `w: number` / `h: number` — サイズ（px）
- `margin?: number` — インラインマージン（デフォルト: 基本fontSize）

**`SpreadResult`**:

- `right: PageResult` — 右ページ（縦書き読み順で最初）
- `left: PageResult` — 左ページ
- `totalPages: number`

**`PageResult`**:

- `page: RenderPage` — 段落構造データ（CSS `vertical-rl` レンダリング用）
- `lines: PageLine[]` — フラットな行リスト（スロットベースの絶対配置レンダリング用）
- `slots: ColumnSlot[]` — 行ごとの位置とサイズ
- `hasImages: boolean` — このページに画像除外があるか

**`PageLine`**:

- `segments: RenderSegment[]` — テキストとルビのセグメント
- `headingLevel?: number` — 見出しレベル（本文はundefined）
- `fontSize: number` — 計算済みフォントサイズ（px、見出しスケール反映済み）

---

## `@libraz/mejiro-react` — Reactコンポーネント（実験的）

```bash
npm install @libraz/mejiro-react  # peerDep: react >=18
```

**`MejiroPageView`** -- 推奨。`ChapterLayout`からの`PageResult`をレンダリング。CSS vertical-rlとスロットベースレンダリングを自動切替。

Props:

- `result: PageResult` -- 必須
- `fontFamily?: string` -- CSSフォントファミリー（スロットモード用）
- `lineSpacing?: number` -- 行間倍率（スロットモード用）
- `className?: string`
- `style?: CSSProperties`

**`MejiroPage`** -- 低レベル。`RenderPage`をCSS `writing-mode: vertical-rl`でレンダリング。

Props:

- `page: RenderPage` -- 必須
- `className?: string`
- `style?: CSSProperties`

---

## `@libraz/mejiro-vue` — Vueコンポーネント（実験的）

```bash
npm install @libraz/mejiro-vue  # peerDep: vue >=3.3
```

**`MejiroPageView`** -- 推奨。`ChapterLayout`からの`PageResult`をレンダリング。CSS vertical-rlとスロットベースレンダリングを自動切替。

Props:

- `result: PageResult` -- 必須
- `fontFamily?: string` -- CSSフォントファミリー（スロットモード用）
- `lineSpacing?: number` -- 行間倍率（スロットモード用）

**`MejiroPage`** -- 低レベル。`RenderPage`をCSS `writing-mode: vertical-rl`でレンダリング。

Props:

- `page: RenderPage` -- 必須

---

[ドキュメント目次に戻る](./README.md)
