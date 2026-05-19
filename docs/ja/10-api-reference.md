# API リファレンス

> **注意:** このページは公開 API の一覧です。パラメータの詳細やデフォルト値は、パッケージに含まれる TypeScript 型定義もあわせて確認してください。

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

### ページ分割

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

### テキスト補助

| エクスポート | シグネチャ |
|---|---|
| `formatDialogueLineBreaks` | `(text: string) => string` |

原稿テキスト内の日本語会話括弧の前後に自然な改行を入れ、余分な空行を作らないよう正規化します。

### 画像回り込み

**`ExclusionEngine`** — テキストが避ける矩形領域の管理:

- `constructor(geometry: ExclusionPageGeometry)`
- `setGeometry(geometry: ExclusionPageGeometry): void` — ページジオメトリの更新
- `getGeometry(): Readonly<ExclusionPageGeometry>` — 現在のジオメトリを取得
- `addImage(rect: ImageRect): this` — 画像を追加（チェーン可能）
- `removeImage(rect: ImageRect): boolean` — 参照による画像の削除
- `clearImages(): void` — 全画像を削除
- `getImages(): readonly ImageRect[]` — 現在の画像一覧を取得
- `imageCount: number` — 画像数（getter）
- `compute(): { slots: ColumnSlot[]; lineWidths: Float32Array }` — 列ごとのスロットと行幅を計算

**`SpreadExclusionEngine`** — 見開き 2 ページにわたる回り込み領域の管理:

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

### オーバーレイ補助

| エクスポート | シグネチャ |
|---|---|
| `moveImageOverlayRect` | `(rect: ImageOverlayRect, deltaX: number, deltaY: number) => ImageOverlayRect` |
| `resizeImageOverlayRect` | `(rect: ImageOverlayRect, deltaX: number, deltaY: number, minSize?: number) => ImageOverlayRect` |

画像オーバーレイUIで、入力を変更せずに矩形を移動・リサイズする純粋関数です。

### 型定義

**`LayoutInput`** -- `computeBreaks()`の入力:

- `text: Uint32Array` -- Unicodeコードポイント
- `advances: Float32Array` -- 文字ごとの送り幅（px）
- `lineWidth: number` -- 利用可能な行幅（px）
- `lineWidths?: Float32Array` -- 行ごとの幅（`lineWidth` を上書き）
- `mode?: KinsokuMode` -- `'strict'`（デフォルト）または`'loose'`
- `enableHanging?: boolean` -- ぶら下げ組みを有効にする（デフォルト: `true`）
- `clusterIds?: Uint32Array` -- 不可分文字グループ
- `rubyAnnotations?: RubyAnnotation[]` -- 改行処理で使用するコアレベルのルビ注釈
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

**`ParagraphMeasure`** -- ページ分割の入力:

- `lineCount: number` / `linePitch: number` / `gapBefore: number`

**`PageSlice`** -- ページ分割の出力:

- `paragraphIndex: number` / `lineStart: number` / `lineEnd: number`

**`ExclusionPageGeometry`** — 除外計算用のページジオメトリ:

- `lineWidth: number` — 基本行幅（px）
- `lineCount: number` — 列数
- `linePitch: number` — 列ピッチ（fontSize × lineHeight）（px）
- `contentWidth: number` — ブロック方向のコンテンツ幅（px）

**`ImageRect`** — コンテンツ領域座標系での画像矩形:

- `x: number` / `y: number` — コンテンツ領域原点からの位置（px）
- `w: number` / `h: number` — サイズ（px）

**`ImageOverlayRect`** — UIオーバーレイ矩形:

- `x: number` / `y: number` — オーバーレイ位置（px）
- `w: number` / `h: number` — オーバーレイサイズ（px）

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
| `layoutText` | `(options: { text, fontFamily, fontSize, lineWidth, mode?, enableHanging?, inlineAnnotations? }) => Promise<BreakResult>` |

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
- `normalizeFontFamily(fontFamily: FontFamily): string` -- 文字列またはフォントファミリー配列を CSS font-family 文字列へ正規化
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
- `inlineAnnotations?: readonly InlineAnnotation[]`
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
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `fontFamily?: string`
- `fontSize?: number`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`InlineAnnotation` / `InlineRubyAnnotation`**:

- `kind: 'ruby' | 'emphasis' | 'tcy' | 'em' | 'strong' | 'link' | 'footnote'`
- `startIndex: number`
- `endIndex: number`
- ルビ variant: `rubyText: string`、`type?: 'mono' | 'group' | 'jukugo'`、`jukugoSplitPoints?: number[]`

`RubyInputAnnotation` は `InlineRubyAnnotation` の deprecated エイリアスとして残っています。

---

## `@libraz/mejiro/epub` — EPUB解析と生成

| エクスポート | シグネチャ |
|---|---|
| `parseEpub` | `(buffer: ArrayBuffer) => Promise<EpubBook>` |
| `parseEditableEpub` | `(buffer: ArrayBuffer) => Promise<EditableEpub>` |
| `EditableEpub` | 段落/画像ブロックを編集して再エクスポートするクラス |
| `exportEditableEpub` | `(book: EditableEpub \| EditableEpubBook, options?: EpubExportOptions) => Promise<ArrayBuffer>` |
| `updateEpubParagraph` | 編集可能EPUB内の段落ブロックを更新 |
| `setEpubInlineAnnotations` | 段落ブロックのインライン注釈を置換 |
| `addEpubChapterImage` | 編集可能章に画像ブロックとアセットを追加。v0.5 の `{ filename, data, ... }` と、非推奨の v0.4 `{ href, mediaType, afterParagraph }` 入力を受け付けます。 |
| `EpubProject` | 原稿章から新規 EPUB 3 パッケージを生成するクラス |
| `parseManuscript` | 原稿テキストを段落とインライン注釈へ変換 |
| `parseManuscriptRuby` | 1つのテキスト片の青空文庫風ルビ記法を解析 |

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
- `inlineAnnotations: readonly InlineAnnotation[]`
- `headingLevel?: number`

**`EditableBlock`**:

- 段落ブロック: `{ kind: 'paragraph'; id; text; inlineAnnotations; paragraphKind?; headingLevel? }`
- 画像ブロック: `{ kind: 'image'; id; assetKey; alt?; caption?; placement? }`

**`EpubProjectMetadata`** は `title`、`subtitle`、`description`、`language`、`identifier`、`publisher`、`rights`、`date`、`modified`、`creators`、`contributors`、`subjects`、`series`、`collections`、互換用 `author` を持ちます。

---

## `@libraz/mejiro/render` — レンダリングデータ

| エクスポート | シグネチャ |
|---|---|
| `buildParagraphMeasures` | `(entries: RenderEntry[], options: MeasureOptions) => ParagraphMeasure[]` |

ページ分割に使う段落計測値を計算します。

| エクスポート | シグネチャ |
|---|---|
| `buildRenderPage` | `(slices: PageSlice[], entries: RenderEntry[]) => RenderPage` |
| `renderEpubStatic` | `(chapter: { paragraphs: BookParagraph[] }, options?: RenderEpubStaticOptions) => string` |
| `buildLineMetrics` | `(entries: RenderEntry[], options: MeasureOptions) => LineMetricsResult` |
| `packPageLines` | `(metrics: LineMetric[], startIdx: number, pageWidth: number) => number` |
| `buildColumnSlots` | `(metrics: LineMetric[], startIdx: number, count: number, columnHeight: number) => ColumnSlot[]` |
| `adjustExclusionSlots` | `(slots: ColumnSlot[], metrics: LineMetric[], startIdx: number, basePitch: number) => ColumnSlot[]` |
| `getImageXOffset` | `(offsets: Float32Array, spreadStartLine: number, col: number) => number` |
| `findPhysicalColumn` | `(offsets: Float32Array, spreadStartLine: number, fromRight: number, basePitch: number) => number` |

ページスライスとエントリをレンダリング可能なページ構造に変換します。`renderEpubStatic`
は単一 chapter の HTML 文字列を返し、クライアント reader が hydrate する前の
SSR fallback markup として使えます。
metric / slot helpers は、スロットベース表示と画像回り込みレイアウト向けの低レベルユーティリティです。

### CSS

```ts
import '@libraz/mejiro/render/mejiro.css';
import '@libraz/mejiro/render/mejiro-reader.css';
import '@libraz/mejiro/render/mejiro-editor.css';
import '@libraz/mejiro/render/mejiro-print.css';
```

### 型定義

**`RenderEntry`**:

- `chars: string[]`
- `breakPoints: Uint32Array`
- `inlineAnnotations: readonly InlineAnnotation[]`
- `isHeading: boolean`
- `kind?: ParagraphKind`

**`RenderPage`**:

- `paragraphs: RenderParagraph[]`

**`RenderParagraph`**:

- `lines: RenderLine[]`
- `isHeading: boolean`
- `headingLevel?: number`

**`RenderLine`**:

- `segments: RenderSegment[]`

**`RenderSegment`**:

- `{ type: 'text'; text: string }`
- `{ type: 'ruby'; base: string; rubyText: string }`
- `{ type: 'emphasis'; text: string; style: 'sesame' | 'dot' | 'circle' }`
- `{ type: 'tcy'; text: string }`
- `{ type: 'em'; text: string }`
- `{ type: 'strong'; text: string }`
- `{ type: 'link'; text: string; href: string; title?: string }`
- `{ type: 'footnote-ref'; text: string; noteId: string }`

**`MeasureOptions`**:

- `fontSize: number`
- `lineHeight: number`
- `headingScale?: number`（デフォルト: 1.4）
- `paragraphGapEm?: number`（デフォルト: 0.4）
- `headingGapEm?: number`（デフォルト: 1.2）

---

## `@libraz/mejiro/book` — 高レベルAPI

ほとんどのアプリケーションでは、この API から使うのがおすすめです。フォント読み込み、レイアウト、ページ分割、画像回り込みをクラスベースの API でまとめて扱えます。

### 定数

| エクスポート | 説明 |
|---|---|
| `DEFAULT_HEADING_STYLES` | レベル1–4のデフォルト見出しスタイル（`{ 1: { scale: 1.6, gapAfterEm: 1.4 }, ... }`） |
| `DEFAULT_BOOK_OPTIONS` | フォント、行間、禁則、見出しのデフォルト |
| `DEFAULT_PAGE_GEOMETRY` | コンテナ計測前のデフォルトページサイズ/行幅 |
| `DEFAULT_PAGE_PADDING` | デフォルトのページパディング値（px）（`{ x: 52, y: 56, bottom: 40 }`） |

### MejiroBook

**`MejiroBook`** — メインオーケストレータークラス:

- `constructor(options: BookOptions)` — フォント、行間、見出し設定で作成
- `setOptions(options: Partial<BookOptions>): Promise<void>` — オプションを更新し、保持中のレイアウトへ反映。フォントファミリー/サイズ変更時は非同期で再計測し、それ以外の変更は同期的に適用される。
- `setPageSize(size: PageSize): void` — ページジオメトリを設定（`layoutChapter`の前に呼び出す必要あり）
- `computePageSize(container: HTMLElement, options?: ComputePageSizeOptions): { pageWidth, pageHeight, contentHeight }` — コンテナ要素からページサイズを自動計算し`setPageSize`を内部で呼び出す。アスペクト比1.45、最小280×400、最大高さ780、デフォルトpadding、上書き可能なヘッダー/ガター予約を使用。
- `layoutChapter(chapter: { paragraphs: BookParagraph[] }): Promise<ChapterLayout>` — 章をレイアウト（`EpubChapter`と互換）
- `layoutFromSnapshot(snapshot: ChapterLayoutSnapshot): ChapterLayout` — 計測なしでレイアウトスナップショットを復元
- `clearCache(fontKey?: string): void` — 文字幅計測キャッシュをクリア

### ChapterLayout

**`ChapterLayout`** — レイアウト済みの章のページ分割と画像回り込みを管理:

- `totalPages: number` — 総ページ数（getter、遅延計算をトリガー）
- `hasImages: boolean` — 画像回り込みが設定されているか
- `resize(size: Partial<PageSize> & { lineSpacing?: number }): void` — ジオメトリを更新。`lineWidth`変更時は改行を再計算
- `setImages(spreadIndex: number, images: BookImage[]): void` — スプレッドの画像回り込みを設定（空配列で削除）
- `clearImages(): void` — すべての画像回り込みを削除
- `syncImages(spreadIndex: number, images?: BookImage[]): SpreadResult` — スプレッドの画像を設定し、`images` が空/未指定の場合はそのスプレッドの画像を削除して、更新済みスプレッドを返す
- `getSpread(spreadIndex: number): SpreadResult` — 見開きのレイアウトデータを取得
- `getPage(pageIndex: number): PageResult` — 単一ページのレイアウトデータを取得
- `findText(query: string | RegExp, options?: FindTextOptions): SearchMatch[]` — **このメソッドは現在の `ChapterLayout` 1 章分のみを検索範囲とします**（章の `paragraphs` を順に走査し、ヒットを `SearchMatch`（= `AnchorLocation` + `length` 等）で返します）。書籍内の他章や、複数作品にまたがるサイト全体検索を実装する場合は、サーバ側で別の全文検索エンジン（Meilisearch / Elasticsearch / pg_trgm / SQLite FTS5 など）にインデックスを保持し、見つかったアンカーを `MejiroReaderHandle.goToAnchor()` に渡して該当箇所へジャンプさせる構成を推奨します。
- `coordOfAnchor(anchor: InChapterAnchor): AnchorRect | null` — 読書アンカーを見開き/ページ座標へ変換
- `anchorAtCoord(spreadIdx: number, x: number, y: number): InChapterAnchor | null` — 座標をアンカーへ変換
- `selectionRects(range: AnchorRange): AnchorRect[]` — テキスト範囲のハイライト矩形を生成
- `snapshot(): ChapterLayoutSnapshot` — SSR/ビルドキャッシュ向けにレイアウトデータをシリアライズ

### 読書時間

| エクスポート | シグネチャ |
|---|---|
| `estimateReadingTime` | `(chapter: { paragraphs: BookParagraph[] }, options?: ReadingTimeOptions) => number` |
| `formatReadingTime` | `(ms: number, locale?: 'ja' | 'en') => string` |

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
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `headingLevel?: number`
- `kind?: ParagraphKind` — `'body'`（デフォルト）/ `'heading'` / `'blockquote'` / `'sceneBreak'` / `'pre'` / `'figure'`

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
- `hasImages: boolean` — このページに画像回り込みがあるか

**`PageLine`**:

- `segments: RenderSegment[]` — テキストとインライン注釈のセグメント
- `headingLevel?: number` — 見出しレベル（本文はundefined）
- `fontSize: number` — 計算済みフォントサイズ（px、見出しスケール反映済み）

---

## `@libraz/mejiro/image` — 画像ヘルパー

| エクスポート | シグネチャ |
|---|---|
| `prepareImage` | `(file: Blob, options?: PrepareImageOptions) => Promise<PrepareImageResult>` |

ブラウザ画像ファイルをデコードし、必要に応じて縮小・再エンコードして、EPUB埋め込み用のバイナリデータと寸法を返します。

---

## `@libraz/mejiro-react` — Reactコンポーネント

```bash
npm install @libraz/mejiro @libraz/mejiro-react react
npm install -D @types/react
```

peer dependency: `react >= 18`。TypeScript プロジェクトでは、利用する React バージョンに合う `@types/react >= 18` もインストールしてください。

主要コンポーネント: `MejiroReader`、`MejiroEditor`、`MejiroManuscriptEditor`、`MejiroShelf`、`MejiroToc`、`MejiroScrollView`、`MejiroSelectionLayer`、`MejiroPageView`、`MejiroPage`、`MejiroSpread`、`MejiroSettingsPanel`、`MejiroChapterNav`、`MejiroStats`、`MejiroDropZone`、`MejiroImageOverlay`。

hooks: `useEpub`、`useEditableEpub`、`useEpubProject`、`useLibrary`、`useManuscriptDraft`、`useMejiroBook`、`useChapterLayout`、`useSpread`、`useReadingPosition`、`useI18n`、`useImageOverlay`、`useMultiImageOverlay`。

主なヘッドレス編集APIの戻り値:

- `useEditableEpub({ defaultUrl?, onLoad?, onError?, onExport? })` は `editor`、`book`、`previewBook`、`loading`、`exporting`、`error`、`revision`、`history`、`selection`、`selectedParagraph`、`setSelection`、`loadBuffer`、`loadFile`、`loadUrl`、`updateParagraph`、`setInlineAnnotations`、`addImage({ filename, data, ... })`、`undo`、`redo`、`exportEpub(options?)` を返します。
- `useEpub({ defaultUrl?, onLoad?, onError?, fetchOptions?, fetchEpub? })` は `epub`、`loading`、`error`、`loadBuffer`、`loadFile`、`loadUrl`、`setEpub` を返します。
- `useEpubProject({ metadata?, chapters?, debounceMs?, onPreview?, onExport? })` はプロジェクトのメタデータ/章状態に加えて、`setMetadata`、`setChapters`、`setSelectedChapter`、`addChapter`、`removeChapter`、`patchChapter`、`reorderChapters`、`previewBook`、`previewError`、`previewing`、`buildProject`、`exportEpub` を返します。
- `useManuscriptDraft({ initialChapters?, onAutosave?, autosaveDelay? })` は原稿章状態と追加/削除/並べ替え/更新ヘルパーを返します。

**`MejiroPageView`** -- 低レベルページレンダラー。`ChapterLayout`からの`PageResult`をレンダリング。CSS vertical-rlとスロットベースレンダリングを自動切替。

Props:

- `result: PageResult` -- 必須
- `fontFamily?: string` -- CSSフォントファミリー（スロットモード用）
- `lineSpacing?: number` -- 行間倍率（スロットモード用）
- `slotMode?: boolean` -- スロットベースレンダリングを強制（レイアウトに画像がある場合に設定）
- `className?: string`
- `style?: CSSProperties`

**`useImageOverlay(layout, spreadIdx, onUpdate, options?)`** -- ドラッグ/リサイズ可能な画像オーバーレイをテキストリフロー付きで管理するフック。

- `layout: ChapterLayout | null` -- 現在の章レイアウト
- `spreadIdx: number` -- 現在のスプレッドインデックス
- `onUpdate: (spread: SpreadResult) => void` -- リフロー後に呼ばれるコールバック
- `options?: { defaultWidth?, defaultHeight?, defaultX?, defaultY?, margin? }`

戻り値: `{ imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown }`

**`MejiroPage`** -- 低レベル。`RenderPage`をCSS `writing-mode: vertical-rl`でレンダリング。

Props:

- `page: RenderPage` -- 必須
- `className?: string`
- `style?: CSSProperties`

---

## `@libraz/mejiro-vue` — Vueコンポーネント

```bash
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

peer dependency: `vue >= 3.3`。

主要コンポーネントと composables は React パッケージとほぼ同じです。`MejiroReader`、`MejiroEditor`、`MejiroManuscriptEditor`、`MejiroShelf`、`MejiroToc`、`MejiroScrollView`、`MejiroSelectionLayer`、ページ / 見開き / chrome 系コンポーネント、および `useEpub` / `useEditableEpub` / `useEpubProject` / `useLibrary` / `useManuscriptDraft` / `useMejiroBook` / `useChapterLayout` / `useSpread` / `useReadingPosition` / `useI18n` / `useImageOverlay` / `useMultiImageOverlay` を利用できます。

同じコンポーネント群の props 型も公開しています。`MejiroReaderProps`、`MejiroEditorProps`、`MejiroManuscriptEditorProps`、`MejiroPageViewProps`、`MejiroSpreadProps`、`MejiroSettingsPanelProps`、その他の `Mejiro*Props` aliases を利用できます。

Vue composables は React hooks と同じ操作を公開します。リアクティブな状態は `Ref` / `ComputedRef` として返ります。

**`MejiroPageView`** -- 低レベルページレンダラー。`ChapterLayout`からの`PageResult`をレンダリング。CSS vertical-rlとスロットベースレンダリングを自動切替。

Props:

- `result: PageResult` -- 必須
- `fontFamily?: string` -- CSSフォントファミリー（スロットモード用）
- `lineSpacing?: number` -- 行間倍率（スロットモード用）
- `slotMode?: boolean` -- スロットベースレンダリングを強制（レイアウトに画像がある場合に設定）

**`useImageOverlay(layout, spreadIdx, onUpdate, options?)`** -- ドラッグ/リサイズ可能な画像オーバーレイをテキストリフロー付きで管理するコンポーザブル。

- `layout: Ref<ChapterLayout | null>` -- 現在の章レイアウトRef
- `spreadIdx: Ref<number>` -- 現在のスプレッドインデックスRef
- `onUpdate: (spread: SpreadResult) => void` -- リフロー後に呼ばれるコールバック
- `options?: { defaultWidth?, defaultHeight?, defaultX?, defaultY?, margin? }`

戻り値: `{ imageRect: Ref, hasImage: Ref, toggleImage, onOverlayPointerDown, onResizePointerDown }`

**`MejiroPage`** -- 低レベル。`RenderPage`をCSS `writing-mode: vertical-rl`でレンダリング。

Props:

- `page: RenderPage` -- 必須

---

[ドキュメント目次に戻る](./README.md)
