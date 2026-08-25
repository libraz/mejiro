# API リファレンス

> **注意:** このページは `@libraz/mejiro` の各サブパスの全 export と、フレームワークパッケージのコンポーネント・フック・コンポーザブルを扱います。個々のコンポーネントの props は要約にとどめているので、prop 表は [React & Vue](./08-react-and-vue.md) を、正確な型やデフォルト値はパッケージ同梱の TypeScript 型定義を参照してください。

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
| `buildKinsokuRules` | `(raw: { lineStartProhibited: number[]; lineEndProhibited: number[]; unbreakablePairs?: Array<readonly [number, number]> }) => KinsokuRules` |
| `isUnbreakablePair` | `(left: number, right: number, rules?: KinsokuRules) => boolean` |

`buildKinsokuRules` は生のコードポイント配列から、事前計算済みルックアップセットを含む `KinsokuRules` オブジェクトを作成します。`isUnbreakablePair` は隣接する 2 コードポイントの間での改行がペア規則で禁止されているかを判定します（既定は `‥‥`、`……`、`——`、`――`）。

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

ルビテキストの幅を親文字に分配し、クラスタIDを生成します。注釈の付いた範囲は親文字幅とルビ幅の大きい方を確保し、ルビ幅を隣接文字の送り幅に付け替えることはありません。

| エクスポート | シグネチャ |
|---|---|
| `isKana` | `(cp: number) => boolean` |

コードポイントがひらがな（U+3040--U+309F）またはカタカナ（U+30A0--U+30FF）かどうかを判定します。

### 縦中横の前処理

| エクスポート | シグネチャ |
|---|---|
| `buildTcyAnnotations` | `(annotations: readonly InlineAnnotation[] \| undefined, em: number) => TcyAnnotation[] \| undefined` |
| `preprocessTcy` | `(text: Uint32Array, advances: Float32Array, annotations: readonly TcyAnnotation[], existingClusterIds?: Uint32Array) => TcyPreprocessResult` |

`buildTcyAnnotations` は混在したインライン注釈から `tcy` だけを取り出し、それぞれに 1em を割り当てます。これは `text-combine-upright: all` が描画する幅と同じです。`preprocessTcy` はその幅に範囲を畳み、専用のクラスタ ID を与えるので、行分割器は列境界でこの範囲を分割できません。1em は範囲内の各文字に実測 advance の比で按分されるため、アンカー矩形やヒットテストは範囲内でも単調のままです。

縦中横の前処理はルビより**先**に走ります。合成ボックスに掛かるルビが、ボックスに置き換わる前の実測幅ではなく、畳んだあとの幅を基準に超過分を配れるようにするためです。またルビと違い、不正な範囲は拒否ではなくスキップします。空・逆転・範囲外・非整数・advance が非有限・既に適用した範囲と重なる（開始が早いものが勝ち、同点なら長いものが勝つ）ものが対象です。これらは任意の EPUB マークアップ由来なので、1 つ壊れているだけで章全体のレイアウトが止まってはいけないからです。

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

段落の行を固定サイズのページに分配し、ページ境界で分割します。入力が空でも必ず 1 ページ以上を返します。

| エクスポート | シグネチャ |
|---|---|
| `getLineRanges` | `(breakPoints: Uint32Array, charCount: number) => [number, number][]` |

分割点を行ごとの`[start, end)`文字インデックスペアに変換します。

### トークン境界

| エクスポート | シグネチャ |
|---|---|
| `tokenLengthsToBoundaries` | `(tokenLengths: number[]) => Uint32Array` |

形態素解析器のトークン長を`LayoutInput.tokenBoundaries`用の境界インデックスに変換します。

### 組版ヒント

| エクスポート | シグネチャ |
|---|---|
| `deriveTypographyHints` | `(text: string, analysis: TextAnalysis, options?: TypographyHintOptions) => TypographyHints` |

1 段落分の形態素解析結果から改行ヒントを導出します。既定で出力するのは `clusterIds` だけで、それ以外はすべて明示的な指定が必要です。したがって既定の出力が減らす改行候補は、分割すると組版として誤りになる単位を割ってしまう位置に限られます。クラスタ規則が発火する条件は形態素の表層の文字種であり、品詞ではありません。そのため、どの単位を不可分にするかは辞書のバージョンや解析器が変わっても安定します。罰則の規則は品詞を参照してかまいません。辞書がその語を知らなければ、その位置は結局もともと与えられるはずだった値のままになるからです。解析結果の `text` が適用先の段落と一致しない場合は、エラーではなくヒントなしを返します。発火しなかった規則のフィールドは省略されるので、呼び出し側は「ヒントがなければ前処理もしない」という高速パスをそのまま保てます。規則の内容と 2 段階のオプトインは [改行処理](./03-line-breaking.md) を参照してください。

| エクスポート | 値 |
|---|---|
| `DEFAULT_KEEP_WHOLE_POS` | `['ADV', 'CONJ', 'DET', 'INTJ', 'PRON']` |

`deriveTypographyHints()` が既定でまとまりを保つ品詞、すなわち `TypographyHintOptions.keepWholePos` の既定値です。中身は閉じたクラスの自立語で、副詞・接続詞・連体詞・感動詞・代名詞にあたります。既定を置き換えるのではなく広げたい場合は、この配列を展開して使ってください。

| エクスポート | シグネチャ |
|---|---|
| `mergeClusterIds` | `(length: number, a?: Uint32Array, b?: Uint32Array) => Uint32Array \| undefined` |

同一テキスト上の 2 つのクラスタ ID 配列を推移閉包として統合します。組版ヒントを、ルビや縦中横のクラスタと互いの存在を知らないまま共存させられるのはこの関数のためです。返るのは常に新しい配列で、入力そのものを返すことはありません。`length` と長さが合わない入力は別のテキストを指しているとみなし、拒否せず無視します。ヒントを 1 つ落とす代償は改行位置が最適でなくなることだけですが、例外を投げれば段落全体を失うからです。

### テキスト補助

| エクスポート | シグネチャ |
|---|---|
| `formatDialogueLineBreaks` | `(text: string) => string` |
| `tokenizeManuscriptSource` | `(text: string, dialect?: ManuscriptDialect) => ManuscriptToken[]` |

`formatDialogueLineBreaks` は原稿テキスト内の日本語会話括弧の前後に自然な改行を入れ、余分な空行を作らないよう正規化します。

`tokenizeManuscriptSource` は原稿記法 (ルビ / 圏点 / TCY / em / strong / link / footnote) のトークン位置を **source 文字列上**で返します（`parseManuscript` がレンダー後位置を返すのと対照的）。`MejiroNotationHighlighter` の内部実装と同じです。

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

ここにあるのは矩形の演算だけです。DOM に依存しないのでコアに置いています。これを駆動するジェスチャ側の `createOverlayDragSession` は `document` / `requestAnimationFrame` / `setPointerCapture` を触るため、`@libraz/mejiro/browser` から提供されます。

### 永続化

| エクスポート | シグネチャ |
|---|---|
| `serializeReadingPosition` | `(value: ReadingPositionValue) => string` |
| `parseReadingPosition` | `(raw: string \| null) => ReadingPositionValue \| null` |
| `serializeAnnotations` | `(annotations: readonly Annotation[]) => string` |
| `parseAnnotations` | `(raw: string \| null) => Annotation[]` |
| `sortAnnotations` | `(annotations: readonly Annotation[]) => Annotation[]` |
| `createAnnotationId` | `() => string` |

フレームワークの永続化フックが共有する、バージョン付きペイロードのヘルパーです。どちらのパーサもバージョンなしの素のペイロードを受け付け、壊れたデータは弾きます。`parseReadingPosition` は `chapter` / `paragraph` / `charIndex` が非負の安全整数でなければ `null` を返し、`parseAnnotations` は形式不正なエントリを取り除きます。

`useReadingPosition` / `useAnnotations` の `onChange` からサーバへ送る場合は、`serializeReadingPosition` / `serializeAnnotations` が返す文字列を送ってください。次回訪問時に対応するパーサがそのまま受け付けます。

### 国際化

| エクスポート | シグネチャ |
|---|---|
| `enMessages` / `jaMessages` | `MejiroMessages` |
| `messageCatalogs` | `Record<MejiroLocale, MejiroMessages>` |
| `resolveMessages` | `(locale: MejiroLocale \| undefined, overrides: Partial<MejiroMessages> \| undefined, fallback?: MejiroMessages) => MejiroMessages` |
| `formatMessage` | `(template: string, vars: Record<string, string \| number>) => string` |

同梱コンポーネントの UI 文字列カタログです。`resolveMessages` は組み込みカタログに部分的な上書きをマージし、`formatMessage` は `{name}` プレースホルダを置換します。リーダー／エディタのコンポーネントは同じ値を `locale` / `messages` prop から受け取るため、ホスト側が直接呼ぶ場面はほとんどありません。

### テキスト・URL 補助

| エクスポート | シグネチャ |
|---|---|
| `normalizeText` | `(str: string) => string` |
| `sanitizeUrl` | `(raw: string) => string \| null` |

`normalizeText` はレイアウトパイプラインが前提とする NFC 正規化を適用します。`sanitizeUrl` は `href` にしてはいけない URL に対して `null` を返し、描画層はこれを使って安全でないリンクをプレーンテキストに落とします。

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
- `breakPenalties?: Uint8Array` -- コードポイントごとに 1 要素で、そのインデックスの「後ろ」で改行するコスト。`0` は罰則なしで、値が大きいほど避ける。指定すると後方探索は最も近い有効位置ではなく `breakCost.maxBacktrackChars` の範囲内で最小コストの位置を選び、`tokenBoundaries` と空白優先の両方に優先する
- `breakCost?: BreakCostOptions` -- コスト探索の重み。`breakPenalties` がない場合は無視される
- `kinsokuRules?: KinsokuRules` -- カスタム禁則ルール

**`BreakResult`** -- `computeBreaks()`の出力:

- `breakPoints: Uint32Array` -- 各分割前の最後の文字のインデックス
- `hangingAdjustments?: Float32Array` -- 行ごとのぶら下げ突出量（px）
- `lineWidths?: Float32Array` -- 各行で使用された実際の幅（`lineWidths` 入力が指定された場合に存在）
- `effectiveAdvances?: Float32Array` -- ルビ分配後の文字ごとの送り幅

**`BreakCostOptions`** -- 罰則のある改行位置と、そこで改行した場合に残る行の空きを天秤にかける重み。位置 `p` の後ろで改行するコストは `penaltyWeight * breakPenalties[p] + shortfallWeight * shortfall(p)` で、`shortfall(p)` は行が行長に対してどれだけ短く終わるかを em 単位で表した値です。どの位置が選ばれるかに効くのは 2 つの重みの比だけなので、`{ penaltyWeight: 0.5, shortfallWeight: 1 }` と `{ penaltyWeight: 1, shortfallWeight: 2 }` は同じ改行になります:

- `penaltyWeight?: number` -- 罰則値に掛ける係数（既定: `1`）
- `shortfallWeight?: number` -- em 単位の空きに掛ける係数（既定: `1.5`）。この係数が探索の最悪の取引を決める。罰則 `P` の位置を避けて買える空きは最大で `P / shortfallWeight` em であり、`deriveTypographyHints()` が出す罰則の上限は `TypographyHintOptions.keepWholePenalty`（既定 4）なので、既定の係数では最悪の取引が 2.67em に収まる
- `maxBacktrackChars?: number` -- コスト探索があふれた文字から遡れる位置数。上限を設けることで改行処理は文字数に対して線形のままになる（既定: `6`）。`k` 個手前の位置は少なくとも `0.5k` em を捨てるため、配列中の最大の罰則を `P` として、勝てるのは `k < 2 * penaltyWeight * P / shortfallWeight` のあいだだけになる。既定の重みと `deriveTypographyHints()` が出す罰則では `k < 5.33` で、だからこそ 6 で探索は完全に覆われ、窓を広げても結果は変わらず探索時間だけが増える
- `emSize?: number` -- 1em のピクセル値（既定: その段落で実測した最大の送り幅。全角文字を含むテキストではこれが 1em になる）

**`KinsokuMode`** -- `'strict' | 'loose'`

**`KinsokuRules`** -- カスタム禁則ルール:

- `lineStartProhibited: number[]` / `lineEndProhibited: number[]`
- `lineStartProhibitedSet: Set<number>` / `lineEndProhibitedSet: Set<number>`
- `unbreakablePairs: Array<readonly [number, number]>` / `unbreakablePairSet: Set<string>`

**`RubyAnnotation`** -- コアレベルのルビ注釈:

- `startIndex: number` / `endIndex: number` -- 親文字中の範囲
- `rubyText: Uint32Array` / `rubyAdvances: Float32Array`
- `type?: RubyType`
- `jukugoSplitPoints?: number[]`

**`RubyType`** -- `'mono' | 'group' | 'jukugo'`。ルビ範囲の分配方式。

**`RubyPreprocessResult`** -- `preprocessRuby()` の出力: `effectiveAdvances: Float32Array` / `clusterIds: Uint32Array`。

**`TcyAnnotation`** -- コアレベルの縦中横注釈:

- `startIndex: number` / `endIndex: number` -- 親文字中の範囲
- `advance: number` -- 合成ボックスのインライン方向の幅（px）。その範囲を描画するフォントの 1em

**`TcyPreprocessResult`** -- `preprocessTcy()` の出力: `effectiveAdvances: Float32Array` / `clusterIds: Uint32Array`。

**`TypographyHints`** -- `deriveTypographyHints()` の出力。各フィールドは独立しているので、分割不可の単位だけを受け取り罰則は使わない、という選び方ができます:

- `clusterIds?: Uint32Array` -- 分割不可の単位。`LayoutInput.clusterIds` に統合して使う
- `breakPenalties?: Uint8Array` -- 位置ごとの改行罰則。`LayoutInput.breakPenalties` に渡す
- `tokenBoundaries?: Uint32Array` -- 形態素の終端位置。`LayoutInput.tokenBoundaries` 用。要求したときだけ出力される。トークン境界だけを渡すと語の切れ目でしか改行しなくなり、日本語の本文組版はそういう組み方をしないため
- `tcyCandidates?: readonly TcyCandidate[]` -- 縦中横の候補（単独で現れる 2 桁の数字）。実際に適用するかどうかは呼び出し側の判断

**`TypographyHintOptions`** -- `deriveTypographyHints()` が何を出力し、クラスタ規則をどこまで及ばせるか:

- `clusters?: boolean` -- `clusterIds` を出力する（既定: `true`）
- `penalties?: boolean` -- `breakPenalties` を出力する（既定: `false`）
- `tokenBoundaries?: boolean` -- `tokenBoundaries` を出力する（既定: `false`）
- `tcy?: boolean` -- `tcyCandidates` を出力する（既定: `false`）
- `maxHardClusterChars?: number` -- 1 つのクラスタが覆える最大文字数。これを超える単位は分割可能なままにする。行に収まらないクラスタは禁則を無視する強制改行で割られてしまうため（既定: `6`）
- `keepWholePos?: readonly string[]` -- 内部で改行しないよう避ける品詞（既定: `DEFAULT_KEEP_WHOLE_POS`）。コードは形態素の `extendedPos` または `pos` のどちらかと一致すれば適用されるので、`'VERB'` は動詞全体を、`'VERB_連用'` は 1 つの活用形だけを選ぶ。`[]` を渡すと規則を止められ、`DEFAULT_KEEP_WHOLE_POS` を展開すれば既定を広げられる。クラスタ規則と違いこの規則は品詞を参照するが、辞書にない語は結局同じ罰則のままになるため、辞書の欠けが招くのは改善が起きないことだけで、別のレイアウトにはならない
- `keepWholePenalty?: number` -- そうした形態素の内部で改行する位置に与える罰則。形態素内部の通常の罰則 2 の代わりに使われる（既定: `4`）。禁止ではなく優先度であり、コスト探索がその形態素から抜けるために諦める行の空きは最大でも `keepWholePenalty / shortfallWeight` em。全角の本文では目盛りが実質 2 刻みで動く。既定の係数では罰則 1 点で買える空きが 0.67em、全角文字 1 つが 1em なので、置き換える対象の 2 と挙動が変わる最初の値が 4 になる。これより大きく上げる場合は `BreakCostOptions.maxBacktrackChars` も併せて広げないと、探索が勝つはずの位置まで届かない。`maxHardClusterChars` がクラスタに課すような長さの上限は意図的に設けていない。払えない回避はそもそも選ばれないため

**`TcyCandidate`** -- 縦中横として組める範囲: `startIndex: number`（含む）/ `endIndex: number`（含まない）。

**`MorphemeLike`** -- どの解析器が出力したかによらない、レイアウトエンジンが読む形の形態素。オフセットはレイアウトエンジンに渡すのと同じ NFC テキスト上のコードポイント位置です:

- `surface: string` -- 表層形。範囲の再探索ではなく文字種の確認に使う
- `start: number` / `end: number` -- 開始（含む）と終了（含まない）。コードポイント単位
- `pos: string` -- 大分類の品詞コード
- `extendedPos: string` -- 細分類の品詞コード。ヒント規則が主に見るのはこちら

**`AnalyzerIdentity`** -- `{ name: string; version: string }`。キャッシュキーとスナップショット検証のために解析器を識別します。フィールドがすべて一致する 2 つの identity は、出力が互換な解析器を指します。

**`TextAnalysis`** -- テキストに整列済みの、1 段落分の解析結果: `text: string`（オフセットが指す NFC テキストそのもの）/ `morphemes: readonly MorphemeLike[]`（文書順・重なりなし）/ `analyzer: AnalyzerIdentity` / `warnings: readonly string[]`（問題がなければ空）。

**`TextAnalyzer`** -- 段落から `TextAnalysis` を作るインターフェース:

- `identity: AnalyzerIdentity` -- この解析器の識別子。返すすべての解析結果の `analyzer` と一致するので、出所の分からないヒントを解析なしで判別できる
- `analyze(text: string): TextAnalysis` -- NFC テキスト 1 段落を解析する
- `dispose(): void` -- 解析器が保持するネイティブ資源を解放する

実装が同期的なのは設計です。改行処理が同期的に走るため、非同期の初期化は解析器を返すファクトリ側の仕事になります。同梱の実装は後述の `@libraz/mejiro/analysis` にあります。

**`ParagraphMeasure`** -- ページ分割の入力:

- `lineCount: number` / `linePitch: number` / `gapBefore: number`

**`PageSlice`** -- ページ分割の出力:

- `paragraphIndex: number` / `lineStart: number` / `lineEnd: number`

**`ExclusionPageGeometry`** — 除外計算用のページジオメトリ:

- `lineWidth: number` — 基本行幅（px）
- `lineCount: number` — 列数
- `linePitch: number` — 列ピッチ（fontSize × lineHeight）（px）
- `contentWidth: number` — ブロック方向のコンテンツ幅（px）
- `minGapHeight?: number` — テキストに使えるギャップの最小高さ（px）。既定は `linePitch`

**`ImageRect`** — コンテンツ領域座標系での画像矩形:

- `x: number` / `y: number` — コンテンツ領域原点からの位置（px）
- `w: number` / `h: number` — サイズ（px）
- `inlineMargin?: number` — インライン方向（vertical-rl では上下）の余白。両側に適用（px）。既定は `0`
- `blockMargin?: number` — ブロック方向（vertical-rl では左右）の余白。両側に適用（px）。既定は `0`

**`SpreadImageRect`** — `SpreadExclusionEngine` が使う `ImageRect` の別名。`x` は右ページ左上を原点とし、負の `x` は画像を左ページに置く。

**`ImageOverlayRect`** — UIオーバーレイ矩形:

- `x: number` / `y: number` — オーバーレイ位置（px）
- `w: number` / `h: number` — オーバーレイサイズ（px）

オーバーレイ矩形の型はパッケージ family 全体でこの `ImageOverlayRect` 1 つだけです。`@libraz/mejiro-react` と `@libraz/mejiro-vue` はこれを再エクスポートしており、両者の `ImageRect` はその非推奨エイリアスです。上のレイアウト側 `ImageRect` は余白フィールドを持つ別の型です。

**`ColumnSlot`** — 1 行ぶんの描画スロット:

- `xPos: number` — コンテンツ領域右端からのオフセット（px）
- `yStart: number` — コンテンツ上端からの垂直オフセット（px）
- `height: number` — テキストに利用可能な高さ（px）
- `columnIndex?: number` — このスロットが属する物理列（0 = コンテンツ右端に最も近い列）。画像が列を複数のギャップに分割した場合、同じ `columnIndex` を複数のスロットが共有する。本パッケージが生成するスロットには必ず入っており、任意になっているのは手書きのスロット配列を代入可能に保つためだけ

スロットは読み順で出力され、1 つの列が複数のスロットを生む場合も 0 個の場合もある。したがって配列の添字は行の番号であり、列の番号ではない。物理列の識別には `xPos` ではなく `columnIndex` を使う。

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

**`MejiroStorage`** — 永続化フックが受け取るストレージのインターフェース:

- `getItem(key: string): string | null` / `setItem(key: string, value: string): void` / `removeItem(key: string): void`

**`ReadingPositionValue`** — `ReadingAnchor`（`{ chapter, paragraph, charIndex }`）の別名。

**`Annotation`** — 保存されるユーザー注釈:

- `id: string` / `chapter: number`
- `start: InChapterAnchor` / `end: InChapterAnchor`
- `color?: string` / `note?: string` / `createdAt?: number`

**`MejiroLocale`** — `'en' | 'ja'`。**`MejiroMessages`** — UI 文字列カタログの型。

**`FontChoice`** — 設定パネルのフォント選択に使う `{ value: string; label: string }`。

**`EditableSettings`** — `Pick<BookOptions, 'fontFamily' | 'fontSize' | 'lineSpacing' | 'mode' | 'enableHanging'>`。同梱の設定パネルが編集する範囲です。

**`PageHeaderData`** — 柱（ページヘッダ）用の `{ title?: string; pageNumber?: number | null }`。

**`ManuscriptToken` / `ManuscriptTokenKind`** — `tokenizeManuscriptSource()` が返す、ソース位置での記法範囲。

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
| `layoutText` | `(options: { text, fontFamily, fontSize, lineWidth, mode?, enableHanging?, inlineAnnotations?, tokenBoundaries? }) => Promise<BreakResult>` |

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

### オーバーレイのドラッグセッション

| エクスポート | シグネチャ |
|---|---|
| `createOverlayDragSession` | `(options: OverlayDragSessionOptions) => OverlayDragSession` |

画像オーバーレイの移動・リサイズを pointerdown ハンドラから駆動します。document 上で `pointermove` / `pointerup` を購読し、ランタイムが提供する環境では更新をアニメーションフレームにまとめます。各矩形は pointerdown 時点の矩形と累積デルタから毎回作り直すため、ジェスチャ中に丸め誤差が蓄積しません。

コアではなくブラウザ層に置いているのは、ポインタキャプチャと document レベルのリスナを持つから（`document` / `requestAnimationFrame` / `setPointerCapture` を触る）です。処理を委譲している矩形演算（`ImageOverlayRect` に対する `moveImageOverlayRect` / `resizeImageOverlayRect`）は DOM に依存しないので `@libraz/mejiro` に残っています。

**`OverlayDragMode`** — `'move' | 'resize'`。`'move'` は捕捉した矩形を平行移動し、`'resize'` は右下角を起点に拡大・縮小します。

**`OverlayDragSessionOptions`** — `createOverlayDragSession()` の入力:

- `mode: OverlayDragMode` — `rect` に適用するジェスチャ
- `rect: ImageOverlayRect` — pointerdown 時点の矩形。変更されない
- `startX: number` / `startY: number` — pointerdown 時のポインタ位置（クライアント座標、px）
- `pointerId?: number` — ジェスチャを担うポインタ。`captureElement` と併せて指定すると要素がキャプチャするので、ポインタがオーバーレイの外に出てもジェスチャが続く
- `captureElement?: HTMLElement | null` — ポインタをキャプチャする要素。通常は pointerdown の対象
- `activeElement?: HTMLElement | null` — ジェスチャ中に `dragClass` が付く要素。子ハンドルから始めた場合もオーバーレイ自身を指すことが多い
- `dragClass?: string` — ジェスチャ中だけ `activeElement` に付与するクラス
- `minSize?: number` — `'resize'` 時の最小幅・高さ（px、既定 `40`）
- `onChange: (rect: ImageOverlayRect) => void` — 更新ごとに新しい矩形を受け取る
- `onEnd?: () => void` — 終わり方によらず、ジェスチャ終了時にちょうど 1 度呼ばれる
- `registry?: Set<() => void>` — セッションがジェスチャの間だけ自身の破棄関数を登録する Set。アンマウント時に実行中のジェスチャを一括終了できる。ジェスチャが終わるとエントリは自分で外れる

**`OverlayDragSession`** — `createOverlayDragSession()` の戻り値:

- `active: boolean` — ジェスチャが継続中かどうか（読み取り専用）
- `cancel(): void` — ジェスチャを終了し全リスナを解放する。冪等

### 型定義

**`FontFamily`** -- `string | readonly string[]`。CSS にそのまま渡せる文字列（`'"Noto Serif JP", serif'`）か、ファミリー名の配列です。配列は `normalizeFontFamily()` がエスケープして連結します。以下の `fontFamily` オプションはすべてこの型です。

**`MejiroBrowserOptions`**:

- `fixedFontFamily?: FontFamily`
- `fixedFontSize?: number`
- `strictFontCheck?: boolean`

**`LayoutOptions`**:

- `text: string`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `lineWidth: number`
- `mode?: KinsokuMode`
- `enableHanging?: boolean`
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`ChapterLayoutOptions`**:

- `paragraphs: readonly ParagraphInput[]`
- `fontFamily?: FontFamily`
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
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `tokenBoundaries?: Uint32Array | readonly number[]`

**`InlineAnnotation`** — 7 種類のインライン注釈の判別可能な共用体です。どのメンバも NFC コードポイント単位の `startIndex`（含む）と `endIndex`（含まない）を持ち、加えて次のフィールドを持ちます。

| 型 | `kind` | 追加フィールド |
|---|---|---|
| `InlineRubyAnnotation` | `'ruby'` | `rubyText: string`、`type?: RubyType`、`jukugoSplitPoints?: number[]` |
| `InlineEmphasisAnnotation` | `'emphasis'` | `style?: 'sesame' \| 'dot' \| 'circle'` — 傍点の形 |
| `InlineTcyAnnotation` | `'tcy'` | — 縦中横。縦組みの列の中でその範囲だけ横に組み、1em の分割不可クラスタとして行分割器にも届く |
| `InlineEmAnnotation` | `'em'` | — `<em>` として描画される強調 |
| `InlineStrongAnnotation` | `'strong'` | — `<strong>` として描画される強調 |
| `InlineLinkAnnotation` | `'link'` | `href: string`、`title?: string` |
| `InlineFootnoteAnnotation` | `'footnote'` | `noteId: string` |

`RubyInputAnnotation` は `InlineRubyAnnotation` の deprecated エイリアスとして残っています。

**`WidthCacheOptions`** — `WidthCache` の上限:

- `maxFonts?: number` — 保持するフォントキーの最大数
- `maxCodepointsPerFont?: number` — フォントキーごとに保持するコードポイントの最大数

どちらも既定は `Infinity` です。これは「追い出さない」という意味ではなく LRU の記帳自体を切るという意味なので、有限値を設定すると読み取り経路の挙動も変わります。

---

## `@libraz/mejiro/epub` — EPUB解析と生成

| エクスポート | シグネチャ |
|---|---|
| `parseEpub` | `(buffer: ArrayBuffer, options?: EpubParseOptions) => Promise<EpubBook>` |
| `parseEditableEpub` | `(buffer: ArrayBuffer, options?: EpubParseOptions) => Promise<EditableEpub>` |
| `DEFAULT_EPUB_PARSE_LIMITS` | 未信頼アーカイブに適用されるリソース上限の既定値 |
| `EditableEpub` | 段落/画像ブロックを編集して再エクスポートするクラス |
| `exportEditableEpub` | `(book: EditableEpub \| EditableEpubBook, options?: EpubExportOptions) => Promise<ArrayBuffer>` |
| `updateEpubParagraph` | 編集可能EPUB内の段落ブロックを更新 |
| `setEpubInlineAnnotations` | 段落ブロックのインライン注釈を置換 |
| `addEpubChapterImage` | 編集可能章に画像ブロックとアセットを追加。v0.5 の `{ filename, data, ... }` と、非推奨の v0.4 `{ href, mediaType, afterParagraph }` 入力を受け付けます。 |
| `EpubProject` | 原稿章から新規 EPUB 3 パッケージを生成するクラス |
| `parseManuscript` | 原稿テキストを段落とインライン注釈へ変換 |
| `parseManuscriptRuby` | 1つのテキスト片の青空文庫風ルビ記法を解析 |
| `manuscriptToEpubBook` | `(chapters, options?) => EpubBook`。原稿章を `EpubBook` に合成（ZIP 経由なし、ライブプレビュー用） |

EPUBファイルをルビ注釈付きの構造化されたチャプターに解析します。

読み込み系の API はいずれも DOM の XML パーサを必要とします。`parseEpub()` / `parseEditableEpub()` / `EditableEpub.load()` はグローバルの `DOMParser` / `XMLSerializer` / `Node` を要求します。ブラウザには標準で存在しますが、Node で使う場合は DOM 実装を導入し、呼び出し前に `globalThis` へ載せてください。

`EpubParseOptions.limits` は、未信頼入力に適用されるアーカイブのリソース上限（`DEFAULT_EPUB_PARSE_LIMITS`）を上書きします。`maxInputBytes`（100 MiB）、`maxEntries`（10,000）、`maxEntryBytes`（50 MiB）、`maxTotalBytes`（200 MiB）、`maxCompressionRatio`（1,000）です。

| エクスポート | シグネチャ |
|---|---|
| `extractRubyContent` | `(xhtml: string) => AnnotatedParagraph[]` |

XHTMLドキュメント文字列から段落とルビ注釈を抽出します。

| エクスポート | シグネチャ |
|---|---|
| `cloneEditableEpubBook` | `(book: EditableEpubBook) => EditableEpubBook` |
| `clampEditableEpubSelection` | `(book: EditableEpubBook \| null, selection: EditableEpubSelection) => EditableEpubSelection` |

`cloneEditableEpubBook` は編集可能ブックを深くコピーします。プレビュー描画やエクスポート専用の変換（透かし挿入など）がエディタの持つ文書に届かないようにするためです。`clampEditableEpubSelection` は `{ chapter, paragraph }` の選択を、ブックが実際に持つ段落の範囲へ収めます。

### EditableEpub

**`EditableEpub`** — 解析済み EPUB に対する編集セッション（undo 履歴つき）。コンストラクタは private なので `EditableEpub.load()` から作ります。

- `static load(data: ArrayBuffer, options?: EpubParseOptions): Promise<EditableEpub>` — EPUB を解析してセッションを開始する。ホストの DOM グローバルが必要
- `book: EditableEpubBook` — 生きた文書モデル。EPUB を書き戻すのに必要なパッケージデータも含む。直接書き換えると undo 履歴を迂回する
- `title: string` / `author: string | undefined` — パッケージメタデータ（getter）
- `chapters: EditableEpubChapter[]` — スパイン順の章（getter）。コピーではなく実体なので、直接 splice すると undo 履歴を迂回する
- `transaction<T>(fn: () => T): T` — 一連の編集を 1 つの履歴エントリにまとめる。入れ子は最も外側のトランザクションに畳まれ、`fn` 内での throw はバッファした変更を巻き戻す
- `undo(): boolean` / `redo(): boolean` — 直前の変更（またはトランザクション）を取り消す・やり直す。対応するスタックが空なら `false`
- `history: { canUndo: boolean; canRedo: boolean; depth: number; redoDepth: number }` — undo/redo 状態のスナップショット（getter）
- `updateParagraph(chapterIndex: number, paragraphIndex: number, next: Partial<AnnotatedParagraph>): void` — `paragraphIndex` は画像ブロックを除いた段落射影上の位置。`inlineAnnotations` を伴わずに `text` を変えた場合、既存の注釈は新しいテキストへ貼り直され、同じ親文字を覆えるものだけが残り、残りは落ちる
- `setInlineAnnotations(chapterIndex: number, paragraphIndex: number, inlineAnnotations: readonly InlineAnnotation[]): void` — 段落の注釈を差し替える。現在のテキストの外に出るものは落ちる
- `insertParagraph(chapterIndex: number, atIndex: number, paragraph: Omit<EditableParagraphBlock, 'kind' | 'id'>): string` — `atIndex` は `chapter.blocks` 上の位置。末尾に足すなら `chapter.blocks.length`。生成されたブロック ID を返す
- `deleteBlock(chapterIndex: number, blockId: string): void` — 段落／画像ブロックを削除する。他のブロックが参照していない画像アセットも一緒に落ちる
- `splitParagraph(chapterIndex: number, blockId: string, charIndex: number): [string, string]` — コードポイント位置で分割する。切れ目をまたぐ注釈は落ちる。2 つのブロック ID を返す
- `mergeParagraphs(chapterIndex: number, leftId: string, rightId: string): string` — `leftId` は `rightId` の直前でなければならない。残った（左の）ブロック ID を返す
- `moveBlock(chapterIndex: number, blockId: string, toIndex: number): void` — `chapter.blocks` 内でブロックを移動する
- `addImage(chapterIndex: number, image: AddImageInput | EditableEpubImage): string` — 画像アセットと、それを参照する画像ブロックを追加する。生成された `assetKey` を返す
- `removeImage(chapterIndex: number, blockIdOrAssetKey: string): void` — 画像ブロックを削除し、他に参照が無ければアセットも削除する
- `updateImage(chapterIndex: number, blockId: string, patch: Partial<Omit<EditableImageBlock, 'kind' | 'id' | 'assetKey'>>): void` — 代替テキスト・キャプション・配置を更新する
- `setImageCaption(chapterIndex: number, blockId: string, caption: string | undefined): void` — キャプションだけを更新する `updateImage` の短縮形
- `export(options?: EpubExportOptions): Promise<ArrayBuffer>` — 編集済み EPUB を書き出す。入口でブックの状態を同期的に確定するので、アセットのバイト列を待っている間の編集は次回のエクスポートに回り、途中に混ざることはない

### EpubProject

**`EpubProject`** — 原稿章から新しい EPUB 3 パッケージを組み立てます。

- `constructor(options: EpubProjectOptions)` — 既定値を適用したあと `chapters` と `cover` を登録するので、不正な cover href はエクスポート時ではなくここで throw する
- `static fromManuscript(options: EpubProjectOptions): EpubProject` — `new EpubProject(options)` と同じもの。名前付きコンストラクタとして読める綴り
- `metadata: EpubProjectMetadata` — 既定値適用済みのパッケージメタデータ（`language` は `'ja'`、空の `identifier` は新しい `urn:uuid:` 値、`modified` は構築時刻）。そのまま書き換え可能
- `chapters: readonly ProjectChapter[]` — スパイン順の章。挿入時に割り当てられたマニフェスト ID を持つ
- `assets: readonly EpubProjectAsset[]` — 挿入順のマニフェストアセット。ID・href・メディアタイプは解決済み。cover は常に末尾
- `includeTitlePage: boolean` / `includeTitleInFirstChapter: boolean` / `pageProgressionDirection: 'rtl' | 'ltr' | 'default'` / `dialect: ManuscriptDialect` — コンストラクタオプションから確定する
- `stylesheet: string` — `OPS/Styles/style.css` に書き出す CSS。エクスポート前ならいつでも差し替えられる
- `addChapter(chapter: ManuscriptChapterInput): void` — スパイン末尾に追加する。ID は XML で安全なマニフェスト ID に正規化され、衝突時にはサフィックスが付くので、保存される ID は `chapter.id` と異なりうる
- `updateChapter(index: number, patch: Partial<Omit<ManuscriptChapterInput, 'id'>>): void` — 省いたフィールドは元の値を保つ。新しい本文が参照しなくなったインライン画像アセットは落ちる
- `removeChapter(index: number): void` — インデックスで削除する。その章だけが参照していたインライン画像アセットも落ちる
- `reorderChapters(from: number, to: number): void` — 範囲外の `from` は何もせず、`to` は章数へクランプされる。ドラッグ&ドロップの並べ替え UI が日常的に両方を出すため
- `addInlineImage(chapterIndex: number, atParagraphIndex: number, asset: EpubProjectAsset & { alt?: string }): void` — アセットを登録し、章本文に画像参照を埋め込む。エクスポート時に `<figure>` として描画される
- `setCover(asset: EpubProjectAsset): void` — 表紙を登録し、以前のものを置き換える。href は空なら `'OPS/Images/cover.jpg'` になり、他のアセットと同様に検証される
- `addAsset(asset: EpubProjectAsset): EpubProjectAsset` — マニフェストアセットを追加し、保存されたコピーを返す。href は衝突時に `-2` `-3` … のサフィックスで改名されるので、渡した href ではなく返り値の `href` を参照すること。href がアーカイブ内の正しい相対パスでない場合は throw する
- `export(options?: EpubExportOptions): Promise<ArrayBuffer>` — EPUB 3 の ZIP に書き出す。先頭に無圧縮の `mimetype`、続いて container、パッケージ、ナビゲーション文書、スタイルシート、任意のタイトルページ、章ごとの XHTML、最後に各アセット。アセットのバイト列は `EpubProjectAsset.data` から、無ければ `EpubProjectAsset.url` を `options.assetResolver`（未指定ならランタイムの `fetch`）で解決して得る。章が 1 つも無いとき、アセットを解決できないとき、`options.signal` が発火したとき（`AbortError`）に throw する

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

**`EditableBlock`** — `EditableParagraphBlock` と `EditableImageBlock` の共用体:

- **`EditableParagraphBlock`**: `kind: 'paragraph'`、`id: string`、`text: string`、`inlineAnnotations: readonly InlineAnnotation[]`、`paragraphKind?: Exclude<ParagraphKind, 'figure'>`、`headingLevel?: number`
- **`EditableImageBlock`**: `kind: 'image'`、`id: string`、`assetKey: string`、`alt?: string`、`caption?: string`、`placement?: 'inline' | 'fullspread'`

**`EditableEpubChapter`** — 書き戻しに必要なソース情報を持つ章:

- `href: string` — 元の章文書の ZIP パス
- `originalXhtml: string` — 元のマークアップ。未編集の章ではそのまま再利用される
- `isDirty?: boolean` — 解析後に編集されたかどうか
- `blocks: EditableBlock[]` — 文書順の編集可能な内容
- `imageAssets: Map<string, EditableImageAsset>` — `assetKey` を鍵とするアセット
- `paragraphs: AnnotatedParagraph[]` — `blocks` の読み取り専用射影（非推奨）。変更のたびに再生成される
- `paragraphRefs?` / `images?` — v0.4 由来の非推奨フィールド

**`EditableImageAsset`** — 編集可能章に紐づく画像。`assetKey` で 1 つ以上の画像ブロックから引かれます（複数ブロックが同じアセットを共有しうる）:

- `filename: string` — EPUB ZIP 内で優先されるファイル名
- `data?: Uint8Array | ArrayBuffer` — インラインのバイト列、または
- `url?: string` — エクスポート時に `EpubExportOptions.assetResolver` で解決される取得元
- `mediaType?: string` / `href?: string` / `manifestId?: string` / `manifestHref?: string` — エクスポート時に解決される

**`AddImageInput`** — `EditableEpub.addImage()` の v0.5 入力。`AddImageInputBytes`（`data` あり `url` なし）と `AddImageInputUrl`（`url` あり `data` なし）の共用体で、どちらも **`AddImageInputCommon`**（`filename: string`、`mediaType?: string`、`alt?: string`、`caption?: string`、`placement?: 'inline' | 'fullspread'`、`afterBlockId?: string`）を継承します。**`EditableEpubImage`** は非推奨の v0.4 形状（`href`、`mediaType`、`data`、`alt?`、`afterParagraph?`）で、`addImage` は今も受け付けます。

**`EditableEpubSelection`** — `{ chapter: number; paragraph: number }`。エディタ UI が現在対象にしている段落。

**`AssetResolver`** — `(request: AssetResolverRequest) => Promise<Uint8Array | ArrayBuffer> | Uint8Array | ArrayBuffer`。`url` を持ち `data` を持たないアセット 1 件につき 1 度呼ばれます。throw するとエクスポートが中断します。

**`AssetResolverRequest`**:

- `assetKey: string` — 解決対象アセットの識別子。`EditableEpub` 経路では章の `imageAssets` マップのキー、`EpubProject` 経路では ZIP の href
- `asset: AssetResolverAsset` — 解決するアセット
- `url: string` — アセットが宣言した外部 URL（`asset.url` と同じ）
- `signal?: AbortSignal` — エクスポートに渡された `AbortSignal` の写し

**`AssetResolverAsset`** — `EditableImageAsset | EpubProjectAsset`。両方のエクスポート経路が同じリゾルバを共有するためです。リゾルバが通常読むフィールド（`url` / `mediaType` / `data`）は双方に共通なので絞り込みは不要です。名前系のフィールドだけが異なるので、経路を区別したい場合は `'filename' in asset`（`EditableImageAsset`）と `'href' in asset`（`EpubProjectAsset`）で絞り込みます。

**`EpubParseLimits`** — 未信頼アーカイブを開くときのリソース上限。`maxInputBytes`、`maxEntries`、`maxEntryBytes`、`maxTotalBytes`、`maxCompressionRatio`（いずれも必須。既定値は `DEFAULT_EPUB_PARSE_LIMITS`）。

**`ParseManuscriptOptions`** — `parseManuscript()` の `{ dialect?: ManuscriptDialect }`。

**`ManuscriptSourceChapter`** — `manuscriptToEpubBook()` の入力: `id?: string`、`title: string`、`body: string`。**`ManuscriptToEpubBookOptions`**: `dialect?: ManuscriptDialect`、`title?: string`、`author?: string`。

**`EpubProjectOptions`** — `EpubProject` のコンストラクタオプション:

- `metadata: EpubProjectMetadata` — 必須
- `chapters?: ManuscriptChapterInput[]` / `cover?: EpubProjectAsset` — 構築時に `addChapter()` / `setCover()` を通して登録される
- `dialect?: ManuscriptDialect` — 章本文を解析する記法（既定 `'mejiro'`）
- `stylesheet?: string` — 同梱の既定スタイルシートを置き換える
- `pageProgressionDirection?: 'rtl' | 'ltr' | 'default'` — 既定 `'rtl'`
- `includeTitlePage?: boolean` — 既定 `true`
- `includeTitleInFirstChapter?: boolean` — 既定 `false`

**`ManuscriptChapterInput`** — `EpubProject.addChapter()` が受け取る `{ id?: string; title: string; body: string }`。**`ProjectChapter`** はその保存形で、`id` は解決・重複排除済み（3 フィールドとも必須）。

**`EpubProjectAsset`** — 章と一緒にパッケージされるバイナリファイル:

- `href: string` — ZIP パス。アーカイブ内の相対パスであること
- `id?: string` / `mediaType?: string` — 省略時は `href` から導出される
- `data?: Uint8Array | ArrayBuffer` / `url?: string` — インラインのバイト列、またはエクスポート時に取得する取得元
- `properties?: string` — マニフェストの properties。`setCover()` は `'cover-image'` を設定する

**`EpubProjectMetadata`** は `title`、`subtitle`、`description`、`language`、`identifier`、`publisher`、`rights`、`date`、`modified`、`creators`、`contributors`、`subjects`、`series`、`collections`、互換用 `author` を持ちます。**`EpubContributor`** は `{ name: string; role?: string; fileAs?: string }`、**`EpubCollection`** は `{ name: string; type?: 'series' | 'set'; index?: number }` です。

---

## `@libraz/mejiro/render` — レンダリングデータ

| エクスポート | シグネチャ |
|---|---|
| `buildParagraphMeasures` | `(entries: RenderEntry[], options: MeasureOptions) => ParagraphMeasure[]` |

ページ分割に使う段落計測値を計算します。

| エクスポート | シグネチャ |
|---|---|
| `buildRenderPage` | `(slices: PageSlice[], entries: RenderEntry[]) => RenderPage` |
| `renderEpubStatic` | `(chapter: StaticChapter, options?: RenderEpubStaticOptions) => string` |
| `buildLineMetrics` | `(entries: RenderEntry[], options: MeasureOptions) => LineMetricsResult` |
| `packPageLines` | `(metrics: LineMetric[], startIdx: number, pageWidth: number) => number` |
| `buildColumnSlots` | `(metrics: LineMetric[], startIdx: number, count: number, columnHeight: number) => ColumnSlot[]` |
| `adjustExclusionSlots` | `(slots: ColumnSlot[], metrics: LineMetric[], startIdx: number, basePitch: number, contentWidth?: number) => ColumnSlot[]` |
| `getImageXOffset` | `(offsets: Float32Array, spreadStartLine: number, col: number) => number` |
| `findPhysicalColumn` | `(offsets: Float32Array, spreadStartLine: number, fromRight: number, basePitch: number) => number` |
| `paragraphClassName` | `(kind: ParagraphKind \| undefined, headingLevel?: number) => string` |

ページスライスとエントリをレンダリング可能なページ構造に変換します。`renderEpubStatic`
は単一 chapter の HTML 文字列を返し、クライアント reader が hydrate する前の
SSR fallback markup として使えます。
metric / slot helpers は、スロットベース表示と画像回り込みレイアウト向けの低レベルユーティリティです。
`adjustExclusionSlots` は 5 番目の引数にコンテンツ幅を取ります。渡さないと、見出しによって広がった列のスロットがページ端をはみ出すことがあります。
`paragraphClassName` は段落の `kind` と `headingLevel` から、同梱スタイルシートが前提とする `mejiro-paragraph …` のクラス文字列を組み立てます。修飾子名を手で組み立てず、この関数を使ってください。
`StaticChapter` は `renderEpubStatic` が必要とする最小の章の形（`{ paragraphs: readonly BookParagraph[] }`）です。`EpubChapter` でも手で組んだオブジェクトでも満たせます。

### インラインセグメントの描画

| エクスポート | シグネチャ |
|---|---|
| `segmentToInlineNode` | `(segment: RenderSegment) => InlineRenderNode` |
| `buildInlineNodes` | `(chars: readonly string[], annotations: readonly InlineAnnotation[], start?: number, end?: number) => InlineNode[]` |
| `annotationNestingRank` | `(ann: InlineAnnotation) => number` |
| `partiallyOverlaps` | `(a: InlineAnnotation, b: InlineAnnotation) => boolean` |

`segmentToInlineNode` は `RenderSegment` の 8 バリアントすべてを、入れ子の `children` や安全でないリンク URL も含めて `InlineRenderNode` のツリー（`{ type: 'text' }` または `{ type: 'element', tag, className?, href?, title?, children }`）に解決します。サードパーティの描画側は、mejiro の注釈解決ポリシーを再実装せずに再利用できます。

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

`buildInlineNodes` はその 1 段下の層で、文字範囲と注釈から `buildRenderPage()` がセグメントへ変換する `InlineNode` ツリーを組み立てます。

### CSS

```ts
import '@libraz/mejiro/render/mejiro.css';
import '@libraz/mejiro/render/mejiro-reader.css';
import '@libraz/mejiro/render/mejiro-editor.css';
import '@libraz/mejiro/render/mejiro-print.css';
import '@libraz/mejiro/render/mejiro-fonts.css';
```

前の 4 つはページ、リーダー UI、エディタ UI、印刷用のスタイルシートです。`mejiro-fonts.css` は任意で、Google Fonts からデモ用のウェブフォントを読み込み、`--mejiro-font-body` / `--mejiro-font-ui` をそれに差し替えます。フォントを自前でホストする場合や外部リクエストを避けたい場合は読み込まないでください。

### 型定義

**`RenderEntry`**:

- `chars: string[]`
- `breakPoints: Uint32Array`
- `inlineAnnotations: readonly InlineAnnotation[]`
- `headingLevel?: number` — 見出しレベル（1–6）。本文では undefined
- `isHeading?: boolean` — 非推奨。`headingLevel` があるときは無視される
- `kind?: ParagraphKind` — 元段落の構造分類（既定は `'body'`）

**`RenderPage`**:

- `paragraphs: RenderParagraph[]`

**`RenderParagraph`**:

- `lines: RenderLine[]`
- `isHeading: boolean`
- `headingLevel?: number`
- `kind?: ParagraphKind` — 元段落の構造分類。ページコンポーネントが `mejiro-paragraph--*` クラスに変換する

**`RenderLine`**:

- `segments: RenderSegment[]`

**`RenderSegment`** — `text` 以外の各バリアントは、入れ子注釈用に `children?: readonly RenderSegment[]` も受け取ります:

- `{ type: 'text'; text: string }`
- `{ type: 'ruby'; base: string; rubyText: string; children? }`
- `{ type: 'emphasis'; text: string; style: 'sesame' | 'dot' | 'circle'; children? }`
- `{ type: 'tcy'; text: string; children? }`
- `{ type: 'em'; text: string; children? }`
- `{ type: 'strong'; text: string; children? }`
- `{ type: 'link'; text: string; href: string; title?: string; children? }`
- `{ type: 'footnote-ref'; text: string; noteId: string; children? }`

**`InlineRenderNode`** — `segmentToInlineNode()` の出力:

- `{ type: 'text'; text: string }`
- `{ type: 'element'; tag: InlineRenderTag; className?: string; href?: string; title?: string; children: InlineRenderNode[] }`

**`InlineRenderTag`** — `'ruby' | 'rt' | 'span' | 'em' | 'strong' | 'a'`

**`MeasureOptions`**:

- `fontSize: number`
- `lineSpacing?: number` — 行間の倍率
- `lineHeight?: number` — 非推奨。`lineSpacing` の別名
- `headingScale?: number`（デフォルト: 1.4）
- `paragraphGapEm?: number`（デフォルト: 0.4）
- `headingGapEm?: number`（デフォルト: 1.2）
- `headingStyles?: Record<number, HeadingStyle>` — レベル 1–6 ごとの `scale` / `gapAfterEm` 上書き。レイアウトと同じ値を渡さないと、計測と描画で見出しサイズが食い違います

**`HeadingStyle`**:

- `scale?: number` / `gapAfterEm?: number`

---

## `@libraz/mejiro/book` — 高レベルAPI

ほとんどのアプリケーションでは、この API から使うのがおすすめです。フォント読み込み、レイアウト、ページ分割、画像回り込みをクラスベースの API でまとめて扱えます。

### 定数

| エクスポート | 説明 |
|---|---|
| `DEFAULT_HEADING_STYLES` | レベル1–6のデフォルト見出しスタイル（`{ 1: { scale: 1.6, gapAfterEm: 1.4 }, ... 6: { scale: 1.0, gapAfterEm: 0.6 } }`） |
| `DEFAULT_BOOK_OPTIONS` | フォント、行間、禁則、見出しのデフォルト |
| `DEFAULT_PAGE_GEOMETRY` | コンテナ計測前のデフォルトページサイズ/行幅 |
| `DEFAULT_PAGE_PADDING` | デフォルトのページパディング値（px）（`{ x: 52, y: 56, bottom: 40 }`） |

### MejiroBook

**`MejiroBook`** — メインオーケストレータークラス:

- `constructor(options: BookOptions)` — フォント、行間、見出し設定で作成
- `getOptions(): BookOptions` — 現在確定しているオプション
- `setOptions(options: Partial<BookOptions>): Promise<void>` — オプションを更新し、保持中のレイアウトへ反映。`lineSpacing` / `mode` / `enableHanging` は同期的に適用され、返る Promise は解決済み。`fontFamily` / `fontSize` / `headingStyles` / `headingScale` は再計測が必要なため、値はいったん保留され、フォントの読み込みが完了してから `getOptions()` に反映される（各レイアウトは常に自身の config が示すフォントで計測した送り幅を保持する）。呼び出しが重なった場合は最後の 1 つに収束し、フォント読み込み失敗による reject では直前のオプションが維持される
- `setPageSize(size: PageSize): void` — ページジオメトリを設定（`layoutChapter`の前に呼び出す必要あり）
- `computePageSize(container: HTMLElement, options?: ComputePageSizeOptions): { pageWidth, pageHeight, contentHeight }` — コンテナ要素からページサイズを自動計算し`setPageSize`を内部で呼び出す。アスペクト比1.45、最小280×400、最大高さ780、デフォルトpadding、上書き可能なヘッダー/ガター予約を使用。
- `layoutChapter(chapter: { paragraphs: BookParagraph[] }): Promise<ChapterLayout>` — 章をレイアウト（`EpubChapter`と互換）
- `layoutManuscript(options: LayoutManuscriptOptions): Promise<Map<string, ChapterLayout>>` — 原稿の章を EPUB の ZIP を経由せず直接レイアウト。各本文は空行で段落に分割し `parseManuscript()` を通す。返る Map のキーは `chapter.id`（未指定の場合は `chapter-<n>`）
- `layoutFromSnapshot(snapshot: ChapterLayoutSnapshot): ChapterLayout` — 計測なしでレイアウトスナップショットを復元
- `clearCache(fontKey?: string): void` — 文字幅計測キャッシュをクリア
- `cacheStats(): { fonts: number; codepoints: number }` — 現在の計測キャッシュ量。長時間の読書セッションでの使用量監視に使う

### ChapterLayout

**`ChapterLayout`** — レイアウト済みの章のページ分割と画像回り込みを管理:

- `totalPages: number` — 総ページ数（getter、遅延計算をトリガー）
- `hasImages: boolean` — 画像回り込みが設定されているか
- `resize(size: Partial<PageSize> & { lineSpacing?: number }): void` — ジオメトリを更新。`lineWidth`変更時は改行を再計算。更新は一括で適用され、0 以下や非有限の値を渡した場合は `RangeError` を投げてレイアウトを変更しない
- `setImages(spreadIndex: number, images: BookImage[]): void` — スプレッドの画像回り込みを設定（空配列で削除）
- `clearImages(): void` — すべての画像回り込みを削除
- `syncImages(spreadIndex: number, images?: BookImage[]): SpreadResult` — スプレッドの画像を設定し、`images` が空/未指定の場合はそのスプレッドの画像を削除して、更新済みスプレッドを返す
- `getSpread(spreadIndex: number): SpreadResult` — 見開きのレイアウトデータを取得
- `getPage(pageIndex: number): PageResult` — 単一ページのレイアウトデータを取得
- `findText(query: string | RegExp, options?: FindTextOptions): SearchMatch[]` — 文字列は既定でリテラル検索、`options.regex` が `true` のときは正規表現ソースとして扱います。`RegExp` を渡した場合は `options.regex` の値に関わらず正規表現として検索し、その `i` / `m` / `s` フラグを引き継ぎます（`options.caseSensitive` を明示した場合はそちらが優先）。正規表現は安全ガードを通り、破滅的バックトラックを起こしうる形やパターン長・入力長の上限超過では例外を投げます。**このメソッドは現在の `ChapterLayout` 1 章分のみを検索範囲とします**（章の `paragraphs` を順に走査し、ヒットを `SearchMatch`（= `AnchorLocation` + `length` 等）で返します）。書籍内の他章や、複数作品にまたがるサイト全体検索を実装する場合は、サーバ側で別の全文検索エンジン（Meilisearch / Elasticsearch / pg_trgm / SQLite FTS5 など）にインデックスを保持し、見つかったアンカーを `MejiroReaderHandle.goToAnchor()` に渡して該当箇所へジャンプさせる構成を推奨します。
- `locateAnchor(anchor: InChapterAnchor): AnchorLocation | null` — アンカーを含む見開き / ページ / 行を求める。範囲外なら `null`
- `anchorAt(spreadIndex: number, side?: 'right' | 'left'): InChapterAnchor | null` — 見開きのページ先頭文字のアンカー（既定は `'right'`）。見開き番号を、リフロー後も有効な読書位置へ戻すのに使う
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

- `fontFamily: FontFamily` — CSS にそのまま渡せる文字列、またはファミリー名の配列
- `fontSize: number` — 基本フォントサイズ（px）
- `lineSpacing?: number` — 行間倍率（デフォルト: 1.8）
- `mode?: 'strict' | 'loose'` — 禁則モード（デフォルト: `'strict'`）
- `enableHanging?: boolean` — ぶら下げ組み（デフォルト: `true`）
- `headingStyles?: Record<number, HeadingStyle>` — レベル別見出しスタイル
- `headingScale?: number` — デフォルトの見出しスケール（デフォルト: 1.4）
- `analyzer?: TextAnalyzer` — 改行ヒントの導出に使う形態素解析器。`wordAwareBreaking` がヒントを要求したときだけ、レイアウト時に段落ごとに 1 回呼ばれる。再改行（リサイズ、フォント変更、画像回り込みの再計算）では最初の解析結果をそのまま再利用する。参照されるのは章をレイアウトする時点で、`setOptions()` からは変更できない
- `wordAwareBreaking?: 'off' | 'clusters' | 'full'` — 解析結果を改行処理にどこまで及ばせるか（デフォルト: `'off'`）。`'clusters'` は、分割すると組版として誤りになる単位を割る位置を除けば、改行位置を文字種規則のままに保つ。`'full'` は位置ごとの罰則を加えるため、改行位置そのものが変わる
- `keepWholePos?: readonly string[]` — 内部で改行しないよう避ける品詞。`deriveTypographyHints()` の `TypographyHintOptions.keepWholePos` にそのまま渡される（デフォルト: `DEFAULT_KEEP_WHOLE_POS`）。参照されるのは罰則を出す唯一の段階である `'full'` のときだけ
- `keepWholePenalty?: number` — `keepWholePos` に該当する形態素の内部で改行する場合の値段。`deriveTypographyHints()` の `TypographyHintOptions.keepWholePenalty` にそのまま渡される（デフォルト: `4`）
- `breakCost?: BreakCostOptions` — コスト探索の重み。改行処理へそのまま渡され、罰則が働いていない場合は無視される

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
- `hints?: TypographyHints` — この段落だけの計算済みヒント。指定するとブック側の `analyzer` は使われない。オフセットは `text` の NFC 形上のコードポイント位置

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

**`MejiroBookOptions`** — `MejiroBook` のコンストラクタオプション。`BookOptions` に `strictFontCheck?: boolean` を加えたもので、この値は構築時に確定し後から変更できません。

**`ChapterLike`** — `{ paragraphs: readonly BookParagraph[] }`。`estimateReadingTime()` が必要とする最小の章の形。

**`ManuscriptChapter`** — `MejiroBook.layoutManuscript()` に渡す 1 章分: `id?: string`（返り値のマップのキー）、`title: string`（レイアウト先頭に `h1` 段落として出力される）、`body: string`（生の原稿。空行が段落区切り）。

**`InChapterAnchor` / `ReadingAnchor`** — リフローに強い読書位置。`InChapterAnchor` は `{ paragraph, charIndex }`、`ReadingAnchor` はそれに `chapter: number` を加えた本全体での位置です。`AnchorLocation` / `AnchorRect` / `AnchorRange` / `SearchMatch` は、これらから組み立てるレイアウト側の結果型です。

この subpath は `RubyInputAnnotation`（`InlineRubyAnnotation` の非推奨エイリアス）も再エクスポートします。`mejiro/book` だけを使う利用者が `mejiro/browser` を参照せずに済むようにするためです。

**`ChapterLayoutSnapshot`** — `ChapterLayout.snapshot()` が返し `MejiroBook.layoutFromSnapshot()` が受け取る直列化済みレイアウト。構成要素もエクスポートされているので、ホスト側で保存できます。

- **`ChapterLayoutSnapshotConfig`** — レイアウト設定の直列化可能な部分集合: `fontSize`、`lineSpacing`、`headingScale`、`mode`、`enableHanging`、`headingStyles?`
- **`ParagraphSnapshot`** — 段落ごとのエントリ: `text`、`advances: number[]`、`breakPoints: number[]`、`inlineAnnotations`、`isHeading?`、`headingLevel?`、`kind?`、`layoutRubyAnnotations?`、`layoutTcyAnnotations?`
- **`LayoutRubySnapshot`** — `RubyAnnotation` の TypedArray を素の `number[]` に広げた形。`JSON.stringify` を通せるようにするため
- **`SpreadImagesSnapshot`** — `{ spreadIndex: number; images: BookImage[] }`。1 つの見開きの画像回り込み

---

## `@libraz/mejiro/image` — 画像ヘルパー

| エクスポート | シグネチャ |
|---|---|
| `prepareImage` | `(file: Blob \| File, options?: PrepareImageOptions) => Promise<PrepareImageResult>` |

ブラウザ画像ファイルをデコードし、必要に応じて縮小・再エンコードして、EPUB埋め込み用のバイナリデータと寸法を返します。`createImageBitmap` / `OffscreenCanvas` / `HTMLCanvasElement` を使うためブラウザ専用です。

**`PrepareImageOptions`** — 全フィールドが任意なので `prepareImage(file)` だけでも安全です:

- `maxBytes?: number` — 再エンコード後の目標サイズ（既定 2 MiB）。超えている間は JPEG/WebP の品質を `0.4` まで下げ続け、それでも収まらなければ警告を出す
- `maxWidth?: number` / `maxHeight?: number` — 縮小後のピクセル上限（各既定 `2048`）
- `convertTo?: 'auto' | 'webp' | 'jpeg' | 'png'` — 出力形式（既定 `'auto'`）。`'auto'` は JPEG / PNG / WebP の入力形式を保ち、GIF は `image/png` に再エンコードし（アニメーションは平坦化）、それ以外（AVIF など）は `image/jpeg` にフォールバックする。指定は保証ではなく、その形式をエンコードできない環境では黙って別の形式になる
- `quality?: number` — JPEG/WebP の初期品質（既定 `0.85`）

**`PrepareImageResult`**:

- `data: Uint8Array` — 再エンコード済みのバイト列。そのまま EPUB に入れられる
- `mediaType: string` — `data` の MIME タイプ。要求した形式ではなくエンコーダが実際に出力した形式
- `width: number` / `height: number` — 縮小後のデコード済みピクセルサイズ
- `warnings: string[]` — 縮小・品質低下・形式フォールバックの診断メッセージ

---

## `@libraz/mejiro/analysis` — 形態素解析

`deriveTypographyHints()` や `BookOptions.analyzer` に渡す `TextAnalyzer` を提供します。サブパス自体は常に存在しますが、ここで作る解析器が使う `@libraz/suzume` は optional peer dependency です。解析による改行を使う場合だけインストールしてください。

```bash
npm install @libraz/suzume
```

パッケージ内の他の場所はこれを import しません。インストールしなければ改行は文字種規則だけで動き、他のサブパスの挙動は一切変わりません。

| エクスポート | シグネチャ |
|---|---|
| `createSuzumeAnalyzer` | `(options?: SuzumeAnalyzerOptions) => Promise<TextAnalyzer>` |

suzume の WebAssembly トークナイザを使う解析器を作ります。WebAssembly モジュールと辞書の読み込みはここで 1 回だけ行います。`TextAnalyzer.analyze()` は同期的であり、非同期の処理はすべて解析器が存在する前に済ませておく必要があるからです。`@libraz/suzume` が未インストールの場合やモジュールの読み込みに失敗した場合、返る Promise は reject します。このファクトリを呼ぶこと自体がその解析器を明示的に要求する行為なので、文字種規則だけの改行に落としたい呼び出し側は reject を捕まえて自分でそうします。使い終えたら dispose してください。`instance` で渡した既存インスタンスは、その寿命が渡した側のものなので破棄されません。

**`SuzumeAnalyzerOptions`**:

- `instance?: unknown` — 新規作成の代わりに引き取る、作成済みの Suzume インスタンス
- `wasmPath?: string` — WebAssembly バイナリの位置の上書き。インスタンス生成にそのまま渡される

| エクスポート | シグネチャ |
|---|---|
| `alignMorphemeOffsets` | `(text: string, normalizedText: string, morphemes: readonly MorphemeLike[]) => { morphemes: MorphemeLike[]; warnings: string[] } \| null` |

解析器の正規化済みテキスト上のオフセットを、レイアウトエンジンが実際に改行するテキストへ写します。解析器は自前の正規化器が作った文字列を基準に添字を振りますが、その正規化器は入力を短くすることしかしません。したがって写像は恒等（通常の文章が通る高速パス）か、単調な 1 回の走査のどちらかになります。結果は全体が成功するか、まったく成功しないかのどちらかです。中途半端に写すとヒントが別の文字に付いてしまうため、その場合は `null` を返します。写した範囲がテキストの外に出るもの、自身の表層形を再現できないものは捨てられ、`warnings` に記録されます。独自の解析器を `TextAnalyzer` に適合させるときに使います。

このサブパスは `AnalyzerIdentity` / `MorphemeLike` / `TextAnalysis` / `TextAnalyzer` も再エクスポートします。解析器を実装するためにコアのサブパスを参照せずに済むようにするためです。

```ts
import { MejiroBook } from '@libraz/mejiro/book';
import { createSuzumeAnalyzer } from '@libraz/mejiro/analysis';

const analyzer = await createSuzumeAnalyzer();
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  analyzer,
  wordAwareBreaking: 'clusters',
});
```

---

## `@libraz/mejiro-react` — Reactコンポーネント

```bash
npm install @libraz/mejiro @libraz/mejiro-react react
npm install -D @types/react
```

peer dependency: `react >= 18`。TypeScript プロジェクトでは、利用する React バージョンに合う `@types/react >= 18` もインストールしてください。

### コンポーネント

各コンポーネントは対応する props 型をエクスポートします。`MejiroSettingsPanel` はフォームが編集する値の型も公開します。

| コンポーネント | props 型 | 用途 |
|---|---|---|
| `MejiroReader` | `MejiroReaderProps` | chrome・ナビゲーション・設定・永続化まで含む完成形リーダー |
| `MejiroEditor` | `MejiroEditorProps` | `EditableEpub` に対するブロックエディタ。`MejiroExportPolicy` を伴う |
| `MejiroManuscriptEditor` | `MejiroManuscriptEditorProps` | ライブプレビュー付きの原稿執筆画面 |
| `MejiroNotationHighlighter` | `MejiroNotationHighlighterProps` | 記法トークンを着色する textarea |
| `MejiroShelf` | `MejiroShelfProps` | 複数巻の本棚。`useLibrary` と組み合わせる |
| `MejiroToc` | `MejiroTocProps` | 目次 |
| `MejiroScrollView` | `MejiroScrollViewProps` | 連続スクロール表示 |
| `MejiroSelectionLayer` | `MejiroSelectionLayerProps` | 選択・ハイライトのオーバーレイ |
| `MejiroPageView` | `MejiroPageViewProps` | `PageResult` を 1 ページ描画 |
| `MejiroPage` | `MejiroPageProps` | `RenderPage` を 1 ページ描画 |
| `MejiroSpread` | `MejiroSpreadProps` | 見開き。柱は `PageHeaderData` を使う |
| `MejiroSettingsPanel` | `MejiroSettingsPanelProps` | `EditableSettings` と `FontChoice` を編集するフォント / サイズ / 禁則フォーム |
| `MejiroChapterNav` | `MejiroChapterNavProps` | 章セレクタ。`MejiroChapterNavVariant` は `'select' \| 'panel'` |
| `MejiroStats` | `MejiroStatsProps` | レイアウト統計行 |
| `MejiroPageIndicator` | `MejiroPageIndicatorProps` | 「現在 / 総数」の見開き位置表示 |
| `MejiroDropZone` | `MejiroDropZoneProps` | EPUB のドロップ領域 / ファイル選択 |
| `MejiroImageOverlay` | `MejiroImageOverlayProps` | ドラッグ・リサイズ可能な画像プレースホルダ |
| `MejiroI18nProvider` | — | 配下にメッセージカタログを供給する |

### hooks

| hook | オプション / 戻り値の型 | その他のエクスポート型 |
|---|---|---|
| `useEpub` | `UseEpubOptions` / `UseEpubReturn` | — |
| `useEditableEpub` | `UseEditableEpubOptions` / `UseEditableEpubReturn` | `EditableEpubSelection` |
| `useEpubProject` | `UseEpubProjectOptions` / `UseEpubProjectReturn` | `EpubProjectChapterDraft` |
| `useLibrary` | `UseLibraryOptions` / `UseLibraryReturn` | `VolumeInfo` |
| `useManuscriptDraft` | `UseManuscriptDraftOptions` / `UseManuscriptDraftReturn` | — |
| `useManuscriptLayout` | `UseManuscriptLayoutOptions` / `UseManuscriptLayoutReturn` | `ManuscriptPageDimensions`、`ManuscriptRecomputeOptions` |
| `useAnnotations` | `UseAnnotationsOptions` / `UseAnnotationsReturn` | `Annotation`、`AnnotationsStorage` |
| `useMejiroBook` | `UseMejiroBookOptions` / `UseMejiroBookReturn` | — |
| `useChapterLayout` | `UseChapterLayoutOptions` / `UseChapterLayoutReturn` | `PageDimensions`、`RecomputeOptions` |
| `useSpread` | `UseSpreadOptions` / `UseSpreadReturn` | — |
| `useReadingPosition` | `UseReadingPositionOptions` / `UseReadingPositionReturn` | `ReadingPositionStorage`、`ReadingPositionValue` |
| `useI18n` | `UseI18nOptions` | `MejiroLocale`、`MejiroMessages`、および `enMessages` / `jaMessages` / `resolveMessages` / `format` |
| `useImageOverlay` | `UseImageOverlayOptions` / `UseImageOverlayReturn` | `ImageOverlayRect`（およびその非推奨エイリアス `ImageRect`） |
| `useMultiImageOverlay` | `UseMultiImageOverlayOptions` / `UseMultiImageOverlayReturn` | `MultiImageItem` |

`format(template, vars)` は `{name}` プレースホルダを置換します（コアの `formatMessage` と同じ契約）。`AnnotationsStorage` と `ReadingPositionStorage` はどちらもコアの `MejiroStorage` の別名です。`PageDimensions` と `ManuscriptPageDimensions` はどちらも `{ pageWidth, pageHeight, contentHeight }`、`RecomputeOptions` と `ManuscriptRecomputeOptions` はどちらも `{ blank?: boolean }` です。`VolumeInfo` は `{ id, label, author?, cover?, meta? }`、`EpubProjectChapterDraft` と `ManuscriptEditorChapter` はどちらも `{ id, title, body }`、`MultiImageItem` は `{ id, rect }` です。

### MejiroReader の型

- **`MejiroReaderProps`** — 4 つのソースモードの判別可能な共用体なので、TypeScript が複数のソースの同時指定を拒否します。`MejiroReaderControlledProps`（`epub: EpubBook | null`）、`MejiroReaderUrlProps`（`epubUrl: string`）、`MejiroReaderFileProps`（ソース指定なし。リーダー自身がドロップ領域 / ファイル選択を出す）、`MejiroReaderManuscriptProps`（`manuscript: readonly ManuscriptChapter[]`、`dialect?: ManuscriptDialect`）の 4 つで、いずれも **`MejiroReaderCommonProps`** を継承し、残りの prop はそちらが持ちます。
- **`MejiroReaderHandle`** — `ref` から取れる命令的ハンドル: `goToSpread`、`next`、`prev`、`goToChapter`、`getReadingPosition(): ReadingPosition`、`goToAnchor(): Promise<void>`、`getAnchor()`、`getVisibleRange()`、`setOptions(): Promise<void>`、`subscribe()`。
- **`MejiroReaderEventMap`** — `subscribe` のペイロード: `spreadChanged({ chapter, spreadIdx })`、`turnStart({ from })`、`turnEnd({ to })`、`chapterFinished({ chapter })`。
- **`ReadingPosition`** — `getReadingPosition()` が返す `{ chapter, spreadIdx, totalPages, totalSpreads }`。
- **`MejiroReaderSettingsSlot`** — `renderSettings` render prop に渡る文脈: `{ settings: EditableSettings; update; open; toggle }`。
- **`MejiroTheme`** — `MejiroThemeName`、またはプリセットの上に CSS 変数を重ねる `{ name, override }`。**`MejiroThemeName`** は `'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto'`。
- **`MejiroReaderMode`** — `'paginated' | 'scroll'`。**`MejiroSpreadMode`** — `'double' | 'single' | 'auto'`。**`MejiroReaderFit`** — `'fill' | 'width'`。**`PageNumberDisplay`** — `'both' | 'right' | 'left' | 'none'`。**`MejiroChapterNavMode`** — `'select' | 'panel' | 'both' | 'none'`。

### MejiroManuscriptEditor の型

- **`ManuscriptEditorChapter`** — `{ id, title, body }`。草稿の 1 章。
- **`ManuscriptAutosaveDraft`** — 自動保存のペイロード: `{ title, author, cover: File | null, chapters }`。
- **`ManuscriptPreviewProps`** — ライブプレビューへ転送される `MejiroReader` props の部分集合。エディタ自身が制御する項目（`manuscript`、`fonts`、`chapter`、`onChapterChange`）を渡しても無視されます。

### MejiroEditor の型

- **`MejiroExportPolicy`** — エクスポート処理への宣言的な制約。`watermark`（編集中の文書ではなくエクスポート専用コピーに適用）→ `encrypt`（バッファを差し替える）→ `allowDownload`（`false` ならブラウザのダウンロードを行わない）の順に適用されます。

主なヘッドレス編集APIの戻り値:

- `useEditableEpub({ defaultUrl?, onLoad?, onError?, onExport? })` は `editor`、`book`、`previewBook`、`loading`、`exporting`、`error`、`revision`、`history`、`selection`、`selectedParagraph`、`setSelection`、`loadBuffer`、`loadFile`、`loadUrl`、`updateParagraph`、`setInlineAnnotations`、`addImage({ filename, data, ... })`、`undo`、`redo`、`exportEpub(options?)` を返します。
- `useEpub({ defaultUrl?, onLoad?, onError?, fetchOptions?, fetchEpub? })` は `epub`、`loading`、`error`、`loadBuffer`、`loadFile`、`loadUrl`、`setEpub` を返します。
- `useEpubProject({ metadata?, chapters?, cover?, assets?, debounceMs?, onPreview?, onExport? })` は `metadata`、`chapters`、`selectedChapter`、`currentChapter`、`cover`、`assets`、`previewBook`、`previewError`、`previewing` と、`setMetadata`、`setChapters`、`setSelectedChapter`、`setCover`、`setAssets`、`addChapter`、`removeChapter`、`patchChapter`、`reorderChapters`、`buildProject`、`exportEpub` を返します。`currentChapter` は選択中の草稿（無ければ `null`）です。`setCover(null)` で表紙を外せ、表紙・アセットの変更はデバウンスされたプレビューと `exportEpub` の双方に反映されます。
- `useManuscriptDraft({ initialChapters?, onAutosave?, autosaveDelay? })` は原稿章状態と追加/削除/並べ替え/更新ヘルパーを返します。
- `useManuscriptLayout(book, chapter, surfaceRef, { dialect?, enableResize?, resizeDebounce? })` は単一の原稿章を直接レイアウトする hook。`{ layout, pageWidth, pageHeight, contentHeight, elapsedMs, recompute }` を返します（`useChapterLayout` と同形）。EPUB を経由しないライブプレビュー用。
- `useAnnotations({ key, storage?, throttleMs?, onChange? })` はハイライト / しおり / コメントを永続化する hook。`{ annotations, add, remove, update, clear }` を返します。`storage` は `useReadingPosition` と同じ interface (`getItem` / `setItem` / `removeItem`)。`onChange(next)` は `add` / `remove` / `update` / `clear` の直後に同期的に発火（初回ハイドレートと no-op 時は呼ばれません）。サーバ同期のフックポイントに使えます。
- `useReadingPosition({ key, storage?, throttleMs?, onChange? })` の `onChange(next | null)` も同様に `save` / `clear` 直後に発火。

**`MejiroReader` の `manuscript` source** -- `epub` / `epubUrl` に加えて第 4 のソースモードとして、`manuscript: ManuscriptChapter[]` と `dialect?: ManuscriptDialect` を渡せば EPUB ZIP を経由せず原稿を直接プレビューできます。

**`MejiroReader` の表示系 props** -- `theme?: MejiroTheme`（リーダー root の `data-mejiro-theme` に反映され、同梱 CSS がパレットを切り替えます）、`mode?: MejiroReaderMode`（既定の `'paginated'` / 章の全ページを縦スクローラに積む `'scroll'`）、`spreadMode?: MejiroSpreadMode`（既定の `'double'` / `'single'` / `'auto'`）、`fit?: MejiroReaderFit`（既定の `'fill'` / `'width'`）、`pageNumbers?: PageNumberDisplay`、UI 文字列用の `locale?: MejiroLocale` と `messages?: Partial<MejiroMessages>`、設定パネルの中身を差し替える `renderSettings?: (slot: MejiroReaderSettingsSlot) => ReactNode` があります。

**`MejiroReader` の `annotations` prop** -- `{ chapter, start, end, color? }` の配列を渡すと、現在の章のものが自動でハイライト rect に変換されて見開きに描画されます。`useAnnotations` と組み合わせるのが基本ですが、自前で配列を組み立てても問題ありません。

**`MejiroNotationHighlighter`** -- 原稿記法 (ルビ / 圏点 / 縦中横 / em / strong / link / footnote) を textarea 背後のオーバーレイで色分け表示するコンポーネント。`{ value, onChange, dialect?, wrapperClassName?, ... }` を受け取り、textarea プロパティはそのまま透過します。色は `.mejiro-notation-token[data-token="ruby"]` などの CSS で上書き可能。

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

段落のクラスは共有ヘルパ `paragraphClassName(kind, headingLevel)` が生成します（非推奨の `isHeading` しか無い場合は `'heading'` にフォールバック）。そのため blockquote / sceneBreak / pre / figure の段落にも、静的レンダラと同じ `mejiro-paragraph--*` 修飾子が付きます。

---

## `@libraz/mejiro-vue` — Vueコンポーネント

```bash
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

peer dependency: `vue >= 3.3`。

### コンポーネントと props 型

コンポーネントの構成は React パッケージと同じです。各コンポーネントは `InstanceType<typeof Component>['$props']` として宣言した props エイリアスをエクスポートします。コンポーネント自身の `props` ブロックに常に追随するため、`default` を持つ項目は実行時の既定が `undefined` であっても型上は任意になります。

| コンポーネント | props エイリアス |
|---|---|
| `MejiroReader` | `MejiroReaderProps` |
| `MejiroEditor` | `MejiroEditorProps` |
| `MejiroManuscriptEditor` | `MejiroManuscriptEditorProps` |
| `MejiroNotationHighlighter` | `MejiroNotationHighlighterProps` |
| `MejiroShelf` | `MejiroShelfProps` |
| `MejiroToc` | `MejiroTocProps` |
| `MejiroScrollView` | `MejiroScrollViewProps` |
| `MejiroSelectionLayer` | `MejiroSelectionLayerProps` |
| `MejiroPageView` | `MejiroPageViewProps` |
| `MejiroPage` | `MejiroPageProps` |
| `MejiroSpread` | `MejiroSpreadProps` |
| `MejiroSettingsPanel` | `MejiroSettingsPanelProps` |
| `MejiroChapterNav` | `MejiroChapterNavProps` |
| `MejiroStats` | `MejiroStatsProps` |
| `MejiroPageIndicator` | `MejiroPageIndicatorProps` |
| `MejiroDropZone` | `MejiroDropZoneProps` |
| `MejiroImageOverlay` | `MejiroImageOverlayProps` |
| `MejiroManuscriptEditor`（プレビュー転送分） | `ManuscriptPreviewProps` |

`MejiroI18nProvider` もコンポーネントで、React 版と同じく `locale` / `messages` を受け取ります。

React と違い `MejiroReaderProps` は判別可能な共用体ではなく単一のオブジェクト型なので、ソース系の prop は型の上では排他になりません。実行時は `epub` が `epubUrl` に優先し、`manuscript` はどちらとも併用できません。`MejiroReaderCommonProps` / `MejiroReaderControlledProps` / `MejiroReaderUrlProps` / `MejiroReaderFileProps` / `MejiroReaderManuscriptProps` は React パッケージにのみ存在します。

### composables

Vue の composables は React hooks と同じ操作を公開し、オプション / 戻り値の型名も共通です。`useEpub`（`UseEpubOptions` / `UseEpubReturn`）、`useEditableEpub`（`UseEditableEpubOptions` / `UseEditableEpubReturn`、`EditableEpubSelection`）、`useEpubProject`（`UseEpubProjectOptions` / `UseEpubProjectReturn`、`EpubProjectChapterDraft`）、`useLibrary`（`UseLibraryOptions` / `UseLibraryReturn`、`VolumeInfo`）、`useManuscriptDraft`（`UseManuscriptDraftOptions` / `UseManuscriptDraftReturn`）、`useManuscriptLayout`（`UseManuscriptLayoutOptions` / `UseManuscriptLayoutReturn`、`ManuscriptPageDimensions`、`ManuscriptRecomputeOptions`）、`useAnnotations`（`UseAnnotationsOptions` / `UseAnnotationsReturn`、`Annotation`、`AnnotationsStorage`）、`useMejiroBook`（`UseMejiroBookOptions` / `UseMejiroBookReturn`）、`useChapterLayout`（`UseChapterLayoutOptions` / `UseChapterLayoutReturn`、`PageDimensions`、`RecomputeOptions`）、`useSpread`（`UseSpreadOptions` / `UseSpreadReturn`）、`useReadingPosition`（`UseReadingPositionOptions` / `UseReadingPositionReturn`、`ReadingPositionStorage`）、`useI18n`（`UseI18nOptions`、および `enMessages` / `jaMessages` / `resolveMessages` / `format`）、`useImageOverlay`（`UseImageOverlayOptions` / `UseImageOverlayReturn`）、`useMultiImageOverlay`（`UseMultiImageOverlayOptions` / `UseMultiImageOverlayReturn`、`MultiImageItem`）です。

リアクティブな状態は `Ref` / `ComputedRef` として返り、レイアウトや添字を受け取る composable は素の値ではなく ref を受け取ります。

### `MejiroReader` の表示系 props

React と同じ一式を Vue の props として宣言しています。

- `theme?: MejiroTheme`（既定 `'light'`）— リーダーのルートに `data-mejiro-theme` として反映され、同梱 CSS がこれを読んでパレットを切り替える。`MejiroThemeName` は `'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto'`。オブジェクト形 `{ name, override }` はプリセットの上に CSS 変数を重ねる
- `mode?: MejiroReaderMode`（既定 `'paginated'`）— `'scroll'` は章の全ページを縦スクロールに積む
- `spreadMode?: MejiroSpreadMode`（既定 `'double'`）— `'single'` は右ページのみ、`'auto'` は縦長ビューポートで single に切り替える（`ResizeObserver` で監視）
- `fit?: MejiroReaderFit`（既定 `'fill'`）— `'width'` は幅とページ比から自身の高さを決め、確保していた `gutterOffset` / `headerOffset` の既定を 0 にして見開きを端まで広げる
- `pageNumbers?: PageNumberDisplay`（既定 `'both'`）— 見開きのどちら側の柱にノンブルを出すか。「n / 総数」の表示は独立
- `chapterNavMode?: MejiroChapterNavMode`（既定 `'select'`）— 組み込みの章ナビゲーションをどこに出すか
- `locale?: MejiroLocale` と `messages?: Partial<MejiroMessages>` — UI 文字列
- `title` / `subtitle` — ヘッダのロゴ文言
- `bare?: boolean`（既定 `false`）— `enableHeader` / `enableChapterNav` / `enableSettings` / `enableStats` / `enablePageIndicator` の既定を `false` に反転する。明示的に渡した `enable*` が優先される
- `enableHeader` / `enableChapterNav` / `enableSettings` / `enableStats` / `enablePageIndicator`（既定 `!bare`）、`enableDropZone` / `enableImageOverlay`（既定 `false`）、`enableKeyboard` / `enableSurfaceTap`（既定 `true`）
- `fallbackHtml?: string` — ハイドレーション前の静的フォールバック。通常は `renderEpubStatic` の出力
- `fetchOptions?: RequestInit`、`limits?: EpubParseLimits`、`fetchEpub?: (url: string) => Promise<ArrayBuffer>` — URL モードでの EPUB 読み込み
- `annotations?` — `{ chapter, start, end, color? }` の配列。`ChapterLayout.selectionRects` でハイライト矩形に変換される

React が `renderSettings` render prop を取るところは、Vue ではスロットです。`settings`（`MejiroReaderSettingsSlot` と同じ文脈を受け取る）に加えて `header`、`logo`、`dropZone`、`fallback`、`loading` があります。

コールバック props ではなくイベントを emit します: `load`、`chapter-change`、`spread-change`、`spread-idx-change`、`error`、`page-read`、`chapter-completed`。`MejiroReaderEventMap` は命令的な `MejiroReaderHandle.subscribe()` のペイロードを表す型として引き続き使い、`MejiroReaderHandle` は React と同じメソッド（`goToSpread`、`next`、`prev`、`goToChapter`、`getReadingPosition`、`goToAnchor`、`getAnchor`、`getVisibleRange`、`setOptions`、`subscribe`）を公開します。

### `MejiroManuscriptEditor` と `MejiroEditor` の型

`ManuscriptEditorChapter`、`ManuscriptAutosaveDraft`、`ManuscriptPreviewProps`、`MejiroExportPolicy` は React パッケージと同じ形です。

### 補助型

Vue の barrel はコンポーネントと併せて次の型もエクスポートします。形は React 版と同じで、Vue だけを使うホストが React パッケージから import せずに済むようにするためです。

- `MejiroChapterNavVariant` — `'select' | 'panel'`。`MejiroChapterNav` の表示形態
- `EditableSettings` と `FontChoice` — `MejiroSettingsPanel` が編集する値と選択肢の型
- `PageHeaderData` — `{ title?, pageNumber? }`。`MejiroSpread` が描く柱の内容
- `ReadingPosition` — `MejiroReaderHandle.getReadingPosition()` が返す `{ chapter, spreadIdx, totalPages, totalSpreads }`
- `ReadingPositionValue` — `useReadingPosition` が保存するアンカー
- `ImageOverlayRect` — コアのオーバーレイ矩形の再エクスポート。`useImageOverlay` の利用者が 1 か所から取得できるようにするため。`ImageRect` はその非推奨エイリアスとして残っています

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

段落のクラスは React 版と同じ共有ヘルパ `paragraphClassName(kind, headingLevel)` が生成します。blockquote / sceneBreak / pre / figure の段落には、両フレームワークでも `renderEpubStatic` の出力でも同一の `mejiro-paragraph--*` 修飾子が付きます。

---

[ドキュメント目次に戻る](./README.md)
