# API リファレンス

> **注意:** このページは `@libraz/mejiro` の各サブパスの全 export と、フレームワークパッケージのコンポーネント・フック・コンポーザブルを扱います。個々のコンポーネントの props は要約にとどめているので、prop 表は [React & Vue](./08-react-and-vue.md) を、正確な型やデフォルト値はパッケージ同梱の TypeScript 型定義を参照してください。

---

## `@libraz/mejiro` — コア

### 行分割

| エクスポート | シグネチャ |
|---|---|
| `computeBreaks` | `(input: LayoutInput) => BreakResult` |

行分割位置を計算します。禁則処理のバックトラッキングとオプションのぶら下げ組みを備えた貪欲法O(n)アルゴリズムです。`advances`・`clusterIds`・`breakPenalties` の長さがコードポイント数と一致しないとき、`lineWidth` や `lineWidths` の要素が正の有限数でないとき、advance が負または非有限のとき、`breakCost` の値が範囲外のとき、`kinsoku` が未知のモード名のとき、`preprocessRuby` がルビ注釈を拒否したときは `RangeError` を投げます。`kinsoku` がモード文字列でもカスタムルールでもなければ `TypeError` です。

| エクスポート | シグネチャ |
|---|---|
| `canBreakAt` | `(text: Uint32Array, pos: number, options?: CanBreakAtOptions) => boolean` |

指定位置の後ろで行分割が許可されるかどうかを判定します。`options` には `kinsoku` と `clusterIds` を渡します。

| エクスポート | シグネチャ |
|---|---|
| `toCodepoints` | `(str: string) => Uint32Array` |

文字列をUnicodeコードポイントの`Uint32Array`に変換します。`computeBreaks()`で使用します。

### 禁則処理

| エクスポート | シグネチャ |
|---|---|
| `isLineStartProhibited` | `(cp: number, options?: KinsokuCheckOptions) => boolean` |

コードポイントが `options.kinsoku`（組み込みモード。既定は `'strict'`。またはカスタムルール）のもとで行頭禁則文字かどうかを判定します。

| エクスポート | シグネチャ |
|---|---|
| `isLineEndProhibited` | `(cp: number, options?: KinsokuCheckOptions) => boolean` |

コードポイントが行末禁則文字かどうかを判定します。

| エクスポート | シグネチャ |
|---|---|
| `getDefaultKinsokuRules` | `() => KinsokuRules` |

デフォルトの厳密禁則ルールセットのコピーを返します。既定に文字を足すときは `extendKinsokuRules` に渡します。

| エクスポート | シグネチャ |
|---|---|
| `buildKinsokuRules` | `(source: KinsokuRuleSource) => KinsokuRules` |
| `extendKinsokuRules` | `(base: KinsokuRules, additions: Partial<KinsokuRuleSource>) => KinsokuRules` |
| `isUnbreakablePair` | `(left: number, right: number, options?: KinsokuCheckOptions) => boolean` |

`buildKinsokuRules` は生のコードポイント列から `KinsokuRules` オブジェクトを作成します。渡した配列はコピーされて凍結されます。`extendKinsokuRules` は `base` の禁則すべてに `additions` を加えたルールを返し、`base` は変更しません。`isUnbreakablePair` は隣接する 2 コードポイントの間での改行がペア規則で禁止されているかを判定します（既定は `‥‥`、`……`、`——`、`――`）。

### ぶら下げ組み

| エクスポート | シグネチャ |
|---|---|
| `isHangingTarget` | `(cp: number) => boolean` |

コードポイントがぶら下げ対象かどうかを判定します（U+3002, U+3001, U+FF0C, U+FF0E, U+FF61, U+FF64）。

| エクスポート | シグネチャ |
|---|---|
| `computeHangingAdjustment` | `(cp: number, advance: number) => number` |

ぶら下げの突出量を計算します。ぶら下げ対象文字の場合はadvanceを返し、それ以外は0を返します。

### ルビ（振り仮名）前処理

| エクスポート | シグネチャ |
|---|---|
| `preprocessRuby` | `(text: Uint32Array, advances: Float32Array, annotations: readonly RubyAnnotation[], existingClusterIds?: Uint32Array) => RubyPreprocessResult` |

ルビテキストの幅を親文字に分配し、クラスタIDを生成します。注釈の付いた範囲は親文字幅とルビ幅の大きい方を確保し、ルビ幅を隣接文字の送り幅に付け替えることはありません。扱えない入力では `RangeError` を投げます。`advances` の長さ違い、負または非有限の advance、空・非整数・範囲外の範囲、熟語ルビの集約以外での注釈の重なり、`rubyText` と長さの異なる `rubyAdvances`、2 文字以上にかかる `mono` 注釈が該当します。縦中横は不正な範囲を投げずに読み飛ばします（後述）。

| エクスポート | シグネチャ |
|---|---|
| `isKana` | `(cp: number) => boolean` |

コードポイントがひらがな（U+3040--U+309F）またはカタカナ（U+30A0--U+30FF）かどうかを判定します。

### 縦中横の前処理

| エクスポート | シグネチャ |
|---|---|
| `buildTcyAnnotations` | `(source: readonly InlineAnnotation[] \| readonly TcyCandidate[] \| undefined, emSize: number) => TcyAnnotation[] \| undefined` |
| `preprocessTcy` | `(text: Uint32Array, advances: Float32Array, annotations: readonly TcyAnnotation[], existingClusterIds?: Uint32Array) => TcyPreprocessResult` |

`buildTcyAnnotations` は混在したインライン注釈から `tcy` だけを取り出し（`deriveTypographyHints()` の `TcyCandidate` はそのまま受け取り）、それぞれに 1em を割り当てます。これは `text-combine-upright: all` が描画する幅と同じです。`preprocessTcy` はその幅に範囲を畳み、専用のクラスタ ID を与えるので、行分割器は列境界でこの範囲を分割できません。1em は範囲内の各文字に実測 advance の比で按分されるため、アンカー矩形やヒットテストは範囲内でも単調のままです。

縦中横の前処理はルビより**先**に走ります。合成ボックスに掛かるルビが、ボックスに置き換わる前の実測幅ではなく、畳んだあとの幅を基準に超過分を配れるようにするためです。またルビと違い、不正な範囲は拒否ではなくスキップします。空・逆転・範囲外・非整数・advance が非有限・既に適用した範囲と重なる（開始が早いものが勝ち、同点なら長いものが勝つ）ものが対象です。これらは任意の EPUB マークアップ由来なので、1 つ壊れているだけで章全体のレイアウトが止まってはいけないからです。

### クラスタサポート

| エクスポート | シグネチャ |
|---|---|
| `resolveClusterNoBreakFlags` | `(text: Uint32Array, clusterIds?: Uint32Array) => Uint8Array` |

位置ごとに 1 バイトを返します。その位置の後ろで改行できないとき `1` です。

| エクスポート | シグネチャ |
|---|---|
| `isClusterBreakAllowed` | `(clusterIds: Uint32Array \| undefined, pos: number) => boolean` |

`pos` の後ろでの改行がどのクラスタも分割しないかを判定します。テキストの末尾は `clusterIds.length` です。

### ページ分割

| エクスポート | シグネチャ |
|---|---|
| `paginate` | `(pageBlockSize: number, paragraphs: readonly ParagraphMeasure[]) => PageSlice[][]` |

段落の行を固定サイズのページに分配し、ページ境界で分割します。入力が空でも必ず 1 ページ以上を返します。

| エクスポート | シグネチャ |
|---|---|
| `getLineRanges` | `(breakPoints: Uint32Array, charCount: number) => [number, number][]` |

分割点を行ごとの`[start, end)`文字インデックスペアに変換します。

### トークン境界

| エクスポート | シグネチャ |
|---|---|
| `tokenLengthsToBoundaries` | `(tokenLengths: readonly number[]) => Uint32Array` |

形態素解析器のトークン長を`LayoutInput.tokenBoundaries`用の境界インデックスに変換します。

### 組版ヒント

| エクスポート | シグネチャ |
|---|---|
| `deriveTypographyHints` | `(analysis: TextAnalysis, options?: TypographyHintOptions) => TypographyHints` |

1 段落分の形態素解析結果から改行ヒントを導出します。既定で出力するのは `clusterIds` だけで、それ以外はすべて明示的な指定が必要です。したがって既定の出力が減らす改行候補は、分割すると組版として誤りになる単位を割ってしまう位置に限られます。クラスタ規則が発火する条件は形態素の表層の文字種であり、品詞ではありません。そのため、どの単位を不可分にするかは辞書のバージョンや解析器が変わっても安定します。罰則の規則は品詞を参照してかまいません。辞書がその語を知らなければ、その位置は結局もともと与えられるはずだった値のままになるからです。ヒントの位置は `analysis.text` を指します。発火しなかった規則のフィールドは省略されるので、呼び出し側は「ヒントがなければ前処理もしない」という高速パスをそのまま保てます。規則の内容と 2 段階のオプトインは [改行処理](./03-line-breaking.md) を参照してください。

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
| `parseManuscript` | `(text: string, options?: ParseManuscriptOptions) => ParsedManuscript` |
| `tokenizeManuscriptSource` | `(text: string, dialect?: ManuscriptDialect) => ManuscriptToken[]` |

`formatDialogueLineBreaks` は原稿テキスト内の日本語会話括弧の前後に自然な改行を入れ、余分な空行を作らないよう正規化します。既存の改行とインデントはそのまま残り、空白を取り除くのは、挿入した改行の隣だけです。禁則に反する改行は入れません。行頭禁則文字（`、`、`）` など）が行頭に来る位置や、行末禁則文字（`（` など）が行末に来る位置には改行を入れません。

`parseManuscript` は原稿記法（ルビ / 圏点 / TCY / em / strong / link / footnote）を、プレーンテキストとそのテキスト上の位置を持つ `inlineAnnotations` に変換します。記法は `ParseManuscriptOptions.dialect`（`ManuscriptDialect`: `'mejiro'`（既定）/ `'narou'` / `'kakuyomu'`）で選びます。`ParsedManuscript` は `{ text, inlineAnnotations }` です。

`tokenizeManuscriptSource` は原稿記法 (ルビ / 圏点 / TCY / em / strong / link / footnote) のトークン位置を **source 文字列上**で返します（`parseManuscript` がレンダー後位置を返すのと対照的）。`MejiroNotationHighlighter` の内部実装と同じです。

### 画像回り込み

**`ExclusionEngine`** — テキストが避ける矩形領域の管理:

- `constructor(geometry: ExclusionPageGeometry)`
- `setGeometry(geometry: ExclusionPageGeometry): void` — ページジオメトリの更新
- `getGeometry(): Readonly<ExclusionPageGeometry>` — 現在のジオメトリを取得
- `addImage(rect: ImageRect): void` — 画像を追加。エンジンは渡されたオブジェクトをそのまま保持します
- `removeImage(rect: ImageRect): boolean` — 参照による画像の削除。追加したオブジェクトそのものを渡します
- `clearImages(): void` — 全画像を削除
- `getImages(): readonly ImageRect[]` — 現在の画像一覧を取得
- `imageCount: number` — 画像数（getter）
- `compute(): ExclusionResult` — 列ごとのスロットと行幅を計算。ジオメトリや画像の矩形に非有限・範囲外の値（`linePitch` が 0 など）があると `RangeError` を投げます

**`SpreadExclusionEngine`** — 見開き 2 ページにわたる回り込み領域の管理:

- `constructor(geometry: SpreadGeometry)`
- `setGeometry(geometry: SpreadGeometry): void` — 見開きジオメトリの更新
- `getGeometry(): Readonly<SpreadGeometry>` — 現在のジオメトリを取得
- `addImage(rect: SpreadImageRect): void` — 画像を追加（右ページ左上基準。負の`x`は左ページ）
- `removeImage(rect: SpreadImageRect): boolean` — 参照による画像の削除
- `clearImages(): void` — 全画像を削除
- `getImages(): readonly SpreadImageRect[]` — 現在の画像一覧を取得
- `imageCount: number` — 画像数（getter）
- `compute(): SpreadExclusionResult` — 両ページのスロットとlineWidthsを計算

ノド（ページ間余白）の座標変換を自動で処理。テキストは右ページから左ページへ連続して流れる。

| エクスポート | シグネチャ |
|---|---|
| `computeExclusionSlots` | `(options: ComputeExclusionSlotsInput) => ExclusionResult` |

便利関数。`ExclusionEngine` を作成し、全画像を追加して `compute()` を呼ぶのと等価です。`ComputeExclusionSlotsInput` は `ExclusionPageGeometry` に `images: readonly ImageRect[]` を加えたものです。

| エクスポート | シグネチャ |
|---|---|
| `computeLineWidths` | `(baseLineWidth: number, lineCount: number, exclusions: readonly ExclusionZone[]) => Float32Array` |

低レベルAPI。除外ゾーンを基準幅から差し引いて行ごとの幅を計算する。どの幅も有限で 1px 以上です。`baseLineWidth` が有限でないか 1px 未満のとき、ゾーンの `blockStart` または `blockEnd` が `NaN` のとき、ゾーンの `inlineSize` が有限でないか負のときは `RangeError` を投げます。

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
| `serializeReadingPosition` | `(value: ReadingAnchor) => string` |
| `parseReadingPosition` | `(raw: string \| null) => ReadingAnchor \| null` |
| `serializeAnnotations` | `(annotations: readonly Annotation[]) => string` |
| `parseAnnotations` | `(raw: string \| null) => Annotation[] \| null` |
| `toSortedAnnotations` | `(annotations: readonly Annotation[]) => Annotation[]` |
| `createAnnotationId` | `() => string` |

フレームワークの永続化フックが共有する、バージョン付きペイロードのヘルパーです。シリアライザが書くのはバージョン 3 で、読書位置は `{ version: 3, chapterIndex, paragraphIndex, charIndex }`、注釈は `{ version: 3, annotations: [...] }` です。パーサは以前の形式（バージョンなしまたはバージョン 2 の読書位置、バージョン 1 の注釈）も読み、現在の形に変換して返します。`parseReadingPosition` は、データなし、未知のバージョン、`chapterIndex` / `paragraphIndex` / `charIndex` が非負の安全整数でない場合に `null` を返します。`parseAnnotations` はデータなしで `[]`、読めないデータで `null` を返すので、空のリストと壊れたデータを区別できます。形式が正しいペイロードでは、不正なエントリだけを取り除きます。`toSortedAnnotations` は章、開始アンカーの順に並べたコピーを返し、入力は変更しません。

`useReadingPosition` の `onPositionChange` や `useAnnotations` の `onAnnotationsChange` からサーバへ送る場合は、`serializeReadingPosition` / `serializeAnnotations` が返す文字列を送ってください。次回訪問時に対応するパーサがそのまま受け付けます。

### 国際化

| エクスポート | シグネチャ |
|---|---|
| `enMessages` / `jaMessages` | `MejiroMessages` |
| `messageCatalogs` | `Record<MejiroLocale, MejiroMessages>` |
| `resolveMessages` | `(locale: MejiroLocale \| undefined, overrides: Partial<MejiroMessages> \| undefined, fallback?: MejiroMessages) => MejiroMessages` |
| `formatMessage` | `(template: string, vars: Record<string, string \| number>) => string` |

同梱コンポーネントの UI 文字列カタログです。カタログは凍結されています。`resolveMessages` は組み込みカタログに部分的な上書きをマージして凍結した結果を返し、`formatMessage` は `{name}` プレースホルダを置換します。リーダー／エディタのコンポーネントは同じ値を `locale` / `messages` prop から受け取るため、ホスト側が直接呼ぶ場面はほとんどありません。値が `undefined` の上書きキーは無視され、カタログの文字列が残ります。`@libraz/mejiro-react` と `@libraz/mejiro-vue` は両関数を同じ名前で再エクスポートしています。

### テキスト・URL 補助

| エクスポート | シグネチャ |
|---|---|
| `normalizeText` | `(str: string) => string` |
| `sanitizeUrl` | `(raw: string) => string \| null` |

`normalizeText` はレイアウトパイプラインが前提とする NFC 正規化を適用します。`sanitizeUrl` は `href` にしてはいけない URL に対して `null` を返し、描画層はこれを使って安全でないリンクのアンカーだけを外し、入れ子のルビや傍点を含む中身は残します。

### 型定義

**`LayoutInput`** -- `computeBreaks()`の入力:

- `text: Uint32Array` -- Unicodeコードポイント
- `advances: Float32Array` -- 文字ごとの送り幅（px）
- `lineWidth: number` -- 利用可能な行幅（px）
- `lineWidths?: Float32Array` -- 行ごとの幅（`lineWidth` を上書き）
- `kinsoku?: KinsokuMode | KinsokuRules` -- `'strict'`（デフォルト）、`'loose'`、または `buildKinsokuRules()` / `extendKinsokuRules()` で作ったカスタムルール。カスタムルールは組み込みルールを完全に置き換える
- `enableHanging?: boolean` -- ぶら下げ組みを有効にする（デフォルト: `true`）
- `clusterIds?: Uint32Array` -- 不可分文字グループ
- `rubyAnnotations?: readonly RubyAnnotation[]` -- 改行処理で使用するコアレベルのルビ注釈
- `tcyAnnotations?: readonly TcyAnnotation[]` -- 縦中横の範囲。改行前にそれぞれを自身の幅を持つ 1 つの分割不能な箱にまとめる
- `tokenBoundaries?: Uint32Array | readonly number[]` -- 優先分割位置
- `breakPenalties?: Uint8Array` -- コードポイントごとに 1 要素で、そのインデックスの「後ろ」で改行するコスト。`0` は罰則なしで、値が大きいほど避ける。指定すると後方探索は最も近い有効位置ではなく `breakCost.maxBacktrackChars` の範囲内で最小コストの位置を選び、`tokenBoundaries` と空白優先の両方に優先する
- `breakCost?: BreakCostOptions` -- コスト探索の重み。`breakPenalties` がない場合は無視される

**`BreakResult`** -- `computeBreaks()`の出力:

- `breakPoints: Uint32Array` -- 各分割前の最後の文字のインデックス
- `hangingAdjustments: Float32Array` -- 行ごとのぶら下げ突出量（px）。1 行に 1 要素で、`enableHanging` が false ならすべて 0
- `effectiveAdvances?: Float32Array` -- 縦中横による幅の圧縮とルビの幅分配を反映した文字ごとの送り幅で、改行位置はこの幅から計算される。`tcyAnnotations` か `rubyAnnotations` が空でない場合に存在
- `lineWidths?: Float32Array` -- 各行で使用された実際の幅（`lineWidths` 入力が指定された場合に存在）

**`BreakCostOptions`** -- 罰則のある改行位置と、そこで改行した場合に残る行の空きを天秤にかける重み。位置 `p` の後ろで改行するコストは `penaltyWeight * breakPenalties[p] + shortfallWeight * shortfall(p)` で、`shortfall(p)` は行が行長に対してどれだけ短く終わるかを em 単位で表した値です。どの位置が選ばれるかに効くのは 2 つの重みの比だけなので、`{ penaltyWeight: 0.5, shortfallWeight: 1 }` と `{ penaltyWeight: 1, shortfallWeight: 2 }` は同じ改行になります:

- `penaltyWeight?: number` -- 罰則値に掛ける係数（既定: `1`）
- `shortfallWeight?: number` -- em 単位の空きに掛ける係数（既定: `1.5`）。この係数が探索の最悪の取引を決める。罰則 `P` の位置を避けて買える空きは最大で `P / shortfallWeight` em であり、`deriveTypographyHints()` が出す罰則の上限は `TypographyHintOptions.keepWholePenalty`（既定 4）なので、既定の係数では最悪の取引が 2.67em に収まる
- `maxBacktrackChars?: number` -- コスト探索があふれた文字から遡れる位置数。上限を設けることで改行処理は文字数に対して線形のままになる（既定: `6`）。`k` 個手前の位置は少なくとも `0.5k` em を捨てるため、配列中の最大の罰則を `P` として、勝てるのは `k < 2 * penaltyWeight * P / shortfallWeight` のあいだだけになる。既定の重みと `deriveTypographyHints()` が出す罰則では `k < 5.33` で、だからこそ 6 で探索は完全に覆われ、窓を広げても結果は変わらず探索時間だけが増える
- `emSize?: number` -- 1em のピクセル値（既定: その段落で実測した最大の送り幅。全角文字を含むテキストではこれが 1em になる）

**`KinsokuMode`** -- `'strict' | 'loose'`

**`KinsokuRules`** -- カスタム禁則ルール。`buildKinsokuRules()` で作り、作成後は読み取り専用:

- `lineStartProhibited: readonly number[]` / `lineEndProhibited: readonly number[]`
- `unbreakablePairs: readonly (readonly [number, number])[]`

**`KinsokuRuleSource`** -- `buildKinsokuRules()` の入力: `lineStartProhibited: readonly number[]` / `lineEndProhibited: readonly number[]` / `unbreakablePairs?: readonly (readonly [number, number])[]`。

**`KinsokuCheckOptions`** -- 禁則判定関数のオプション: `kinsoku?: KinsokuMode | KinsokuRules`（既定 `'strict'`）。

**`CanBreakAtOptions`** -- `KinsokuCheckOptions` に `clusterIds?: Uint32Array` を加えた、`canBreakAt()` のオプション。

**`RubyAnnotation`** -- コアレベルのルビ注釈:

- `startIndex: number` / `endIndex: number` -- 親文字中の範囲
- `rubyText: Uint32Array` / `rubyAdvances: Float32Array`
- `rubyType?: RubyType`
- `jukugoSplitPoints?: readonly number[]`

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
- `startIndex: number` / `endIndex: number` -- 開始（含む）と終了（含まない）。コードポイント単位
- `pos: string` -- 大分類の品詞コード
- `extendedPos: string` -- 細分類の品詞コード。ヒント規則が主に見るのはこちら

**`AnalyzerIdentity`** -- `{ name: string; version: string }`。キャッシュキーとスナップショット検証のために解析器を識別します。フィールドがすべて一致する 2 つの identity は、出力が互換な解析器を指します。

**`TextAnalysis`** -- テキストに整列済みの、1 段落分の解析結果: `text: string`（オフセットが指す NFC テキストそのもの）/ `morphemes: readonly MorphemeLike[]`（文書順・重なりなし）/ `analyzer: AnalyzerIdentity` / `warnings: readonly MejiroWarning[]`（問題がなければ空。解析器の出力がテキストと整列できなかったときは `alignment-failed` か `morphemes-dropped`）。

**`TextAnalyzer`** -- 段落から `TextAnalysis` を作るインターフェース:

- `identity: AnalyzerIdentity` -- この解析器の識別子。返すすべての解析結果の `analyzer` と一致するので、出所の分からないヒントを解析なしで判別できる
- `analyze(text: string): TextAnalysis` -- NFC テキスト 1 段落を解析する
- `dispose(): void` -- 解析器が保持するネイティブ資源を解放する。終端操作で、解放後の解析器は使えない

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
- `width: number` / `height: number` — サイズ（px）
- `inlineMargin?: number` — インライン方向（vertical-rl では上下）の余白。両側に適用（px）。既定は `0`
- `blockMargin?: number` — ブロック方向（vertical-rl では左右）の余白。両側に適用（px）。既定は `0`

**`SpreadImageRect`** — `SpreadExclusionEngine` 用の画像矩形。右ページ左上を原点とし、ページのパディングを含む座標で表します（原点がコンテンツ領域の `ImageRect` とは異なります）。負の `x` は画像を左ページに置きます:

- `x: number` / `y: number` — 右ページ左上からの位置（px）
- `width: number` / `height: number` — サイズ（px）
- `inlineMargin?: number` / `blockMargin?: number` — 両側に適用する余白（px）。既定は `0`

**`ImageOverlayRect`** — UIオーバーレイ矩形:

- `x: number` / `y: number` — オーバーレイ位置（px）。右ページの左上隅を原点とします。これは `useImageOverlay` と `ChapterLayout.setImages` が使う座標系です。負の `x` は左ページに及びます
- `width: number` / `height: number` — オーバーレイサイズ（px）

オーバーレイ矩形の型はパッケージ family 全体でこの `ImageOverlayRect` 1 つだけです。`@libraz/mejiro-react` と `@libraz/mejiro-vue` はこれを再エクスポートしています。上のレイアウト側 `ImageRect` は余白フィールドを持つ別の型です。

**`ColumnSlot`** — 1 行ぶんの描画スロット:

- `xPos: number` — コンテンツ領域右端からのオフセット（px）
- `yStart: number` — コンテンツ上端からの垂直オフセット（px）
- `height: number` — テキストに利用可能な高さ（px）
- `columnIndex?: number` — このスロットが属する物理列（0 = コンテンツ右端に最も近い列）。画像が列を複数のギャップに分割した場合、同じ `columnIndex` を複数のスロットが共有する。本パッケージが生成するスロットには必ず入っており、任意になっているのは手書きのスロット配列を代入可能に保つためだけ

スロットは読み順で出力され、1 つの列が複数のスロットを生む場合も 0 個の場合もある。したがって配列の添字は行の番号であり、列の番号ではない。物理列の識別には `xPos` ではなく `columnIndex` を使う。

**`ExclusionResult`** — `ExclusionEngine.compute()` と `computeExclusionSlots()` の出力:

- `slots: readonly ColumnSlot[]` — 読み順のテキスト配置
- `lineWidths: Float32Array` — 各スロットのインライン方向の長さ。スロットと 1 対 1 で、`computeBreaks()` の `lineWidths` 入力になる
- `affected: boolean` — どれかの列のスロットの割り当てが画像なしのとき（1 列につき全高のスロット 1 つ）と異なるか。列全体がふさがれた場合も含む

**`ComputeExclusionSlotsInput`** — `ExclusionPageGeometry` に `images: readonly ImageRect[]` を加えたもの。

**`ExclusionZone`** — 低レベル除外ゾーン:

- `blockStart: number` / `blockEnd: number` — 影響する行範囲
- `inlineSize: number` — 消費するスペース（px）

**`SpreadGeometry`** — 見開き2ページのジオメトリ:

- `pageWidth: number` — 各ページの幅（px）
- `paddingX: number` — 各辺の水平パディング（px）
- `paddingY: number` — 上部の垂直パディング（px）
- `lineWidth: number` — 基本行幅（px）
- `linePitch: number` — 列ピッチ（px）

**`SpreadExclusionResult`** — 見開き除外計算の結果:

- `rightSlots: readonly ColumnSlot[]` — 右ページのスロット
- `leftSlots: readonly ColumnSlot[]` — 左ページのスロット
- `lineWidths: Float32Array` — `computeBreaks()` 用の結合された行幅。右ページのスロットごとに 1 要素、続いて左ページのスロットごとに 1 要素なので、先頭の `rightSlots.length` 行が右ページに入る
- `rightAffected: boolean` — 右ページのどれかの列のスロットの割り当てが画像なしのときと異なるか。列全体がふさがれた場合も含む
- `leftAffected: boolean` — 左ページについての `rightAffected`

**`MejiroStorage`** — 永続化フックが受け取るストレージのインターフェース。Web Storage API の部分集合なので、`localStorage` や `sessionStorage` をそのまま渡せます。実装は例外を投げてもかまいません。フレームワークのフックがそれを捕まえて `onError` に渡します:

- `getItem(key: string): string | null` / `setItem(key: string, value: string): void` / `removeItem(key: string): void`

**`Annotation`** — 保存されるユーザー注釈:

- `id: string` / `chapterIndex: number`
- `start: InChapterAnchor` / `end: InChapterAnchor`
- `color?: string` / `note?: string` / `createdAt?: number`

**`MejiroLocale`** — `'en' | 'ja'`。**`MejiroMessages`** — UI 文字列カタログの型。

**`FontChoice`** — 設定パネルのフォント選択に使う `{ value: string; label: string }`。

**`EditableSettings`** — 同梱の設定パネルが編集する組版設定: `fontFamily: string | readonly string[]` / `fontSize: number` / `lineSpacing?: number` / `kinsoku?: KinsokuMode` / `enableHanging?: boolean`。

**`PageHeaderData`** — 柱（ページヘッダ）用の `{ title?: string; pageNumber?: number | null }`。

**`ManuscriptToken` / `ManuscriptTokenKind`** — `tokenizeManuscriptSource()` が返す、ソース位置での記法範囲。各トークンはソースの UTF-16 オフセットで `startOffset`（含む）から `endOffset`（含まない）までです。

**`BinaryInput`** — `ArrayBuffer | Uint8Array`。バイト列を読むすべての入口の入力型です。`Uint8Array` はそのビューの範囲（`byteOffset`, `byteLength`）だけを読むので、Node の `Buffer` のスライスもそのまま渡せます。入力は保持も変更もしません。バイト列の出力は常に `Uint8Array` です。

**`HeadingLevel`** — `1 | 2 | 3 | 4 | 5 | 6`。

**`ParagraphKind`** — `'body' | 'heading' | 'blockquote' | 'sceneBreak' | 'pre' | 'figure'`。

**`BookParagraph`** — `MejiroBook.layoutChapter()` とレンダラが受け取る章の 1 段落: `text: string` / `kind?: ParagraphKind` / `inlineAnnotations?: readonly InlineAnnotation[]` / `headingLevel?: HeadingLevel` / `hints?: TypographyHints`。`headingLevel` を持つか、`kind` が `'heading'` の段落が見出しです。

**`ChapterSource`** — `{ paragraphs: readonly BookParagraph[] }`。`layoutChapter()`、`estimateReadingTime()`、`renderEpubStatic()` が受け取る章の形です。`EpubChapter` はこれを満たします。

**`ManuscriptChapter`** — プレーンテキスト原稿の 1 章: `id?: string` / `title: string` / `body: string`。`MejiroBook.layoutManuscript()`、`manuscriptToEpubBook()`、`EpubProject`、原稿系のコンポーネントとフックが共有します。

**`InChapterAnchor`** — 再組版しても失われない章内の読書位置: `paragraphIndex: number` / `charIndex: number`（段落の NFC テキスト上のコードポイント位置）。

**`ReadingAnchor`** — `InChapterAnchor` に `chapterIndex: number` を加えたもの。`serializeReadingPosition()` が保存する形です。

**`InlineAnnotation`** — 7 種類のインライン注釈の判別共用体で、判別キーは `type` です。どの要素も NFC コードポイント位置の `startIndex`（含む）と `endIndex`（含まない）を持ち、さらに以下のフィールドを持ちます。`ruby` と `tcy` は改行処理に届き、残りは描画専用です:

| 型 | `type` | 追加フィールド |
|---|---|---|
| `InlineRubyAnnotation` | `'ruby'` | `rubyText: string`、`rubyType?: RubyType`、`jukugoSplitPoints?: readonly number[]` |
| `InlineEmphasisAnnotation` | `'emphasis'` | `style?: 'sesame' \| 'dot' \| 'circle'` — 傍点の記号 |
| `InlineTcyAnnotation` | `'tcy'` | — 縦中横。範囲を縦の列の中で横向きに描画し、改行処理には 1em の分割不能なクラスタとして届く |
| `InlineEmAnnotation` | `'em'` | — 斜体の強調。`<em>` として描画 |
| `InlineStrongAnnotation` | `'strong'` | — 強い強調。`<strong>` として描画 |
| `InlineLinkAnnotation` | `'link'` | `href: string`、`title?: string` |
| `InlineFootnoteAnnotation` | `'footnote-ref'` | `noteId: string` |

**`DEFAULT_LINE_SPACING`** — `1.8`。すべての層の行間の既定値です（`MeasureOptions.lineSpacing`、`BookOptions.lineSpacing`、フレームワークのコンポーネント）。`@libraz/mejiro/render` と `@libraz/mejiro/book` からも再エクスポートしています。

### エラー

| エクスポート | シグネチャ |
|---|---|
| `MejiroError` | `class extends Error { readonly code: MejiroErrorCode }`、`constructor(code: MejiroErrorCode, message: string, options?: ErrorOptions)` |

プログラマの誤りではない失敗について、すべてのパッケージが投げる唯一のエラークラスです。`message` ではなく `code` で分岐してください。引数の誤りは `TypeError` か `RangeError` を投げ、中断した操作は `signal.reason` で reject します。すべてのサブパスと両フレームワークパッケージが `MejiroError`、`MejiroErrorCode`、`MejiroWarning`、`MejiroWarningCode` を再エクスポートしているので、エラーがどの入口から来ても `instanceof` で判定できます。コードの一覧は [基本概念](./02-core-concepts.md#6-api-の規約) にあります。

**`MejiroErrorCode`** — 失敗コードの union: `'epub-invalid-archive' | 'epub-invalid-package' | 'epub-limit-exceeded' | 'epub-unsupported-content' | 'dom-unavailable' | 'environment-unsupported' | 'font-unavailable' | 'font-load-failed' | 'page-size-unset' | 'fetch-failed' | 'asset-fetch-failed' | 'analyzer-unavailable' | 'analyzer-disposed' | 'analyzer-failed' | 'image-decode-failed' | 'image-encode-failed' | 'storage-read-failed' | 'storage-write-failed' | 'storage-corrupt' | 'snapshot-invalid' | 'regex-unsafe'`。この union はマイナーリリースで増えるので、`switch` には `default` を置いてください。

**`MejiroWarning`** — 致命的でない劣化: `code: MejiroWarningCode` / `message: string`。

**`MejiroWarningCode`** — `'alignment-failed' | 'morphemes-dropped' | 'max-bytes-exceeded'`。

---

## `@libraz/mejiro/browser` — ブラウザ統合

`MejiroError`、`MejiroErrorCode`、`MejiroWarning`、`MejiroWarningCode` は `@libraz/mejiro` からの再エクスポートです。

### 高レベルAPI

**`MejiroBrowser`** -- メインクラス:

- `constructor(options?: MejiroBrowserOptions)` -- 空の `fontFamily` には `TypeError`、正の有限数でない `fontSize` には `RangeError` を投げる
- `layout(options: LayoutOptions): Promise<BreakResult>` -- 単一段落のレイアウト。フォントファミリーかサイズが呼び出しにもインスタンスにもなければ `TypeError`、`strictFontCheck` のもとでフォントが代替に落ちていれば `MejiroError` `font-unavailable`、canvas が使えなければ `environment-unsupported` で reject する
- `layoutParagraphs(options: ChapterLayoutOptions): Promise<ParagraphsLayoutResult>` -- 複数段落のレイアウト
- `preloadFont(fontFamily?: FontFamily, fontSize?: number): Promise<void>` -- フォントの先読み
- `verticalLineWidth(containerHeight: number, fontSize?: number): number` -- 有効な行幅を計算
- `clearCache(fontSpec?: string): void` -- 幅キャッシュをクリア。CSS フォント指定 1 つ分、または全体
- `cacheStats(): WidthCacheStats` -- 現在の幅キャッシュの大きさ
- `dispose(): void` -- `document.fonts` の購読を解除し、使わなくなったインスタンスを幅キャッシュごと回収できるようにする。解除後も使え、次のレイアウトで再び購読する。購読していない間にフォントが読み込まれた可能性があるため、その再利用時に幅を一度更新する。何度呼んでもよい

| エクスポート | シグネチャ |
|---|---|
| `layoutText` | `(options: LayoutTextOptions) => Promise<BreakResult>` |

`LayoutTextOptions` は `fontFamily` と `fontSize` を必須にした `LayoutOptions` です。スタンドアロンのワンショットレイアウト関数で、`MejiroBrowser` インスタンスを作る必要はありません。内部で専用の計測器を作るため、呼び出しをまたいだキャッシュは働きません。テキストの計測と改行位置の計算を 1 回の呼び出しで行います。

| エクスポート | シグネチャ |
|---|---|
| `verticalLineWidth` | `(containerHeight: number, fontSize: number) => number` |

縦書きテキストの有効な行幅を計算します。計算式: `containerHeight - fontSize * 0.5`。

### フォントと計測

- `FontLoader` -- FontFace APIによるフォント読み込み。下記を参照
- `CharMeasurer` -- Canvas.measureTextによる文字計測（コードポイントキャッシュ付き）
- `WidthCache` -- `Map<fontSpec, Map<codepoint, width>>`。下記を参照
- `deriveRubyFont(fontFamily: FontFamily, fontSize: number, ratio?: number): string` -- ルビフォント仕様（既定は半分サイズ）
- `normalizeFontFamily(family: FontFamily): string` -- 文字列またはフォントファミリー配列を CSS font-family 文字列へ正規化
- `toFontSpec(fontFamily: FontFamily, fontSize: number): string` -- CSSフォント仕様

**`CharMeasurer`** -- `Canvas.measureText` でコードポイントを計測する:

- `constructor(options?: CharMeasurerOptions)` -- `options.canvas` に 2D コンテキストがなければ `MejiroError` `environment-unsupported` を投げる
- `measure(fontSpec: string, codepoint: number): number` / `measureAll(fontSpec: string, text: Uint32Array): Float32Array`
- `getCache(): WidthCache`

**`CharMeasurerOptions`** -- `canvas?: HTMLCanvasElement`（構築時に検証。省略時は必要になった時点で作成）/ `cache?: WidthCache`（共有するキャッシュ。既定は専用の上限なしキャッシュ）。

**`WidthCache`** -- CSS フォント指定とコードポイントをキーにした幅キャッシュ:

- `constructor(options?: WidthCacheOptions)`
- `get(fontSpec: string, codepoint: number): number | undefined` / `set(fontSpec: string, codepoint: number, width: number): void`
- `clear(fontSpec?: string): void` / `size(fontSpec?: string): number` -- フォント指定 1 つ分、またはキャッシュ全体
- `fontCount(): number` / `stats(): WidthCacheStats`

**`WidthCacheStats`** -- `fonts: number`（エントリを持つフォント指定の数）/ `codepoints: number`（それらにまたがるキャッシュ済みの幅の数）。

**`FontLoader`** -- 計測の前に Web フォントの読み込みを待つ:

- `constructor(options?: FontLoaderOptions)` -- document の `loadingdone` イベントを購読する。`FontLoaderOptions.onFontsLoaded` はそのたびに呼ばれる
- `ensureLoaded(fontSpec: string, text?: string): Promise<void>` -- `text` が含む文字範囲についてフォントを読み込む。同じ指定の同時呼び出しは 1 つのリクエストを共有する。フォントが使える状態にならなければ `MejiroError` `font-load-failed` で reject するが、`MejiroBrowser` はこれを捕まえ、`strictFontCheck` のときだけ reject する
- `isLoaded(fontSpec: string, text?: string): boolean` -- その文字範囲について `ensureLoaded` が読み込みを確認済みかどうか
- `isAvailable(fontSpec: string, text?: string): boolean` -- その文字範囲をホストがそのフォントで描画できるかどうか
- `dispose(): void` -- `loadingdone` の購読を解除し、読み込み状態の記録をすべて破棄する。解除後も使え、次の `ensureLoaded` で再び購読する。その再利用時に `onFontsLoaded` を一度実行し、購読していない間に計測した幅をホストが更新できるようにする。何度呼んでもよい

### オーバーレイのドラッグセッション

| エクスポート | シグネチャ |
|---|---|
| `createOverlayDragSession` | `(options: OverlayDragSessionOptions) => OverlayDragSession` |
| `isPrimaryPointerPress` | `(event: Pick<PointerEvent, 'pointerType' \| 'button'>) => boolean` |

画像オーバーレイの移動・リサイズを pointerdown ハンドラから駆動します。document 上で `pointermove` / `pointerup` を購読し、ランタイムが提供する環境では更新をアニメーションフレームにまとめます。各矩形は pointerdown 時点の矩形と累積デルタから毎回作り直すため、ジェスチャ中に丸め誤差が蓄積しません。

セッションを始めるのは `isPrimaryPointerPress` が受け付ける押下、つまりタッチ・ペンの接触かマウスの主ボタンだけにしてください。副ボタンや補助ボタンはコンテキストメニューや自動スクロールを開き、ブラウザがその `pointerup` を届けないことがあります。

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
- `onRectChange: (rect: ImageOverlayRect) => void` — 更新ごとに新しい矩形を受け取る
- `onEnd?: () => void` — 終わり方によらず、ジェスチャ終了時にちょうど 1 度呼ばれる
- `registry?: Set<() => void>` — セッションがジェスチャの間だけ自身の破棄関数を登録する Set。アンマウント時に実行中のジェスチャを一括終了できる。ジェスチャが終わるとエントリは自分で外れる

**`OverlayDragSession`** — `createOverlayDragSession()` の戻り値:

- `active: boolean` — ジェスチャが継続中かどうか（読み取り専用）
- `dispose(): void` — ジェスチャを終了し全リスナを解放する。まだ届けていない更新は捨てる。セッションは再開できない。冪等

### 型定義

**`FontFamily`** -- `string | readonly string[]`。CSS にそのまま渡せる文字列（`'"Noto Serif JP", serif'`）か、ファミリー名の配列です。配列は `normalizeFontFamily()` がエスケープして連結します。以下の `fontFamily` オプションはすべてこの型です。

**`MejiroBrowserOptions`**:

- `fontFamily?: FontFamily` -- レイアウト呼び出しで省略されたときに使うフォントファミリー
- `fontSize?: number` -- レイアウト呼び出しで省略されたときに使うフォントサイズ
- `strictFontCheck?: boolean` -- フォントが代替フォントと同じ幅に計測されたら `font-unavailable` で reject する
- `onFontsLoaded?: () => void` -- ホストが新しいフォントの読み込みを通知し、幅キャッシュを消去した後に呼ばれる。それ以前の結果はここでレイアウトし直す

**`LayoutOptions`**:

- `text: string`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `lineWidth: number`
- `kinsoku?: KinsokuMode`
- `enableHanging?: boolean`
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `tokenBoundaries?: Uint32Array | readonly number[]`
- `hints?: TypographyHints`
- `breakCost?: BreakCostOptions`

**`ChapterLayoutOptions`**:

- `paragraphs: readonly ParagraphInput[]`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `lineWidth: number`
- `kinsoku?: KinsokuMode`
- `enableHanging?: boolean`
- `breakCost?: BreakCostOptions`

**`LayoutTextOptions`** -- `fontFamily: FontFamily` と `fontSize: number` を必須にした `LayoutOptions`。`layoutText()` 用。

**`ParagraphsLayoutResult`**:

- `paragraphs: readonly ParagraphLayoutResult[]`

**`ParagraphLayoutResult`**:

- `breakResult: BreakResult`
- `chars: readonly string[]`

**`ParagraphInput`**:

- `text: string`
- `inlineAnnotations?: readonly InlineAnnotation[]`
- `fontFamily?: FontFamily`
- `fontSize?: number`
- `tokenBoundaries?: Uint32Array | readonly number[]`
- `hints?: TypographyHints`

**`InlineAnnotation`** と各要素の型 `InlineRubyAnnotation`、`InlineEmphasisAnnotation`、`InlineTcyAnnotation`、`InlineEmAnnotation`、`InlineStrongAnnotation`、`InlineLinkAnnotation`、`InlineFootnoteAnnotation` — `@libraz/mejiro` からの再エクスポートです。要素の一覧はそちらにあります。

**`WidthCacheOptions`** — `WidthCache` の上限:

- `maxFonts?: number` — 保持するフォント指定の最大数
- `maxCodepointsPerFont?: number` — フォント指定ごとに保持するコードポイントの最大数

どちらも既定は `Infinity` です。これは「追い出さない」という意味ではなく LRU の記帳自体を切るという意味なので、有限値を設定すると読み取り経路の挙動も変わります。

---

## `@libraz/mejiro/epub` — EPUB の解析と作成

| エクスポート | シグネチャ |
|---|---|
| `parseEpub` | `(data: BinaryInput, options?: EpubParseOptions) => Promise<EpubBook>` |
| `parseEditableEpub` | `(data: BinaryInput, options?: EpubParseOptions) => Promise<EditableEpub>` |
| `DEFAULT_EPUB_PARSE_LIMITS` | 信頼できないアーカイブに適用する既定のリソース上限 |
| `assertEpubInputSize` | `(byteLength: number, limits?: Partial<EpubParseLimits>) => void`。`byteLength` が解決後の `maxInputBytes` を超えると `MejiroError` `epub-limit-exceeded` を投げます。`File` をバイト列を読む前に `size` で弾けます |
| `EditableEpub` | 解析済み EPUB の編集セッション。ブロック単位の編集、undo 履歴、書き出し |
| `editableEpubToEpubBook` | `(epub: EditableEpubBook) => EpubBook`。編集可能な本を、リーダーがレイアウトする `EpubBook` の形に写します。ライブプレビュー用です。段落は、書き出した本を `parseEpub` が読んだときと同じになり、章は `epub.chapters` と添字が揃います |
| `EpubProject` | 原稿の章から新しい EPUB 3 パッケージを作るクラス |
| `parseManuscript` | `@libraz/mejiro` からの再エクスポート。`ManuscriptDialect`、`ParseManuscriptOptions`、`ParsedManuscript`、`ManuscriptChapter` も一緒に再エクスポートしています |
| `manuscriptToEpubBook` | `(chapters: readonly ManuscriptChapter[], options?: ManuscriptToEpubBookOptions) => EpubBook`。ZIP を経由せずに原稿の章から `EpubBook` を組み立てます。ライブプレビュー向けです。章の `id` は結果に出ません |

`MejiroError`、`MejiroErrorCode`、`MejiroWarning`、`MejiroWarningCode` は `@libraz/mejiro` からの再エクスポートです。

`parseEpub` は EPUB ファイルを、ルビ注釈付きの章構造に解析します。どちらのパーサも `Uint8Array` はそのビューの範囲だけを読み（Node の `Buffer` のスライスを含む）、入力を保持も変更もしません。入力が読める ZIP アーカイブでないとき（空や 1 バイトの入力を含む）は `epub-invalid-archive`、コンテナ・パッケージ文書・章が不正なときや読める章がないときは `epub-invalid-package`、アーカイブが上限を超えたときは `epub-limit-exceeded`、ホストに DOM 実装がないときは `dom-unavailable` の `MejiroError` を投げます。入力が `ArrayBuffer` でも `Uint8Array` でもなければ `TypeError`、上限値が正の整数でなければ `RangeError` です。

どちらのパーサも DOM の XML パーサを必要とし、グローバルの `DOMParser`、`XMLSerializer`、`Node` を使います。ブラウザには揃っています。Node では DOM 実装を導入し、呼び出す前に `globalThis` に公開してください。

`EpubParseOptions` は `limits` と `signal` を取ります。`limits` は信頼できない入力に適用するアーカイブのリソース上限（`DEFAULT_EPUB_PARSE_LIMITS`）を上書きします: `maxInputBytes`（100 MiB）、`maxEntries`（10,000）、`maxEntryBytes`（50 MiB）、`maxTotalBytes`（200 MiB）、`maxCompressionRatio`（1,000）。省略したキーと `undefined` のキーは既定値のままです。`signal` は解析を中断します。promise は `signal.reason` で reject し、呼び出し時点ですでに中断済みのシグナルでも同じです。

| エクスポート | シグネチャ |
|---|---|
| `extractRubyContent` | `(xhtml: string) => AnnotatedParagraph[]` |

XHTML 文書の文字列から段落とルビ注釈を取り出します。ホストに DOM 実装がなければ `MejiroError` `dom-unavailable` を投げます。

| エクスポート | シグネチャ |
|---|---|
| `cloneEditableEpubBook` | `(epub: EditableEpubBook) => EditableEpubBook` |
| `clampEditableEpubSelection` | `(epub: EditableEpubBook \| null, selection: EditableEpubSelection) => EditableEpubSelection` |

`cloneEditableEpubBook` は編集可能な本を深くコピーします。プレビューの描画や書き出し専用の変換が、エディタの持つ文書に触れないようにするためです。`clampEditableEpubSelection` は `{ chapterIndex, blockId }` の選択を本の範囲に収めます。章の添字は切り捨ててから範囲内に丸め、章にないブロック id は章の先頭ブロック（ブロックがなければ `null`）に移します。

### EditableEpub

**`EditableEpub`** — 解析済み EPUB の編集セッションで、undo 履歴を持ちます。`parseEditableEpub()` で作ります。既存のブロックは `(chapterIndex, blockId)` で指定し、添字を使うのはブロックを置く位置だけです。存在しない章の添字やブロック id、種類の違うブロックの id を渡すと `RangeError` を投げます。例外を投げた編集は何も変更せず、履歴にも残しません。

- `epub: EditableEpubBook` — 生きた文書モデル（読み取り専用）。直接変更すると undo 履歴と変更通知を素通りするので、編集はセッションのメソッド経由で行ってください
- `title: string` / `author: string | undefined` — パッケージのメタデータ（ゲッター）
- `chapters: readonly EditableEpubChapter[]` — spine 順の章（ゲッター）。コピーではなく生きた配列
- `subscribe(listener: () => void): () => void` — 変更のたびに `listener` を呼びます。各編集、完了したトランザクション（1 回）、undo と redo が対象です。リスナーを外す関数を返します。例外を投げたリスナーがあっても他のリスナーへの配送は続き、その例外はマイクロタスクで投げ直されます
- `transaction<T>(fn: () => T): T` — 一連の編集を 1 つの履歴エントリと 1 回の変更通知にまとめます。入れ子の呼び出しは一番外側のトランザクションにまとまり、`fn` 内で例外が出るとその中の編集を巻き戻します。`fn` は同期的に実行され、promise を返すコールバックは型で拒否されます
- `undo(): boolean` / `redo(): boolean` — 確定済みの変更（またはトランザクション）を 1 つ取り消す／やり直す。対応するスタックが空なら `false`
- `history: EditHistoryState` — undo / redo の状態のスナップショット（ゲッター）
- `insertParagraph(chapterIndex: number, index: number, paragraph: NewParagraph): EditableParagraphBlock` — `chapter.blocks` の `index`（範囲内に丸める。末尾に足すには `chapter.blocks.length`）に挿入し、生成した `id` を持つ保存済みのブロックを返します。`headingLevel` が 1〜6 の整数でなければ `RangeError`、見出しにレベルがない・見出し以外にレベルがある・場面転換にテキストがあるときは `TypeError` です。`text` の外に出る注釈は捨てます
- `updateParagraph(chapterIndex: number, blockId: string, patch: ParagraphPatch): void` — テキスト、注釈、見出しレベル、種類を変更します。新しい `inlineAnnotations` なしで `text` を変えると、既存の注釈を新しいテキストに付け直します。各注釈は同じ親文字を覆い続けるか、捨てられるかのどちらかです
- `setInlineAnnotations(chapterIndex: number, blockId: string, inlineAnnotations: readonly InlineAnnotation[]): void` — 段落の注釈を置き換えます。現在のテキストの外に出る注釈は捨てます
- `deleteBlock(chapterIndex: number, blockId: string): void` — 段落または画像のブロックを削除します。画像の資産は、ほかに参照するブロックがなければ一緒に消えます
- `splitParagraph(chapterIndex: number, blockId: string, charIndex: number): EditableParagraphBlock` — コードポイント位置で分割します。元のブロックは id と分割前のテキストを保ち、残りは返り値の新しいブロックが持ちます。小数の位置は切り捨て、範囲外は丸め、非有限は例外です。分割位置をまたぐ注釈は捨てます
- `mergeParagraphs(chapterIndex: number, pair: MergeParagraphsInput): EditableParagraphBlock` — `pair.rightId` を、その直前にある `pair.leftId` に結合し、結合後のブロックを返します
- `moveBlock(chapterIndex: number, blockId: string, toIndex: number): void` — ブロックを `chapter.blocks` の別の位置に移します（範囲内に丸める）
- `addImage(chapterIndex: number, image: AddImageInput): EditableImageBlock` — 画像の資産と、それを参照する画像ブロックを追加し、ブロックを返します。資産名は `block.assetKey` です。`data` の入力はコピーします
- `removeImageAsset(assetKey: string): void` — 資産と、それを参照するすべての画像ブロックを、1 つの履歴エントリとして削除します
- `updateImage(chapterIndex: number, blockId: string, patch: Partial<Omit<EditableImageBlock, 'kind' | 'id' | 'assetKey'>>): void` — 代替テキスト、キャプション、配置を更新します
- `setImageCaption(chapterIndex: number, blockId: string, caption: string | null): void` — キャプションを設定します。`null` で削除します
- `export(options?: EditableEpubExportOptions): Promise<Uint8Array>` — 編集後の EPUB を書き出します。文書は呼び出し時点で同期的に取り込むので、書き出しが資産のバイト列を待っている間の編集は次回の書き出しに入り、この書き出しの途中に混ざることはありません。編集済みの章にブロックモデルが書き戻せない内容があれば `epub-unsupported-content`、URL だけの資産の既定の取得が失敗すれば `asset-fetch-failed` の `MejiroError`、`options.signal` が中断すれば `signal.reason` で reject します

### EpubProject

**`EpubProject`** — 原稿の章から新しい EPUB 3 パッケージを作ります。状態は外からは読み取り専用で、変更はすべてメソッド経由です。

- `constructor(options: EpubProjectOptions)` — 既定値を適用してから `chapters` と `cover` を登録します。そのため不正な表紙は書き出し時ではなくここで例外になります
- `static fromManuscript(options: EpubProjectOptions): EpubProject` — `new EpubProject(options)` の名前付きコンストラクタ版
- `metadata: Readonly<EpubProjectMetadata>` — 既定値を適用したパッケージのメタデータ（`language` は `'ja'`、空の `identifier` は新しい `urn:uuid:` 値、`modified` は構築時刻が既定）
- `chapters: readonly Readonly<ProjectChapter>[]` — spine 順の章。挿入時に割り当てた manifest id を持ちます
- `assets: readonly Readonly<EpubProjectAsset>[]` — 挿入順の manifest 資産。id / href / メディアタイプは解決済みです。表紙は常に最後の要素です
- `includeTitlePage: boolean` / `includeTitleInFirstChapter: boolean` / `pageProgressionDirection: 'rtl' | 'ltr' | 'default'` / `dialect: ManuscriptDialect` — コンストラクタのオプションから決まる値
- `stylesheet: string` — `OPS/Styles/style.css` に書き出す CSS
- `updateMetadata(patch: Partial<EpubProjectMetadata>): void` — メタデータにマージします。省略したフィールドと `undefined` のフィールドは値を保ちます
- `setStylesheet(css: string): void` — スタイルシートを置き換えます
- `addChapter(chapter: ManuscriptChapter): Readonly<ProjectChapter>` — spine の末尾に追加し、保存した章を返します。id は XML として安全な manifest id に整え、衝突すれば接尾辞を付けるので、保存された id は `chapter.id` と異なることがあります
- `updateChapter(index: number, patch: Partial<Omit<ManuscriptChapter, 'id'>>): void` — 省略したフィールドは前の値を保ちます。新しい本文が参照しなくなったインライン画像の資産は削除します
- `removeChapter(index: number): void` — 添字で削除し、その章だけが参照していたインライン画像の資産も削除します
- `reorderChapters(from: number, to: number): void` — 範囲外の `from` は何もせず、`to` は範囲内に丸めます。ドラッグ＆ドロップの並べ替え UI はどちらも普通に発生させるためです
- `addImage(chapterIndex: number, image: EpubProjectImageInput): Readonly<EpubProjectAsset>` — 画像を `OPS/Images/<filename>` に保存し、章の本文の `atParagraphIndex` に参照を埋め込み（書き出し時に `<figure>` になります）、保存した資産を返します
- `setCover(cover: CoverInput): Readonly<EpubProjectAsset>` — 表紙を `OPS/Images/<filename>`（既定 `cover.jpg`）に登録し、以前の表紙を置き換え、保存した資産を返します
- `addAsset(asset: EpubProjectAsset): Readonly<EpubProjectAsset>` — manifest 資産を追加し、保存したコピーを返します。href が衝突すると `-2`、`-3`、… を付けて改名するので、渡した href ではなく返り値の `href` でリンクしてください。href がアーカイブ内のきれいな相対パスでなければ `TypeError` を投げます
- `export(options?: EpubExportOptions): Promise<Uint8Array>` — EPUB 3 の ZIP に書き出します。順序は、無圧縮の `mimetype` を先頭に、コンテナ、パッケージ、ナビゲーション文書、スタイルシート、任意のタイトルページ、章ごとの XHTML 文書、すべての資産です。資産のバイト列は `data` から、または `url` から `options.assetResolver`（未指定なら実行環境の `fetch`）で取得します。章のないプロジェクトでは `epub-invalid-package`、既定の取得が失敗すれば `asset-fetch-failed` の `MejiroError`、`options.signal` が中断すれば `signal.reason` で reject します

不正な番地で投げるメソッド（存在しない添字への `updateChapter` と `removeChapter`、存在しない章や整数でない `atParagraphIndex` への `addImage`）は `RangeError` です。`data` も `url` もない画像や表紙、ディレクトリを含む `filename` は `TypeError` です。

### 型定義

**`EpubBook`**（読み取り専用）:

- `title: string`
- `author?: string` — 本の著者の表示用文字列
- `chapters: readonly EpubChapter[]`
- `pageProgressionDirection?: 'rtl' | 'ltr' | 'default'`

**`EpubChapter`**（読み取り専用）:

- `title?: string`
- `paragraphs: readonly AnnotatedParagraph[]`

**`AnnotatedParagraph`**:

- `text: string`
- `inlineAnnotations: readonly InlineAnnotation[]`
- `headingLevel?: HeadingLevel`

**`ParagraphKind`** — `@libraz/mejiro` からの再エクスポート。

**`EditableBlock`** — `kind` で区別する `EditableParagraphBlock` と `EditableImageBlock` の共用体:

- **`EditableParagraphBlock`**: `kind: 'paragraph'`、`id: string`、`text: string`、`inlineAnnotations: readonly InlineAnnotation[]`、`paragraphKind?: Exclude<ParagraphKind, 'figure'>`、`headingLevel?: HeadingLevel`（`paragraphKind` が `'heading'` のときに限り存在）
- **`EditableImageBlock`**: `kind: 'image'`、`id: string`、`assetKey: string`、`alt?: string`、`caption?: string`、`placement?: 'inline' | 'fullspread'`

**`NewParagraph`** — `insertParagraph()` の入力で、`paragraphKind` で区別する共用体です。本文・引用・整形済みテキスト（`paragraphKind?: 'body' | 'blockquote' | 'pre'`、`text`、`inlineAnnotations?`）、見出し（`paragraphKind: 'heading'`、`headingLevel: HeadingLevel`、`text`、`inlineAnnotations?`）、場面転換（`paragraphKind: 'sceneBreak'`、テキストなし）のいずれかです。`insertParagraph(0, 0, { text })` は本文の段落を挿入します。

**`ParagraphPatch`** — `updateParagraph()` の入力です。`paragraphKind` がなければ種類はそのままで、`text`、`inlineAnnotations`、`headingLevel`（見出しのみ）を変更できます。`paragraphKind` があると、新しい種類が必要とするフィールドを一緒に渡します。`'heading'` には `headingLevel` が必須で、`'sceneBreak'` はテキストを取りません。

**`MergeParagraphsInput`** — `mergeParagraphs()` の入力 `{ leftId: string; rightId: string }`。残る段落と、その直後の段落です。

**`EditHistoryState`** — `EditableEpub.history` から読む `canUndo: boolean` / `canRedo: boolean` / `depth: number` / `redoDepth: number`。

**`EditableEpubBook`** — `chapters` が `readonly EditableEpubChapter[]` の `EpubBook`。

**`EditableEpubChapter`** — 書き戻しに必要なソース情報を持つ章:

- `title?: string` — 章のタイトル。見出し要素か目次から取る
- `href: string` — 元の章文書の ZIP パス
- `originalXhtml: string` — 元のマークアップ。一度も編集していない章ではこれを再利用する
- `blocks: readonly EditableBlock[]` — 編集可能な内容。文書順
- `imageAssets: ReadonlyMap<string, EditableImageAsset>` — `assetKey` をキーにした資産

**`EditableImageAsset`** — 編集可能な章に付いた画像で、1 つ以上の画像ブロックから `assetKey` で参照されます（複数のブロックが 1 つの資産を共有できます）。バイト列の要素（`data: Uint8Array`）と URL の要素（`url: string`。書き出し時に `EpubExportOptions.assetResolver` で取得）の共用体で、どちらも `filename: string`、`href?: string`（元の EPUB から来た画像では保持）、`mediaType?: string` を持ちます。

**`AddImageInput`** — `EditableEpub.addImage()` の入力です。`AddImageInputBytes`（`data: BinaryInput`、`url` なし）と `AddImageInputUrl`（`url: string`、`data` なし）の共用体で、どちらも **`AddImageInputCommon`** を拡張します: `filename: string`、`mediaType?: string`、`alt?: string`、`caption?: string`、`placement?: 'inline' | 'fullspread'`、`afterBlockId?: string`。

**`EditableEpubSelection`** — `{ chapterIndex: number; blockId: string | null }`。エディタ UI がいま対象にしているブロックで、選択がなければ `null` です。

**`EpubExportOptions`** — 両方の書き出し経路が守るオプション:

- `onProgress?: (phase: 'serialize' | 'zip', ratio: number) => void` — `ratio` は各フェーズの中で 0 から 1 へ進み、次のフェーズが始まると 0 からやり直します。中断後は呼ばれません
- `signal?: AbortSignal` — 書き出しを中断します。promise は `signal.reason` で reject します
- `assetResolver?: AssetResolver` — URL だけの資産を解決します。省略時は実行環境の `fetch(url, { signal })`

**`EditableEpubExportOptions`** — `EpubExportOptions` に `watermark?: string` を加えたもの。書き出す各章の先頭に入れる段落のテキストです。透かしが入るのは書き出したコピーだけで、編集中の文書はそのままです。空文字列なら何も入れません。

**`AssetResolver`** — `(request: AssetResolverRequest) => Promise<BinaryInput> | BinaryInput`。`url` を宣言し、インラインの `data` を持たない資産ごとに 1 回呼ばれます。例外を投げると書き出しを中止します。

**`AssetResolverRequest`**:

- `url: string` — 資産が宣言している URL
- `href: string` — 解決したバイト列を書き込む、書き出した EPUB 内の ZIP パス。どちらの書き出し経路でも同じ意味なので、1 つのリゾルバで両方をまかなえます
- `mediaType?: string` — 資産が宣言しているメディアタイプ（あれば）
- `signal?: AbortSignal` — 書き出しに渡した `AbortSignal`（渡したとき）

**`EpubParseLimits`** — 信頼できないアーカイブを開くときのリソース上限: `maxInputBytes`、`maxEntries`、`maxEntryBytes`、`maxTotalBytes`、`maxCompressionRatio`（すべて必須。値は `DEFAULT_EPUB_PARSE_LIMITS` が上記のとおり与えます）。

**`EpubParseOptions`** — 両パーサの `limits?: Partial<EpubParseLimits>` / `signal?: AbortSignal`。

**`ManuscriptToEpubBookOptions`** — `manuscriptToEpubBook()` の `dialect?: ManuscriptDialect` / `metadata?: Partial<EpubProjectMetadata>`。`EpubBook.author` は `aut` の著者を `', '` で連結したものです。

**`EpubProjectOptions`** — `EpubProject` のコンストラクタのオプション:

- `metadata: EpubProjectMetadata` — 必須
- `chapters?: readonly ManuscriptChapter[]` / `cover?: CoverInput` — 構築中に `addChapter()` / `setCover()` で登録する
- `dialect?: ManuscriptDialect` — 章本文を解析する記法（既定 `'mejiro'`）
- `stylesheet?: string` — 同梱の既定スタイルシートを置き換える
- `pageProgressionDirection?: 'rtl' | 'ltr' | 'default'` — 既定 `'rtl'`
- `includeTitlePage?: boolean` — 既定 `true`
- `includeTitleInFirstChapter?: boolean` — 既定 `false`

**`ProjectChapter`** — プロジェクトに保存された章: `id: string`（解決・重複解消済み）、`title: string`、`body: string`。

**`EpubProjectAsset`** — 章と一緒にパッケージされるバイナリファイル。バイト列の要素（`data: BinaryInput`。追加時にコピー）と URL の要素（`url: string`。書き出し時に取得）の共用体で、どちらも次を持ちます:

- `href: string` — アーカイブ内の相対 ZIP パス。文字どおりのファイル名で、`%` はエスケープではなく名前の一部です。manifest と `src` 属性に書くときにパーセントエンコードします
- `id?: string` / `mediaType?: string` — 省略時は `href` から決める
- `properties?: string` — manifest の properties。表紙は `'cover-image'` を持つ

**`CoverInput`** — `setCover()` と `EpubProjectOptions.cover` の入力: `data: BinaryInput` または `url: string`（両方は不可）、`mediaType: string`、`filename?: string`（`OPS/Images/` 内。既定 `'cover.jpg'`）。

**`EpubProjectImageInput`** — `EpubProject.addImage()` の入力: `filename: string`、`data: BinaryInput` または `url: string`（両方は不可）、`mediaType?: string`、`alt?: string`、`atParagraphIndex: number`（章本文の空行区切りのブロックで数える。末尾を超える値は末尾に追加）。

**`EpubProjectMetadata`** は `title`（必須）、`subtitle`、`description`、`language`、`identifier`、`publisher`、`rights`、`date`、`modified`、`creators`、`contributors`、`subjects`、`collections` を持ちます。**`EpubContributor`** は `{ name: string; role?: string; fileAs?: string }`、**`EpubCollection`** は `{ name: string; type?: 'series' | 'set'; index?: number }` です。

---

## `@libraz/mejiro/render` — レンダリングデータ

| エクスポート | シグネチャ |
|---|---|
| `buildParagraphMeasures` | `(entries: readonly RenderEntry[], options: MeasureOptions) => ParagraphMeasure[]` |

ページ分割に使う段落計測値を計算します。ルビまたは傍点を含む段落は、`lineSpacing` にかかわらず 1 行あたり最低 `1.5`em を確保します。`buildLineMetrics` も同じ規則です。

| エクスポート | シグネチャ |
|---|---|
| `buildRenderPage` | `(slices: readonly PageSlice[], entries: readonly RenderEntry[]) => RenderPage` |
| `renderEpubStatic` | `(chapter: ChapterSource, options?: RenderEpubStaticOptions) => string` |
| `buildLineMetrics` | `(entries: readonly RenderEntry[], options: MeasureOptions) => LineMetricsResult` |
| `countPageLines` | `(metrics: readonly LineMetric[], startIndex: number, pageWidth: number) => number` |
| `buildColumnSlots` | `(input: BuildColumnSlotsInput) => ColumnSlot[]` |
| `adjustExclusionSlots` | `(input: AdjustExclusionSlotsInput) => ColumnSlot[]` |
| `getImageXOffset` | `(offsets: Float32Array, spreadStartLine: number, col: number) => number` |
| `findPhysicalColumn` | `(input: FindPhysicalColumnInput) => number` |
| `paragraphClassName` | `(kind: ParagraphKind \| undefined, headingLevel?: HeadingLevel) => string` |
| `pageNumberFor` | `(pageNumbers: PageNumberDisplay, pageIndex: number) => number \| null` |

ページスライスとエントリをレンダリング可能なページ構造に変換します。`renderEpubStatic`
は単一 chapter の HTML 文字列を返し、クライアント reader が hydrate する前の
SSR fallback markup として使えます。ラッパーには `mejiro-page--static` が付き、同梱の `mejiro.css` はその中の段落をブラウザの折り返しに任せます。注釈のオフセットは各段落のテキストをそのまま数えたもので、`MejiroBook` と同じくテキストと一緒に NFC へ正規化されます。
metric / slot helpers は、スロットベース表示と画像回り込みレイアウト向けの低レベルユーティリティです。`countPageLines` は `startIndex` から `pageWidth` に収まる行数を返します。オブジェクト入力は `BuildColumnSlotsInput`（`metrics`、`startIndex`、`count`、`columnHeight`）、`AdjustExclusionSlotsInput`（`slots`、`metrics`、`startIndex`、`basePitch`、`contentWidth?`）、`FindPhysicalColumnInput`（`offsets`、`spreadStartLine`、`fromRight`、`basePitch`）です。`adjustExclusionSlots` には `contentWidth` を渡してください。渡さないと、見出しによって広がった列のスロットがページ端をはみ出すことがあります。
`paragraphClassName` は段落の `kind` と `headingLevel` から、同梱スタイルシートが前提とする `mejiro-paragraph …` のクラス文字列を組み立てます。修飾子名を手で組み立てず、この関数を使ってください。
`pageNumberFor` は、0 始まりの `pageIndex` のページがランニングヘッドに印字する 1 始まりのページ番号を返します。`pageNumbers`（`PageNumberDisplay`: `'both' | 'right' | 'left' | 'none'`）で非表示になるページでは `null` を返します。偶数の添字は右側のページです。ページ送り表示とスクロール表示のリーダーは、この規則を共有します。
`renderEpubStatic` は `ChapterSource`（`{ paragraphs: readonly BookParagraph[] }`。`@libraz/mejiro` からの再エクスポート）を受け取ります。`EpubChapter` でも手で組んだオブジェクトでも満たせます。

`MejiroError`、`MejiroErrorCode`、`MejiroWarning`、`MejiroWarningCode`、`DEFAULT_LINE_SPACING` は `@libraz/mejiro` からの再エクスポートです。

### インラインセグメントの描画

| エクスポート | シグネチャ |
|---|---|
| `segmentToInlineNode` | `(segment: RenderSegment) => InlineRenderNode` |
| `buildInlineNodes` | `(chars: readonly string[], annotations: readonly InlineAnnotation[], start?: number, end?: number) => InlineNode[]` |

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

`buildInlineNodes` はその 1 段下の層で、文字範囲と注釈から `buildRenderPage()` がセグメントへ変換する `InlineNode` ツリーを組み立てます。`InlineNode` は `RenderSegment` と同じく `type` で要素を区別し、`children` を常に持ちます。どの注釈を残すかは段落全体で決めるので、部分的に重なる注釈の組は、段落がどこで改行されても同じように捨てられます。

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

- `chars: readonly string[]`
- `breakPoints: Uint32Array`
- `inlineAnnotations: readonly InlineAnnotation[]`
- `headingLevel?: HeadingLevel` — 見出しレベル。本文では undefined
- `kind?: ParagraphKind` — 元段落の構造分類（既定は `'body'`）

**`RenderPage`**:

- `paragraphs: readonly RenderParagraph[]`

**`RenderParagraph`**（読み取り専用）— `headingLevel` を持つか `kind: 'heading'` の段落が見出しです:

- `lines: readonly RenderLine[]`
- `headingLevel?: HeadingLevel`
- `kind?: ParagraphKind` — 元段落の構造分類。ページコンポーネントが `mejiro-paragraph--*` クラスに変換する
- `scale?: number` — `ChapterLayout` がこの見出しを計測したフォントスケール。ページコンポーネントが `--mejiro-paragraph-scale` に設定するので、描画サイズが計測サイズと一致する。本文段落と、`buildRenderPage()` で直接作ったページには付かず、スタイルシートのレベル別スケールが使われる

**`RenderLine`**:

- `segments: readonly RenderSegment[]`

**`RenderSegment`** — `text` 以外の各バリアントは、入れ子注釈用に `children?: readonly RenderSegment[]` も受け取ります。`text` はその範囲の内容を平坦化した文字列で、`children` は同じ範囲を内側の注釈ごとに入れ子で表します。描くのはどちらか一方だけで、両方を描くと文字が二重に出ます。`segmentToInlineNode()` を使えばこの選択を任せられます:

- `{ type: 'text'; text: string }`
- `{ type: 'ruby'; text: string; rubyText: string; children? }` — `text` は親文字
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
- `lineSpacing?: number` — 行間の倍率（既定: `DEFAULT_LINE_SPACING`、1.8）
- `headingScale?: number`（デフォルト: 1.4）— レベルのない見出しはこの値をそのまま使う。レベル 1–6 は `headingStyles` がそのレベルの `scale` を指定しない限り、`DEFAULT_HEADING_STYLES` のサイズをこの値に比例して拡縮する
- `paragraphGapEm?: number`（デフォルト: 0.4）
- `headingGapEm?: number` — `headingStyles` で上書きしていない全見出しレベルの後の間隔。未指定なら各レベルが `DEFAULT_HEADING_STYLES` の間隔を使う（レベルなしは `1.2`）
- `headingStyles?: Record<number, HeadingStyle>` — レベル 1–6 ごとの `scale` / `gapAfterEm` 上書き。指定しなかったレベルは既定値のまま。`ChapterLayout` のページは計測したスケールをページコンポーネントに渡す。`buildRenderPage()` の出力を自前で描画し、見出しサイズを既定から変える場合は、`--mejiro-paragraph-scale` も同じスケールに設定しないと計測と描画で見出しサイズが食い違う

**`HeadingStyle`**:

- `scale?: number` / `gapAfterEm?: number`

---

## `@libraz/mejiro/book` — 高レベルAPI

ほとんどのアプリケーションに推奨されるエントリポイントです。フォント読み込み、レイアウト、ページ分割、画像の回り込みをクラスベースの簡潔な API にまとめます。

`MejiroError`、`MejiroErrorCode`、`MejiroWarning`、`MejiroWarningCode`、`DEFAULT_LINE_SPACING`、`BookParagraph`、`ChapterSource`、`HeadingLevel`、`ParagraphKind`、`InlineAnnotation`、`ManuscriptChapter`、`InChapterAnchor`、`ReadingAnchor` は `@libraz/mejiro` から、`WidthCacheStats` は `@libraz/mejiro/browser` からの再エクスポートです。

### 定数

| エクスポート | 説明 |
|---|---|
| `DEFAULT_HEADING_STYLES` | 見出しレベル 1〜6 の既定スタイル（`{ 1: { scale: 1.6, gapAfterEm: 1.4 }, ... 6: { scale: 1.0, gapAfterEm: 0.6 } }`）。同梱スタイルシートのレベルごとのサイズと間隔に合わせてあります。`headingStyles` が省略したレベルに適用され、各 `scale` は `headingScale` に比例します。したがって `headingStyles` を指定しなくてもこのスタイルになります |
| `DEFAULT_BOOK_OPTIONS` | フォント、行間、禁則の既定オプション。`headingStyles` を持たないので、`headingScale` がすべての見出しレベルの大きさを変えます |
| `DEFAULT_PAGE_GEOMETRY` | `fitPageSize()` がページを当てはめる既定値。縦横比 `aspect`（高さ / 幅）、`minWidth` / `minHeight` / `maxHeight`、ヘッダ用（`headerOffset`）と見開きのノド用（`gutterOffset`）にコンテナから確保する余白。長さはピクセル単位 |
| `DEFAULT_PAGE_PADDING` | ページパディングの既定値（ピクセル）。`FitPageSizeOptions` のキーで `{ paddingX: 52, paddingY: 56, paddingBottom: 40 }` |

### MejiroBook

**`MejiroBook`** — 全体をまとめるメインクラス:

- `constructor(options: BookOptions)` — 組版設定と、`options.pageSize` があればページのジオメトリを記録します。最初のレイアウトまで何も計測しません。`fontFamily` がないか空、または `fontSize` がなければ `TypeError`、`fontSize` が正の有限数でない、または `pageSize` が `setPageSize` の検査に通らなければ `RangeError` です
- `getOptions(): ResolvedBookOptions` — book が使っているオプション。既定値はすべて解決済みで、構築時専用のキーも含みます
- `updateOptions(patch: BookOptionsPatch): Promise<void>` — `patch` をオプションにマージし、生きているレイアウトへ反映します。`lineSpacing` / `kinsoku` / `enableHanging` は同期的に適用され、返る promise は解決済みです。`fontFamily` / `fontSize` / `headingStyles` / `headingScale` は再計測が必要なため、値はいったん保留され、フォントの読み込み後に初めて `getOptions()` に現れます。こうして、生きているレイアウトは常に自分の設定に記録されたフォントで計測した送り幅を持ちます。重なった呼び出しは最後の呼び出しに収束します。生きているレイアウトは次に読まれたときに改行し直すので、読まれる前に置き換えられたレイアウトは改行し直しません。`strictFontCheck` のもとでは、保留中のフォントが代替フォントとして計測されると `font-unavailable`（または `font-load-failed`）で reject し、以前のオプションを保ちます。`strictFontCheck` がなければ、読み込みに失敗したフォントもそのまま確定し、ホストが解決したとおりに計測します
- `subscribe(listener: () => void): () => void` — book が生きているレイアウトを変えるたびに `listener` を呼びます。`updateOptions` の反映後と、新しく読み込まれたフォントでの再計測後です。変わった内容はレイアウトから読んでください。リスナーを外す関数を返します。例外を投げたリスナーがあっても他のリスナーへの配送は続き、その例外はマイクロタスクで投げ直されます
- `setPageSize(size: PageSize): void` — 何も計測せずにページのジオメトリを設定します。`pageWidth` か `lineWidth` がないか正の有限数でない、パディングが負または非有限、`paddingX` が `pageWidth` の半分未満でない場合は `RangeError` を投げ、以前のサイズを保ちます
- `fitPageSize(container: HTMLElement, options?: FitPageSizeOptions): PageGeometry` — `container` を測り、その結果をこの book のページサイズとして保存し、返します。縦横比 1.45、最小 280×400、最大高さ 780 を使い、ヘッダとノドの確保分は上書きできます。`options` で渡さなかったパディングは、コンテナがリーダーのスタイルシートから継承する `--mejiro-page-pad-*` カスタムプロパティに従うので、レイアウトは描画されるページの余白と一致します。カスタムプロパティがなければ `DEFAULT_PAGE_PADDING` です。コンテナの幅か高さが 0（未接続や `display: none`）なら `RangeError` を投げ、何も保存しません
- `layoutChapter(chapter: ChapterSource): Promise<ChapterLayout>` — 章をレイアウトします（`EpubChapter` も渡せます）。ページサイズが未設定なら `MejiroError` `page-size-unset`、フォントについては `updateOptions` と同じく `font-unavailable` / `font-load-failed` で reject します
- `layoutManuscript(options: LayoutManuscriptOptions): Promise<ChapterLayout[]>` — EPUB の ZIP を経由せずに原稿の章を直接レイアウトします。`options.chapters` の各章と同じ位置にレイアウトを 1 つずつ返します。本文は EPUB の書き出しと同じく空行で段落に分け、`parseManuscript()` で解析します。U+3000 の字下げと U+3000 だけの場面区切りは残し、インライン画像のマーカーだけのブロックは飛ばすので、段落の添字は書き出した EPUB と一致します
- `layoutFromSnapshot(snapshot: ChapterLayoutSnapshot): ChapterLayout` — 再計測せずにスナップショットからレイアウトを復元します。復元したレイアウトはスナップショットの設定とページジオメトリを保ち、送り幅はこの book のフォントファミリーで計測したものとみなします（スナップショットはフォントファミリーを記録しません）。スナップショットのフォントサイズや見出しのスケールが book と違えば、次の `updateOptions` で再計測します。現在の形式と 1 つ前の形式（バージョン 2）を読めます。オブジェクトでない値、未知の形式バージョン、不正なスナップショットでは `MejiroError` `snapshot-invalid` を投げます。不正とは、長さが段落のコードポイント数と一致しない送り幅配列、段落内で狭義単調増加でない改行位置、段落外の注釈範囲、欠けたフィールドや非有限のフィールド、NFC 正規化されていないテキスト、1〜6 の整数でない `headingLevel`、未知の `kind`、設定内の不正な `headingStyles`（`scale`、`gapAfterEm`）・`breakCost`・`analyzer` です。後からフォントが読み込まれるとレイアウトを再計測しますが、スナップショットの設定は保ちます
- `clearCache(fontSpec?: string): void` — 文字幅キャッシュをクリアします。CSS フォント指定 1 つ分、または全体
- `cacheStats(): WidthCacheStats` — 計測キャッシュの現在の大きさ。長時間のリーダーセッションで容量を監視するのに使います
- `dispose(): void` — book の `document.fonts` の購読を解除し、ホストが参照を手放したあと book、幅キャッシュ、レイアウトを回収できるようにします。解除後も使え、次のレイアウトかフォント変更で再び購読し、その再利用時に幅を一度計測し直します。何度呼んでもよく、`useMejiroBook` はアンマウント時に呼びます

**`LayoutManuscriptOptions`** — `chapters: readonly ManuscriptChapter[]` / `dialect?: ManuscriptDialect`（既定 `'mejiro'`）。

### ChapterLayout

**`ChapterLayout`** — レイアウト済みの章のページ分割と画像の回り込みを管理します。型としてだけエクスポートしており、レイアウトは `MejiroBook.layoutChapter()`、`layoutManuscript()`、`layoutFromSnapshot()` から得ます。

- `pageCount: number` — ページ数（ゲッター。遅延計算を起動する）
- `hasImages: boolean` — どれかの見開きに画像の回り込みがあるか
- `geometry: PageGeometry` — レイアウトが改行とページ分割に使うページのジオメトリ。最後にレイアウトまたはリサイズしたサイズです（ゲッター）
- `typography: ChapterTypography` — レイアウトを最後に計測したときのフォントファミリー、フォントサイズ、行間（ゲッター）。`MejiroSpread`、`MejiroScrollView`、`MejiroPageView` はこれと `geometry` を既定値に使います
- `resize(size: Partial<PageGeometry> & Pick<BookOptionsPatch, 'lineSpacing'>): void` — ジオメトリを更新し、`lineWidth` が変われば改行し直します。`fitPageSize()` の `PageGeometry` をそのまま渡せます。更新はひとまとまりで適用され、`setPageSize` の検査に通らないサイズは `RangeError` を投げてレイアウトを変えません
- `setImages(spreadIndex: number, images: readonly BookImage[]): SpreadResult` — 見開きの画像の回り込みを設定し、そこから流し直して、その見開きを返します。空配列でその見開きの画像を外します。呼ぶたびに流し直します。複数の見開きを一度に戻す経路は `layoutFromSnapshot()` です
- `clearImages(spreadIndex?: number): void` — 1 つの見開き、またはすべての見開きの画像の回り込みを外します
- `getSpread(spreadIndex: number): SpreadResult` — 見開き 2 ページのレイアウトデータを取得
- `getPage(pageIndex: number): PageResult` — 1 ページのレイアウトデータを取得
- `findText(query: string | RegExp, options?: FindTextOptions): SearchMatch[]` — 文字列はレイアウトのテキストと同じ NFC 正規化をしたうえで文字どおりに照合するので、分解形の `か\u3099` で `が` が見つかります。空文字列は一致なしです。`RegExp` は自身のフラグで照合し、`g` と `y` は無視し、`lastIndex` を読みも書きもしません。`caseSensitive` は文字列の検索語にだけ効きます。`maxResults` は件数の上限で、1 以上でなければ `RangeError` です。`RegExp` は安全性の検査を通り、破滅的バックトラッキングを起こしうる形や大きすぎるパターン・テキストでは `MejiroError` `regex-unsafe` を投げます。**対象は現在の `ChapterLayout` だけです。** 章や本をまたぐ検索（小説サイトの検索インデックスなど）には、サーバ側に外部の全文検索インデックス（Meilisearch / Elasticsearch / pg_trgm / SQLite FTS5）を置き、解決したアンカーを `MejiroReaderHandle.goToAnchor()` に渡して該当箇所に移動します
- `locateAnchor(anchor: InChapterAnchor): AnchorLocation | null` — アンカーを含む見開き / ページ / 行を求めます。範囲外なら `null`
- `anchorAt(spreadIndex: number, options?: AnchorAtOptions): InChapterAnchor | null` — 見開きのページ（`options.side`。既定 `'right'`）の先頭文字のアンカー。見開きの添字を、再組版しても失われない位置に変換するのに使います
- `endAnchor(): InChapterAnchor | null` — 章の最後の文字の直後を指すアンカー。レイアウトが扱う NFC コードポイントで数えます。段落のない章では `null`
- `coordOfAnchor(anchor: InChapterAnchor): AnchorRect | null` — 読書位置のアンカーを見開き / ページ座標に変換
- `anchorAtCoord(spreadIndex: number, point: SpreadPoint): InChapterAnchor | null` — 見開きローカルの点をアンカーに戻す
- `selectionRects(range: AnchorRange): AnchorRect[]` — テキスト範囲のハイライト矩形を作る
- `snapshot(): ChapterLayoutSnapshot` — SSR やビルド時キャッシュ用にレイアウトデータを直列化

### 読了時間

| エクスポート | シグネチャ |
|---|---|
| `estimateReadingTime` | `(chapter: ChapterSource, options?: ReadingTimeOptions) => number` |
| `formatReadingTime` | `(ms: number, options?: FormatReadingTimeOptions) => string` |

`estimateReadingTime` はミリ秒を返します。`ReadingTimeOptions` は `charsPerMinute?: number`（既定 `600`）と `includeHeadings?: boolean` を取ります。`formatReadingTime` は `FormatReadingTimeOptions.messages`（既定 `jaMessages`）の読了時間テンプレートで所要時間を文字列にします。

### 型定義

**`BookOptions`** — `MejiroBook` の設定。`BookOptionsPatch` にある組版のキーは後から `updateOptions()` で変えられ、それ以外は構築時に一度だけ読みます:

- `fontFamily: FontFamily` — CSS にそのまま渡せる文字列か、ファミリー名の配列
- `fontSize: number` — 基本フォントサイズ（px）
- `lineSpacing?: number` — 行間の倍率（既定: `DEFAULT_LINE_SPACING`、1.8）
- `kinsoku?: KinsokuMode` — 禁則モード（既定: `'strict'`）
- `enableHanging?: boolean` — ぶら下げ組み（既定: `true`）
- `headingStyles?: Record<number, HeadingStyle>` — レベルごとの見出しの上書き。省略したレベルは `DEFAULT_HEADING_STYLES` のスタイルを `headingScale` で拡縮したまま
- `headingScale?: number` — 見出しのスケール（既定: 1.4）。レベル 1〜6 は、`headingStyles` がそのレベルの `scale` を設定しない限り既定サイズをこれに比例させ、レベルのない見出しはこの値をそのまま使う
- `analyzer?: TextAnalyzer` — 改行ヒントを導出する形態素解析器。`wordAwareBreaking` がヒントを求めるときだけ、レイアウト時に段落ごとに 1 回参照する。改行し直し（リサイズ、フォント変更、回り込みの流し直し）では最初の結果を使い回す。構築時専用
- `wordAwareBreaking?: 'off' | 'clusters' | 'full'` — 解析器の結果を改行処理にどこまで及ぼすか（既定: `'off'`）。`'clusters'` は、分割すると組版として誤りになる単位を割る位置を除き、文字種の規則が選ぶとおりの改行位置を保つ。`'full'` は位置ごとの罰則を加え、改行位置を実際に動かす。構築時専用
- `keepWholePos?: readonly string[]` — 内部で改行しないよう避ける品詞。`TypographyHintOptions.keepWholePos` として `deriveTypographyHints()` に渡す（既定: `DEFAULT_KEEP_WHOLE_POS`）。罰則を出すのは `'full'` だけなので、読むのもそのときだけ。構築時専用
- `keepWholePenalty?: number` — `keepWholePos` の内部で改行するときの値段。`TypographyHintOptions.keepWholePenalty` として `deriveTypographyHints()` に渡す（既定: `4`）。構築時専用
- `breakCost?: BreakCostOptions` — 罰則探索の重み。改行処理に渡すが、罰則がなければ無視される。構築時専用
- `strictFontCheck?: boolean` — フォントがホストの既定フォントとまったく同じ幅に計測されたら、レイアウトとフォント変更を `font-unavailable` で reject する（既定: `false`）。構築時専用
- `pageSize?: PageSize` — レイアウトに使うページのジオメトリ。これがあれば `setPageSize()` を別に呼ぶ必要はない。`setPageSize` と同じ検査をする。構築時専用
- `onError?: (error: MejiroError) => void` — book が例外にせず回復する失敗を受け取る。章のレイアウト中に解析器が例外を投げると、解析器の例外を `cause` に持つ `analyzer-failed` として届き、その段落は文字種の規則だけでレイアウトされる。報告は book ごとに 1 回。指定しなければ `console.warn` に出す。構築時専用

**`BookOptionsPatch`** — `updateOptions()` が変えられるキー: `Partial<Pick<BookOptions, 'fontFamily' | 'fontSize' | 'lineSpacing' | 'kinsoku' | 'enableHanging' | 'headingStyles' | 'headingScale'>>`。構築時専用のキーを渡すと型エラーです。

**`ResolvedBookOptions`** — `getOptions()` の戻り値。`BookOptions` の組版設定と `wordAwareBreaking` を既定値まで解決し、`headingStyles`、`analyzer`、`keepWholePos`、`keepWholePenalty`、`breakCost` は渡されたままのものです。

**`PageSize`**:

- `pageWidth: number` — ページ幅（px）
- `lineWidth: number` — 行幅 / 列の高さ（px）
- `paddingX?: number` — 左右それぞれの水平パディング（既定: 0）
- `paddingY?: number` — 上部の垂直パディング（既定: 0）

**`PageGeometry`** — パディングをすべて解決し、ページの縦の大きさを加えた `PageSize`。`fitPageSize()` が返し、`ChapterLayout.geometry` が報告する形です。`setPageSize()` や `ChapterLayout.resize()` にそのまま渡せます:

- `pageWidth: number` / `lineWidth: number`
- `paddingX: number` / `paddingY: number`
- `pageHeight: number` — パディングを含むページの高さ（px）
- `contentHeight: number` — コンテンツボックスの高さ。ページの高さから縦のパディングを引いたもの（px）

**`FitPageSizeOptions`** — `fitPageSize()` の上書き: `paddingX?` / `paddingY?` / `paddingBottom?`（既定: 描画されている `--mejiro-page-pad-*` の値、なければ `DEFAULT_PAGE_PADDING`）、`aspect?`（1.45）、`minWidth?`（280）、`minHeight?`（400）、`maxHeight?`（780）、`headerOffset?`（56）、`gutterOffset?`（48）、`columns?: 1 | 2`（2。`1` は単ページのリーダー向けで、コンテナの全幅からページ幅を決める）。

**`ChapterTypography`** — `ChapterLayout.typography` から読む `fontFamily: FontFamily` / `fontSize: number` / `lineSpacing: number`。

**`AnchorAtOptions`** — `anchorAt()` の `side?: 'right' | 'left'`（既定 `'right'`。読み順で先のページ）。

**`SpreadPoint`** — `{ x: number; y: number }`。`AnchorRect` と同じく、右ページのコンテンツ左上を原点とする見開きローカルのピクセル座標で、左ページでは `x` が負になります。

**`BookImage`**:

- `x: number` / `y: number` — 右ページ左上からの位置（px）
- `width: number` / `height: number` — サイズ（px）
- `margin?: number` — インライン方向の余白（既定: 基本の fontSize）

**`SpreadResult`**（読み取り専用）:

- `right: PageResult` — 右ページ（vertical-rl の読み順で先）
- `left: PageResult` — 左ページ
- `pageCount: number` — レイアウトのページ数

**`PageResult`**（読み取り専用）:

- `page: RenderPage` — 段落構造のデータ（CSS の `vertical-rl` 描画用）
- `lines: readonly PageLine[]` — 平坦な行の一覧（スロットベースの絶対配置用）
- `slots: readonly ColumnSlot[]` — 行ごとの位置と寸法
- `hasImages: boolean` — このページに画像の回り込みがあるか

**`PageLine`**（読み取り専用）:

- `segments: readonly RenderSegment[]` — テキストとインライン注釈のセグメント
- `headingLevel?: HeadingLevel` — 見出しレベル（本文では undefined）
- `kind?: ParagraphKind` — 行が属する段落の種類（種類を持たない見出しでは `'heading'`）。スロットモードのページコンポーネントが `paragraphClassName()` に渡す
- `fontSize: number` — 計算後のフォントサイズ（px。見出しのスケールを反映）

**`HeadingStyle`** — `scale?: number` / `gapAfterEm?: number`。`@libraz/mejiro/render` からの再エクスポートです。

**`AnchorLocation`** — アンカーがレイアウト上のどこにあるか: `spreadIndex: number` / `pageIndex: number` / `lineIndex: number` / `side: 'right' | 'left'`。

**`AnchorRect`** — `spreadIndex: number` / `pageIndex: number` / `side: 'right' | 'left'` / `x: number` / `y: number` / `width: number` / `height: number`。右ページのコンテンツ左上を原点とする見開きローカルのピクセル座標です。

**`AnchorRange`** — `{ start: InChapterAnchor; end: InChapterAnchor }`。順序はどちらでもかまいません。

**`FindTextOptions`** — `caseSensitive?: boolean`（文字列の検索語のみ。既定 `false`）/ `maxResults?: number`（1 以上）。

**`SearchMatch`** — `AnchorLocation` に `paragraphIndex: number`、`startIndex: number` / `endIndex: number`（コードポイント位置。`InChapterAnchor.charIndex` と互換）、`match: string` を加えたもの。

**`ReadingTimeOptions`** — `charsPerMinute?: number` / `includeHeadings?: boolean`。**`FormatReadingTimeOptions`** — `messages?: MejiroMessages`。

**`ChapterLayoutSnapshot`** — `ChapterLayout.snapshot()` が作り、`MejiroBook.layoutFromSnapshot()` が読む直列化したレイアウト: `version: 3`、`config`、`size`、`paragraphs`、`images?`。ホストが保存できるよう、構成要素もエクスポートしています:

- **`ChapterLayoutSnapshotConfig`** — レイアウト設定のうち直列化できる部分: `fontSize`、`lineSpacing`、`headingScale`、`kinsoku`、`enableHanging`、`headingStyles?`、`breakCost?`、`analyzer?`
- **`ParagraphSnapshot`** — 段落ごとのエントリ: `text`、`advances: readonly number[]`、`breakPoints: readonly number[]`、`inlineAnnotations`、`headingLevel?`、`kind?`、`layoutRubyAnnotations?`、`layoutTcyAnnotations?`、`hintClusterIds?`、`hintBreakPenalties?`
- **`LayoutRubySnapshot`** — 型付き配列を素の `number[]` にした `RubyAnnotation`。スナップショットが `JSON.stringify` を通っても失われないようにするため
- **`SpreadImagesSnapshot`** — `{ spreadIndex: number; images: readonly BookImage[] }`。1 つの見開きの画像の回り込み

---

## `@libraz/mejiro/image` — 画像ヘルパー

| エクスポート | シグネチャ |
|---|---|
| `prepareImage` | `(file: Blob \| File, options?: PrepareImageOptions) => Promise<PrepareImageResult>` |

ブラウザ画像ファイルをデコードし、必要に応じて縮小・再エンコードして、EPUB埋め込み用のバイナリデータと寸法を返します。`createImageBitmap` / `OffscreenCanvas` / `HTMLCanvasElement` を使うためブラウザ専用です。これらの API がなければ `environment-unsupported`、ファイルをデコードできなければ `image-decode-failed`（環境のエラーを `cause` に持つ）、canvas がエンコードできなければ `image-encode-failed` の `MejiroError` で reject します。上限値が正の数でなければ `RangeError` です。`MejiroError`、`MejiroErrorCode`、`MejiroWarning`、`MejiroWarningCode` をここから再エクスポートしています。このサブパスがコアから import するのは `MejiroError` だけです。

**`PrepareImageOptions`** — 全フィールドが任意なので `prepareImage(file)` だけでも安全です:

- `maxBytes?: number` — 再エンコード後の目標サイズ（既定 2 MiB）。超えている間は JPEG/WebP の品質を `0.4` まで下げ続け、それでも収まらなければ警告を出す
- `maxWidth?: number` / `maxHeight?: number` — 縮小後のピクセル上限（各既定 `2048`）
- `convertTo?: 'auto' | 'webp' | 'jpeg' | 'png'` — 出力形式（既定 `'auto'`）。`'auto'` は JPEG / PNG / WebP の入力形式を保ち、GIF は `image/png` に再エンコードし（アニメーションは平坦化）、それ以外（AVIF など）は `image/jpeg` にフォールバックする。指定は保証ではなく、その形式をエンコードできない環境では黙って別の形式になる
- `quality?: number` — JPEG/WebP の初期品質（既定 `0.85`）
- `signal?: AbortSignal` — 処理を中断する。promise は `signal.reason` で reject し、呼び出し時点ですでに中断済みでも同じ

**`PrepareImageResult`**:

- `data: Uint8Array` — 再エンコード済みのバイト列。そのまま EPUB に入れられる
- `mediaType: string` — `data` の MIME タイプ。要求した形式ではなくエンコーダが実際に出力した形式
- `width: number` / `height: number` — 縮小後のデコード済みピクセルサイズ
- `warnings: readonly MejiroWarning[]` — 画像を `maxBytes` に収められなかったときの `max-bytes-exceeded`。その場合 `data` は生成したうちで最小のエンコード結果。縮小・品質低下・形式のフォールバックは警告ではなく、`width`・`height`・`mediaType` に表れる

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

suzume の WebAssembly トークナイザを使う解析器を作ります。WebAssembly モジュールと辞書の読み込みはここで 1 回だけ行います。`TextAnalyzer.analyze()` は同期的であり、非同期の処理はすべて解析器が存在する前に済ませておく必要があるからです。`@libraz/suzume` が未インストールの場合やモジュールの読み込みに失敗した場合、返る Promise は `MejiroError` `analyzer-unavailable` で reject します。このファクトリを呼ぶこと自体がその解析器を明示的に要求する行為なので、文字種規則だけの改行に落としたい呼び出し側は reject を捕まえて自分でそうします。使い終えたら dispose してください。`instance` で渡した既存インスタンスは、その寿命が渡した側のものなので破棄されません。

**`SuzumeAnalyzerOptions`**:

- `instance?: SuzumeInstance` — 新規作成の代わりに引き取る、作成済みの Suzume インスタンス。作成時に検査し、文字列の `version` や `analyzeWithNormalizedText`・`destroy` メソッドのないオブジェクトには `TypeError` を投げる
- `wasmPath?: string` — WebAssembly バイナリの位置の上書き。インスタンス生成にそのまま渡される

| エクスポート | シグネチャ |
|---|---|
| `alignMorphemeOffsets` | `(text: string, normalizedText: string, morphemes: readonly MorphemeLike[]) => Pick<TextAnalysis, 'morphemes' \| 'warnings'> \| null` |

解析器の正規化済みテキスト上のオフセットを、レイアウトエンジンが実際に改行するテキストへ写します。解析器は自前の正規化器が作った文字列を基準に添字を振りますが、その正規化器は入力を短くすることしかしません。したがって写像は恒等（通常の文章が通る高速パス）か、単調な 1 回の走査のどちらかになります。結果は全体が成功するか、まったく成功しないかのどちらかです。中途半端に写すとヒントが別の文字に付いてしまうため、その場合は `null` を返します。写した範囲がテキストの外に出るもの、自身の表層形を再現できないものは捨てられ、`warnings` に記録されます。独自の解析器を `TextAnalyzer` に適合させるときに使います。

**`SuzumeInstance`** — 解析器が使う suzume インスタンスの部分: `version: string`、`analyzeWithNormalizedText(text: string): SuzumeAnalysis`、`destroy(): void`。**`SuzumeAnalysis`** — `normalizedText: string` / `morphemes: readonly SuzumeMorpheme[]`。**`SuzumeMorpheme`** — `surface`、`pos`、`extendedPos` と、suzume が返すままの `start` / `end`（`normalizedText` 上の位置）。

解析器は `TextAnalysis.warnings` に `alignment-failed` と `morphemes-dropped` を報告します。`dispose()` 後の `analyze()` は `MejiroError` `analyzer-disposed` を投げます。WebAssembly インスタンスを解放するので、dispose は終端操作です。

このサブパスは `AnalyzerIdentity` / `MorphemeLike` / `TextAnalysis` / `TextAnalyzer` / `MejiroError` / `MejiroErrorCode` / `MejiroWarning` / `MejiroWarningCode` も再エクスポートします。解析器を実装するためにコアのサブパスを参照せずに済むようにするためです。

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

peer dependency は `react >= 18` です。TypeScript のプロジェクトでは、使っている React のバージョンに合う `@types/react >= 18` もインストールしてください。

`MejiroError`、`MejiroErrorCode`、`MejiroWarning`、`MejiroWarningCode`、`MejiroStorage`、`ManuscriptChapter`、`ReadingAnchor` は `@libraz/mejiro` からの再エクスポートなので、React だけを使うホストも 1 か所から import できます。`onError` やフックの `error` に届くエラーは、コアが投げた `MejiroError` そのままで、包み直しません。

### コンポーネント

どのコンポーネントも対応する props 型をエクスポートします。`MejiroSettingsPanel` はフォームが編集する値の型もエクスポートします。低レベルのコンポーネント（`MejiroPage`、`MejiroPageView`、`MejiroSpread`、`MejiroScrollView`、`MejiroSelectionLayer` など）はルート要素に `ref` を転送し、`ComponentPropsWithoutRef<'div'>` の `div` 属性を受け取ります。

| コンポーネント | props 型 | 用途 |
|---|---|---|
| `MejiroReader` | `MejiroReaderProps` | フル機能のリーダー。クロム、ナビゲーション、設定、永続化フック |
| `MejiroEditor` | `MejiroEditorProps` | `EditableEpub` を編集するブロックエディタ。`ExportPolicy` 付き |
| `MejiroManuscriptEditor` | `MejiroManuscriptEditorProps` | ライブプレビュー付きの原稿執筆画面 |
| `MejiroNotationHighlighter` | `MejiroNotationHighlighterProps` | 記法トークンを色分けする textarea |
| `MejiroShelf` | `MejiroShelfProps` | 複数巻の本棚。`useLibrary` と組み合わせる |
| `MejiroToc` | `MejiroTocProps` | 目次 |
| `MejiroScrollView` | `MejiroScrollViewProps` | 連続スクロールのページ列 |
| `MejiroSelectionLayer` | `MejiroSelectionLayerProps` | 選択 / ハイライトのオーバーレイ |
| `MejiroPageView` | `MejiroPageViewProps` | `PageResult` から 1 ページを描画 |
| `MejiroPage` | `MejiroPageProps` | `RenderPage` から 1 ページを描画 |
| `MejiroSpread` | `MejiroSpreadProps` | 見開き 2 ページ。柱は `PageHeaderData` を使う |
| `MejiroSettingsPanel` | `MejiroSettingsPanelProps` | `EditableSettings` と `FontChoice` を編集するフォント / サイズ / 禁則のフォーム |
| `MejiroChapterNav` | `MejiroChapterNavProps` | 章の選択（`chapterIndex` + `onChapterIndexChange`）。`MejiroChapterNavVariant` は `'select' \| 'panel'` |
| `MejiroStats` | `MejiroStatsProps` | レイアウト統計の行（`chapter`、`pageCount`、`elapsedMs`、`charsPerMinute?`、`locale?`） |
| `MejiroPageIndicator` | `MejiroPageIndicatorProps` | 「現在 / 全体」の位置。0 始まりの `index` と `count` を受け取り、1 始まりで表示する |
| `MejiroDropZone` | `MejiroDropZoneProps` | EPUB のドロップ先 / ファイル選択。`onReject(file, reason)` の `reason` は `'type'` か `'validation'` |
| `MejiroImagePlaceholder` | `MejiroImagePlaceholderProps` | ドラッグ・リサイズできる画像のプレースホルダ（CSS クラスは `mejiro-image-overlay`） |
| `MejiroI18nProvider` | `MejiroI18nProviderProps` | 配下にメッセージカタログ（`locale?`、`messages?`）を供給する |

`MejiroSpread` は `ReaderAnnotation`（`annotations` prop が受け取る形で、`Pick<Annotation, 'chapterIndex' | 'start' | 'end' | 'color'>`）と、`AnchorRect` に任意の `color` を加えた `SelectionRect` もエクスポートします。

### フック

| フック | オプション / 戻り値の型 | その他のエクスポート型 |
|---|---|---|
| `useEpub` | `UseEpubOptions` / `UseEpubReturn` | `FetchEpubOptions` |
| `useEditableEpub` | `UseEditableEpubOptions` / `UseEditableEpubReturn` | `EditableEpubSelection` |
| `useEpubProject` | `UseEpubProjectOptions` / `UseEpubProjectReturn` | — |
| `useLibrary` | `UseLibraryOptions` / `UseLibraryReturn` | `VolumeInfo` |
| `useManuscriptDraft` | `UseManuscriptDraftOptions` / `UseManuscriptDraftReturn` | — |
| `useManuscriptLayout` | `UseManuscriptLayoutOptions` / `UseManuscriptLayoutReturn` | `ChapterLayoutRecomputeOptions` |
| `useAnnotations` | `UseAnnotationsOptions` / `UseAnnotationsReturn` | `Annotation` |
| `useMejiroBook` | `UseMejiroBookOptions` / `UseMejiroBookReturn` | — |
| `useChapterLayout` | `UseChapterLayoutOptions` / `UseChapterLayoutReturn` | `ChapterLayoutRecomputeOptions` |
| `useSpread` | `UseSpreadOptions` / `UseSpreadReturn` | `ResolvedSpreadMode`、`GoToOptions` |
| `useReadingPosition` | `UseReadingPositionOptions` / `UseReadingPositionReturn` | — |
| `useI18n` | `UseI18nOptions` | `MejiroLocale`、`MejiroMessages`。`enMessages`、`jaMessages`、`resolveMessages`、`formatMessage` |
| `useImageOverlay` | `UseImageOverlayOptions` / `UseImageOverlayReturn` | `ImageOverlayRect`、`MultiImageItem` |

`resolveMessages` と `formatMessage` はコアの同名関数です。`VolumeInfo` は `{ id, label, author?, cover?, meta? }`、`MultiImageItem` は `{ id, rect }` です。`ChapterLayoutRecomputeOptions` は `{ blank?: boolean }` で、両レイアウトフックの `recompute` が受け取ります。

- `useEpub({ url?, onLoad?, onError?, fetchOptions?, fetchEpub?, limits? })` は `epub`、`loading`、`error`、`loadBuffer`、`loadFile`、`loadUrl`、`setEpub` を返します。`url` の変化に追従し、新しい値ならその本を読み込みます。`fetchEpub(url, { signal })` は `FetchEpubOptions` を受け取り、その `signal` は新しい読み込みが始まったときやアンマウント時に中断されます。`loadFile` は `limits.maxInputBytes` を超えるファイルを、読む前に `size` で拒否します。2xx 以外の応答は `MejiroError` `fetch-failed` として報告します。
- `useEditableEpub({ url?, onLoad?, onError?, onExport?, fetchOptions?, fetchEpub?, limits?, assetResolver? })` は `editor`、`epub`、`previewEpub`、`loading`、`exporting`、`error`、`revision`、`history`、`selection`、`selectedParagraph`、`setSelection`、`loadBuffer`、`loadFile`、`loadUrl`、`updateParagraph`、`setInlineAnnotations`、`addImage`、`undo`、`redo`、`exportEpub(options?)` を返します。フックは `editor` を購読するので、`editor` を直接編集してもフック自身の編集と同じく `revision` が進みます。`previewEpub` は `editableEpubToEpubBook(epub)` で、変更のたびに作り直します。`selection` は `{ chapterIndex, blockId }` で、`updateParagraph(patch)` と `setInlineAnnotations` は選択中の段落に作用し、`addImage(input)` は保存した `EditableImageBlock` を返します（読み込み前は `null`）。`exportEpub` は `Uint8Array` で解決し、失敗は `error` に入って `onError` に渡され、reject します。`assetResolver` は、オプションに自前のリゾルバを持たない `exportEpub` 呼び出しすべてに適用されます。
- `useEpubProject({ initialMetadata?, initialChapters?, initialCover?, initialAssets?, assetResolver?, debounceMs?, onPreview?, onExport?, onError?, defaultChapterTitle?, defaultChapterBody? })` は `metadata`、`chapters`、`selectedChapterIndex`、`currentChapter`、`cover`、`assets`、`previewEpub`、`previewError`、`previewing`、`exporting`、`error` と、`updateMetadata`、`setChapters`、`setSelectedChapterIndex`、`setCover`、`setAssets`、`addChapter`、`removeChapter(index)`、`updateChapter`、`reorderChapters`、`buildProject`、`exportEpub` を返します。`currentChapter` は選択中の章（なければ `null`）です。`setCover(null)` で表紙を外し、debounce されたプレビューと `exportEpub` のどちらにも、同じ tick の先に行った表紙・資産の変更まで反映されます。プレビューも URL だけの資産を `assetResolver` で解決し、新しい編集に追い越されたときやアンマウント時にはリクエストの `signal` で中断します。`metadata.identifier` を渡さなければ一度だけ生成するので、同じプロジェクトのプレビューと書き出しはすべて同じ識別子を共有します。書き出しの失敗は `error` に入って `onError` に渡され、reject します。
- `useManuscriptDraft({ initialChapters?, onAutosave?, autosavePayload?, autosaveDeps?, autosaveDebounceMs?, defaultChapterTitle?, defaultChapterBody? })` は `chapters`、`selectedChapterIndex`、`setSelectedChapterIndex`、`setChapters`、`updateChapter`、`addChapter`、`removeChapter(index)`、`reorderChapters`、`autosaveError`、`flushAutosave` を返します。`initialChapters` がなければ、原稿は空の章 1 つから始まります。`autosaveDeps` は、変化したら自動保存を予約する追加の値の列です。非同期の永続化は `onAutosave` で行います。
- `useChapterLayout(book, { epub, chapterIndex, surface, enableResize?, resizeDebounceMs?, pageGeometry?, capturePosition?, restorePosition?, onError? })` は選択中の章をレイアウトし、表示面のリサイズで再びレイアウトします。現在のレイアウトを計測したときと同じボックスを報告する観測では流し直しません。大きさが 0 の表示面は、大きさが報告されるまでレイアウトしません。`{ layout, pageWidth, pageHeight, contentHeight, elapsedMs, error, recompute, pendingRestore }` を返します。再レイアウトでは book がすでに導出した改行ヒントを使い回すので、解析器を再実行しません。流し直しをまたいで読書位置を保つ方法は [リフローをまたいで読書位置を保つ](./08-react-and-vue.md#リフローをまたいで読書位置を保つ) を参照してください。現在のリクエストのレイアウトが失敗すると、どの経路（ソースの変化、リサイズ、`recompute`）で始まったものでも、`error` に入り `onError` に 1 回渡されます。追い越されたレイアウトは何も報告しません。`onError` があれば `recompute` は解決し、なければ await した `recompute` は reject し、フック自身の起動は失敗を捨てます。
- `useManuscriptLayout(book, { chapter, surface, dialect?, enableResize?, resizeDebounceMs?, capturePosition?, restorePosition?, onError? })` は EPUB の ZIP を経由せずに原稿の 1 章を直接レイアウトします。戻り値の形は `useChapterLayout` と同じで、失敗の報告も同じです。ライブプレビュー向けです。
- `useMejiroBook(options, hookOptions?)` は `MejiroBook` を 1 つ所有し、`{ book, options, updateOptions }` を返します。`hookOptions` は `UseMejiroBookOptions`（`{ debounceMs?, onError? }`）です。`updateOptions` が受け付けるキーの内容が後から変わると book に適用します。比較は値で行うので、毎回作り直すオブジェクトリテラルでもかまいません。構築時専用のキー（`strictFontCheck`、`analyzer`、`pageSize` など）の変化は無視し、book は作り直しません。新しい book でやり直すには、コンポーネントに新しい `key` を与えてください。`updateOptions(patch)` は `options` のスナップショットを同期的に更新し、最後の変更が落ち着くとスナップショットを book が適用したオプションに戻すので、拒否された変更は巻き戻ります。`onError` があれば適用の失敗はそこに報告され、`updateOptions` は reject せずに解決します。
- `useSpread(layout, { spreadMode?, enableKeyboard?, turnDurationMs?, preservePosition?, onIndexChange? })` はレイアウトを移動します。`index` / `count` はナビゲーション位置（`spreadMode: 'single'` ではページ、それ以外は見開き）、`spreadIndex` / `spreadCount` は画面にあるレイアウト上の見開きです。`pageCount`、`spread`、`firstPage`、`singleSide`、`turning` は表示中のページを表します。`goTo(index, { animate? })` は `0 … count − 1` に丸め、整数でなければ `RangeError` を投げ、レイアウトがなければ何もせず、ページ送りの途中ならその行き先を置き換えます。`preservePosition: true` にすると、置き換えたレイアウトを旧レイアウトが表示していた本文の位置で開きます。ほかに `indexOfPage(pageIndex)`、`anchorAt(index)`、`next`、`prev`、`refresh` があります。
- `useImageOverlay(layout, { spreadIndex, defaultWidth?, defaultHeight?, defaultX?, defaultY?, margin?, onReflow? })` は見開きごとのドラッグ・リサイズ可能な画像オーバーレイを管理し、`ChapterLayout.setImages` で周囲の本文を流し直します。`imagesBySpread`、`currentImages`、`hasOverlays`、`addOverlay(overrides?)`、`removeOverlay(id)`、`updateOverlay(id, rect)`、`clearOverlays(spreadIndex?)`、`onOverlayPointerDown(id, event)`、`onResizePointerDown(id, event)` を返します。`onReflow(spread)` は変更後に流し直した見開きごとに呼ばれます。`useSpread().refresh()` と組み合わせてください。
- `useAnnotations({ key, storage?, debounceMs?, onAnnotationsChange?, onError? })` はハイライト / しおり / コメントを永続化します。`{ annotations, add, remove, update, clear }` を返します。`onAnnotationsChange(next)` は `add` / `remove` / `update` / `clear` の直後に同期的に呼ばれます（初回の復元と `key` の変更時、空のリストへの `clear()` のような変化のない操作では呼ばれません）。変更ごとにサーバへ送るのに便利です。`debounceMs`（既定 250）は最後の変更から書き込みまでの待ち時間で、保留中の書き込みはページ非表示、`key` の変更、アンマウント時に書き出されます。例外を投げたストレージは `storage-read-failed` / `storage-write-failed`、読めないデータは `storage-corrupt`（最初の変更まで上書きしません）として `onError` に報告します。`onError` がなければ `console.warn` に出します。
- `useReadingPosition({ key, storage?, debounceMs?, onPositionChange?, onError? })` は `{ position, save, clear }` を返し、`save` / `clear` の直後に `onPositionChange(next | null)` を呼びます。`debounceMs` と `onError` は `useAnnotations` と同じです。
- `useLibrary({ volumes, initialVolumeId?, onVolumeChange? })` は `{ list, volume, volumeIndex, next, prev, selectVolume(id) }` を返します。`next` / `prev` / `selectVolume` が呼ばれるまで、現在の `volumes` に `initialVolumeId` が含まれていればそれを優先します。マウント後に届いたリストでも同じです。現在の巻がリストから消えたときは先頭の巻に戻り、その巻を引数に `onVolumeChange` を呼びます。`MejiroShelf` は `MejiroReader` の外でも使えます。`mejiro-reader.css` が単独の `.mejiro-shelf` に既定の配色を宣言しています。

### MejiroReader の型

- **`MejiroReaderProps`** — 4 つのソースモードの判別共用体で、複数のソースを同時に渡すと TypeScript が拒否します: `MejiroReaderParsedProps`（`epub: EpubBook | null`）、`MejiroReaderUrlProps`（`epubUrl: string`）、`MejiroReaderPickerProps`（ソースなし。リーダーがドロップゾーン / ファイル選択を出す）、`MejiroReaderManuscriptProps`（`manuscript: readonly ManuscriptChapter[]`、`dialect?: ManuscriptDialect`）。どの要素も、それ以外のすべてを持つ **`MejiroReaderCommonProps`** を拡張します。ホストが渡すソース（`epub` か `manuscript`）は本を所有するので、そのときリーダーは `enableDropZone` があってもドロップゾーンと「開く」ボタンを隠します。
- **`MejiroReaderCommonProps.options`** — `Partial<BookOptions>`。book のオプションで、未指定のフィールドは `DEFAULT_BOOK_OPTIONS` になります。構築時専用のキー（`strictFontCheck`、`analyzer`、`wordAwareBreaking`、`keepWholePos`、`keepWholePenalty`、`breakCost`、`pageSize`、`onError`）はリーダーのマウント時に一度だけ読みます。
- **位置 props** — `chapterIndex` / `onChapterIndexChange`、`spreadIndex` / `onSpreadIndexChange`、`anchor` / `onAnchorChange`。値の prop だけなら開始位置で、対応する `on…Change` ハンドラを渡すとその値について controlled になります。`spreadIndex` は単ページ表示でも常にレイアウト上の見開きを数えます。[React & Vue](./08-react-and-vue.md#読書位置の-props) を参照してください。
- **`MejiroReaderHandle`** — `ref` から得る命令的ハンドル: `goToSpread`、`next`、`prev`、`goToChapter`、`getSpreadPosition(): SpreadPosition`、`goToAnchor(): Promise<void>`、`getAnchor()`、`getVisibleRange(): ReadingAnchorRange | null`、`updateOptions(): Promise<void>`、`subscribe()`。
- **`MejiroReaderEventMap`** — `subscribe` のリスナー: `spreadIndexChange(event: MejiroReaderSpreadIndexChangeEvent)`（`{ chapterIndex, spreadIndex }`）、`turnStart(event: MejiroReaderTurnStartEvent)`（`{ from }`）、`turnEnd(event: MejiroReaderTurnEndEvent)`（`{ to }`）、`chapterFinished(event: MejiroReaderChapterFinishedEvent)`（`{ chapterIndex }`）。イベント名は対応する prop 名から `on` を除いたものです。
- **`SpreadPosition`** — `getSpreadPosition()` が返す `{ chapterIndex, spreadIndex, spreadCount, pageCount }`。
- **`ReadingAnchorRange`** — `getVisibleRange()` が返す `{ start: ReadingAnchor; end: ReadingAnchor }`。
- **`MejiroReaderSettingsSlot`** — render prop `renderSettings` に渡す文脈: `{ settings: EditableSettings; update; open; toggle }`。
- **`MejiroTheme`** — `MejiroThemeName`、またはプリセットに独自の CSS 変数を重ねる `{ name, override }`。**`MejiroThemeName`** は `'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto'`。
- **`MejiroReaderMode`** — `'paginated' | 'scroll'`。**`MejiroSpreadMode`** — `'double' | 'single' | 'auto'`。`'auto'` はリーダーが解決し、`useSpread` / `MejiroSpread` には `ResolvedSpreadMode`（`'single' | 'double'`）を渡します。**`MejiroReaderFit`** — `'fill' | 'width'`。**`PageNumberDisplay`** — `'both' | 'right' | 'left' | 'none'`。**`MejiroChapterNavMode`** — `'select' | 'panel' | 'both' | 'none'`。

**`MejiroReader` の表示系 props** -- `theme?: MejiroTheme`（リーダーのルートに `data-mejiro-theme` として反映され、同梱の CSS がそれを読んで配色を切り替える）、`mode?: MejiroReaderMode`（既定 `'paginated'`。`'scroll'` は全ページを縦スクロールに並べる）、`spreadMode?: MejiroSpreadMode`（既定 `'double'` / `'single'` / `'auto'`）、`fit?: MejiroReaderFit`（既定 `'fill'` / `'width'`）、`pageNumbers?: PageNumberDisplay`、UI 文字列の `locale?: MejiroLocale` と `messages?: Partial<MejiroMessages>`、ヘッダの `title?` / `subtitle?` / `logo?`（ヘッダはタイトルかロゴがあるときだけ描く）、設定パネルの本体を独自フォームに置き換える `renderSettings?: (slot: MejiroReaderSettingsSlot) => ReactNode`。クロムの切り替えは `showSettings`（既定 `true`）、`showPageIndicator`（既定 `true`）、`showStats`（既定 `false`）、`showImageOverlayButton`（既定 `false`）、`chapterNavMode`（`'none'` で章ナビゲーションを隠す）、`enableDropZone`、`enableKeyboard`（フォーカスしたリーダーのルートでの矢印キーと Escape）、`enableSurfaceTap` です。

**`MejiroReader` の原稿ソース** -- `epub` / `epubUrl` に並ぶ 4 つ目のソースモードです。`manuscript: ManuscriptChapter[]` と `dialect?: ManuscriptDialect` を渡すと、リーダーは EPUB の ZIP を経由せずに章を直接描画します。

**`MejiroReader` の `annotations` prop** -- `ReaderAnnotation`（`{ chapterIndex, start, end, color? }`）の配列を渡すと、現在の章のエントリを `ChapterLayout.selectionRects` でハイライト矩形に変換し、`MejiroSpread` に渡します。通常は `useAnnotations` と組み合わせ、その `Annotation` はこの形を満たします。

**`MejiroScrollView`** -- `mode="scroll"` の背後にあるページ列です。`MejiroSpread` と同じくハイライトと画像オーバーレイを描きます。`selectionRects` は各エントリの `pageIndex` が指すページに塗られ、`images`（`spreadIndex` の見開きのオーバーレイ）はそれぞれ中心を含むページに描かれ、ハンドルには `onImagePointerDown`、`onImageResizePointerDown`、`onImageClose` を使います。新しい `images` 配列を渡すことが、流し直したページをビューに読み直させる合図にもなります。`useImageOverlay` の `currentImages` は変更のたびに新しい配列になります。`onVisiblePageChange(pageIndex, source)` は表示中のページを報告します。`pageNumbers?: PageNumberDisplay`（既定 `'both'`）は、どのページに番号を印字するかを `pageNumberFor` と同じ規則で選びます。

**`MejiroSpread`** -- `SpreadResult` を 2 ページ、`spreadMode: 'single'` では 1 ページ（`singleSide` でページを選ぶ）として描きます。`layout` を渡すと、ページサイズと組版設定を `layout.geometry` / `layout.typography` から取ります。明示した props が優先します。`anchorAtCoord?: (point: SpreadPoint) => InChapterAnchor | null` がテキスト選択を解決します。

**`MejiroNotationHighlighter`** -- 原稿記法（ルビ / 圏点 / 縦中横 / em / strong / link / footnote）を textarea 背後のオーバーレイで色分け表示するコンポーネントです。props は `{ value, onValueChange, dialect?, wrapperClassName?, wrapperStyle? }` と textarea の属性で、属性は（ネイティブの `onChange` も含めて）textarea に届きます。トークンごとの色は `.mejiro-notation-token[data-token="…"]` に CSS を当てて変えます。

**`MejiroPageView`** -- 推奨の低レベルページ描画コンポーネントです。`ChapterLayout` の `PageResult` を描画し、CSS の vertical-rl とスロットベースの描画を自動で切り替えます。

Props:

- `result: PageResult` -- 必須
- `layout?: ChapterLayout` -- `fontFamily` と `lineSpacing` の既定値の出どころ
- `fontFamily?: string` -- CSS のフォントファミリー（スロットベース描画用）
- `lineSpacing?: number` -- 行間の倍率（スロットベース描画用）
- `slotMode?: boolean` -- スロットベース描画を強制する（ページに画像があるときに指定）
- `className?: string`
- `style?: CSSProperties`

**`MejiroPage`** -- 低レベル。CSS の `writing-mode: vertical-rl` で `RenderPage` を描画します。

Props:

- `page: RenderPage` -- 必須
- `className?: string`
- `style?: CSSProperties`

段落のクラスは共有ヘルパ `paragraphClassName(kind, headingLevel)` が生成します。そのため blockquote / sceneBreak / pre / figure の段落にも、静的レンダラと同じ `mejiro-paragraph--*` 修飾子が付きます。

### MejiroManuscriptEditor の型

- **`ManuscriptAutosaveDraft`** — 自動保存のペイロード: `{ title, author, cover: File | null, chapters }`。
- **`ManuscriptPreviewProps`** — `previewProps` でライブプレビューに渡す `MejiroReader` の props の部分集合。
- `chapters` / `onChaptersChange`、`title` / `onTitleChange`、`author` / `onAuthorChange`、`cover` / `onCoverChange` は、リーダーの位置 props と同じ規則に従います。値は開始値で、ハンドラを渡すと controlled になります。

### MejiroEditor の型

- **`ExportPolicy`** — `{ download?, transform?, watermark? }`。次の順で適用します: `watermark`（`EditableEpub.export()` に渡すので、透かしが入るのは書き出したコピーだけ）→ `transform`（`(bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>`。バイト列を置き換える）→ `download`（`false` ならブラウザのダウンロードを省く）。`showExportButton` で書き出しボタンを表示します。`previewProps` はプレビューのリーダーに `ManuscriptPreviewProps` を渡し、そのタイトルの既定値は本のタイトルです。

---

## `@libraz/mejiro-vue` — Vueコンポーネント

```bash
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

peer dependency は `vue >= 3.3` です。

Vue パッケージは React パッケージと同じ名前を同じ形でエクスポートします。違いは以下に挙げます。`MejiroError`、`MejiroErrorCode`、`MejiroWarning`、`MejiroWarningCode`、`MejiroStorage`、`ManuscriptChapter`、`ReadingAnchor` は `@libraz/mejiro` からの再エクスポートで、`enMessages`、`jaMessages`、`resolveMessages`、`formatMessage` は `useI18n` と一緒にエクスポートしています。

### コンポーネントと props 型

各コンポーネントは `InstanceType<typeof Component>['$props']` として宣言した props の別名をエクスポートします。そのためコンポーネント自身の `props` ブロック（`default` の値を含む）に常に追従し、実行時の既定値が `undefined` のフィールドもすべて省略可能に見えます。

| コンポーネント | props の別名 |
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
| `MejiroImagePlaceholder` | `MejiroImagePlaceholderProps` |
| `MejiroI18nProvider` | `MejiroI18nProviderProps` |
| `MejiroManuscriptEditor`（プレビューへの受け渡し） | `ManuscriptPreviewProps` |

props とイベントは 1 つの規則で React と対応します。React の `onXxxChange` は Vue の `update:xxx` イベントなので `v-model:xxx` で結べます（`MejiroReader` の `v-model:chapter-index`、`v-model:spread-index`、`v-model:anchor`、`MejiroNotationHighlighter` の `v-model:value`、`MejiroSettingsPanel` の `v-model:settings`、`MejiroManuscriptEditor` の `v-model:chapters`）。それ以外の React の `onXxx` は kebab-case のイベント `xxx`（`chapter-select`、`volume-select`、`chapter-finished`、`page-read`、`image-pointer-down` など）で、ペイロードは型付きで emit されます。コンポーネントは、親がその `update:xxx` イベントを購読しているときにその値について controlled になります。React の `className` / `style` は透過属性の `class` / `style`、React の `xxxClassName` は Vue の `xxxClass`、`children` は既定スロット、React のノード prop は名前付きスロットです。`MejiroSpread` の `renderPageHeader` / `indicator` は `pageHeader` / `indicator` スロット、`MejiroReader` の `renderSettings`、`logo`、`fallback` は `settings`、`logo`、`fallback` スロットです（`renderEpubStatic()` の出力は `fallback` スロットに `v-html` で入れます）。

リーダーのソースの型名は Vue にもあります（`MejiroReaderCommonProps`、`MejiroReaderParsedProps`、`MejiroReaderUrlProps`、`MejiroReaderPickerProps`、`MejiroReaderManuscriptProps`）。ただし `MejiroReaderProps` は判別共用体ではなく 1 つのオブジェクト型なので、ソースの props は型の上では排他になりません。`epub` は `epubUrl` に優先し、`manuscript` はどちらとも併用できません。

Vue の `MejiroShelf` はジェネリックではありません。`defineComponent` は型引数を `h()` や `.ts` の描画関数に運べないため、`volumes` は `readonly VolumeInfo[]`、`volume-select` のペイロードは `VolumeInfo<unknown>` になります。React の `MejiroShelf<T>` なら推論される `meta` は、ハンドラの中で絞り込んでください。

`ReaderAnnotation` と `SelectionRect` は React と同じくエクスポートしています。`MejiroNotationHighlighter` は属性を textarea に渡し（`inheritAttrs: false`）、ラッパーには `wrapperClass` / `wrapperStyle` を取ります。

### コンポーザブル

Vue のコンポーザブルは React のフックと同じ引数を取り、同じキーを返し、オプション / 戻り値の型名も同じです: `useEpub`、`useEditableEpub`、`useEpubProject`、`useLibrary`、`useManuscriptDraft`、`useManuscriptLayout`、`useAnnotations`、`useMejiroBook`、`useChapterLayout`、`useSpread`、`useReadingPosition`、`useI18n`、`useImageOverlay`。型は `UseEpubOptions` / `UseEpubReturn`、`FetchEpubOptions`、`UseEditableEpubOptions` / `UseEditableEpubReturn`、`EditableEpubSelection`、`UseEpubProjectOptions` / `UseEpubProjectReturn`、`UseLibraryOptions` / `UseLibraryReturn`、`VolumeInfo`、`UseManuscriptDraftOptions` / `UseManuscriptDraftReturn`、`UseManuscriptLayoutOptions` / `UseManuscriptLayoutReturn`、`ChapterLayoutRecomputeOptions`、`UseAnnotationsOptions` / `UseAnnotationsReturn`、`Annotation`、`UseMejiroBookOptions` / `UseMejiroBookReturn`、`UseChapterLayoutOptions` / `UseChapterLayoutReturn`、`UseSpreadOptions` / `UseSpreadReturn`、`ResolvedSpreadMode`、`GoToOptions`、`UseReadingPositionOptions` / `UseReadingPositionReturn`、`UseI18nOptions`、`MejiroLocale`、`MejiroMessages`、`UseImageOverlayOptions` / `UseImageOverlayReturn`、`ImageOverlayRect`、`MultiImageItem` です。

リアクティブな入力は `MaybeRefOrGetter<T>`（素の値、`Ref`、getter のいずれか）を取り、`toValue()` で読むので変化に追従します。コンポーザブルが管理する状態は読み取り専用の `Ref` / `ComputedRef` で返します。`pendingRestore` は書き込める `Ref<InChapterAnchor | null>` です。`useMejiroBook(options, hookOptions?)` は `MaybeRefOrGetter<BookOptions>` を取り、実行時に変えられるキーの変化を `updateOptions` で適用し、構築時専用のキーは React と同じく無視します。`useLibrary` は、リアクティブな `volumes` 配列の再代入だけでなく、その場での変更でも現在の巻を解決し直します。

`MejiroBook`、`ChapterLayout`、`EditableEpub`、`EpubProject` は、生のインスタンスをキーにした内部状態を持ちます。Vue バインディングはこれらをリアクティブな状態（`reactive()` のオブジェクト、深い `ref()`、コンポーネントの props）に入れたまま受け取り、コアを呼ぶ前に生のインスタンスに戻します。コンポーザブルが作るインスタンス（`useMejiroBook` の book、`useChapterLayout` / `useManuscriptLayout` のレイアウト、`useEditableEpub` のエディタ、`useEpubProject` の `buildProject()` の結果）は `markRaw` 済みです。リアクティブな状態に入れたインスタンスでホストが直接コアの API を呼ぶとき（そのメソッドでも、それを引数に取る関数でも）は、`toRaw(instance)` を通してください。

### `MejiroReader`

props は React の `MejiroReaderCommonProps` とソースの props を Vue の props として宣言したものです: `theme`、`mode`、`spreadMode`、`fit`、`pageNumbers`、`chapterNavMode`、`locale`、`messages`、`title`、`subtitle`、`showSettings`、`showPageIndicator`、`showStats`、`showImageOverlayButton`、`enableDropZone`、`enableKeyboard`、`enableSurfaceTap`、`fetchOptions`、`fetchEpub`、`limits`、`annotations`、`options`、`pageGeometry`、`fonts`、そして位置 props の `chapterIndex`、`spreadIndex`、`anchor` とその `v-model` イベントです。非有限の位置は `0` として読み、小数は切り捨てます。React と同じく警告は出しません。

スロット: `settings`（`MejiroReaderSettingsSlot` の文脈を受け取る）、`header`、`logo`、`dropZone`、`fallback`、`loading`。

イベント: `load`、`error`、`update:chapterIndex`、`update:spreadIndex`、`update:anchor`、`page-read`、`chapter-finished`。`MejiroReaderEventMap` は命令的な `MejiroReaderHandle.subscribe()` のペイロードを表し、イベントの型は `MejiroReaderSpreadIndexChangeEvent`、`MejiroReaderTurnStartEvent`、`MejiroReaderTurnEndEvent`、`MejiroReaderChapterFinishedEvent` です。`MejiroReaderHandle` は React と同じメソッド（`goToSpread`、`next`、`prev`、`goToChapter`、`getSpreadPosition(): SpreadPosition`、`goToAnchor`、`getAnchor`、`getVisibleRange(): ReadingAnchorRange | null`、`updateOptions`、`subscribe`）を公開します。テーマ、モード、章ナビゲーションの型も同じです: `MejiroTheme`、`MejiroThemeName`、`MejiroReaderMode`、`MejiroSpreadMode`、`MejiroReaderFit`、`PageNumberDisplay`、`MejiroChapterNavMode`、`MejiroReaderSettingsSlot`。

Vue の `MejiroScrollView` は React と同じ `selectionRects`、`spreadIndex`、`images` の props を取り、React がコールバック props を取るところで `update:visiblePage`、`image-pointer-down`、`image-resize-pointer-down`、`image-close` を emit します。

### `MejiroManuscriptEditor` と `MejiroEditor`

`ManuscriptAutosaveDraft`、`ManuscriptPreviewProps`、`ExportPolicy` は React パッケージと同じ形です。`MejiroManuscriptEditor` は `v-model:title`、`v-model:author`、`v-model:cover`、`v-model:chapters` を結べます。

### 補助の型

Vue のバレルはコンポーネントと一緒に次の型を React と同じ形でエクスポートしているので、Vue だけのホストが React パッケージから import する必要はありません:

- `MejiroChapterNavVariant` — `'select' | 'panel'`。`MejiroChapterNav` の描画レイアウト
- `EditableSettings` と `FontChoice` — `MejiroSettingsPanel` が編集する値と選択肢の型
- `PageHeaderData` — `MejiroSpread` が描く柱の `{ title?, pageNumber? }`
- `SpreadPosition` — `MejiroReaderHandle.getSpreadPosition()` が返す `{ chapterIndex, spreadIndex, spreadCount, pageCount }`
- `ImageOverlayRect` — コアのオーバーレイ矩形。`useImageOverlay` を使う側が 1 か所から得られるよう再エクスポートしている

**`MejiroPageView`** -- 推奨の低レベルページ描画コンポーネントです。`ChapterLayout` の `PageResult` を描画し、CSS の vertical-rl とスロットベースの描画を自動で切り替えます。

Props:

- `result: PageResult` -- 必須
- `layout?: ChapterLayout` -- `fontFamily` と `lineSpacing` の既定値の出どころ
- `fontFamily?: string` -- CSS のフォントファミリー（スロットベース描画用）
- `lineSpacing?: number` -- 行間の倍率（スロットベース描画用）
- `slotMode?: boolean` -- スロットベース描画を強制する（ページに画像があるときに指定）

**`useImageOverlay(layout, options)`** -- ドラッグ・リサイズできる画像オーバーレイを管理し、本文を自動で流し直すコンポーザブルです。`layout` は `MaybeRefOrGetter<ChapterLayout | null>`、`options.spreadIndex` は `MaybeRefOrGetter<number>` で、その他のオプションは一度だけ読みます。React のフックと同じキーを返し、`imagesBySpread`、`currentImages`、`hasOverlays` は ref です。

**`MejiroPage`** -- 低レベル。CSS の `writing-mode: vertical-rl` で `RenderPage` を描画します。

Props:

- `page: RenderPage` -- 必須

段落のクラスは React のコンポーネントと同じ共有ヘルパ `paragraphClassName(kind, headingLevel)` が生成します。そのため blockquote / sceneBreak / pre / figure の段落には、両フレームワークと `renderEpubStatic` の出力で同じ `mejiro-paragraph--*` 修飾子が付きます。

---

[ドキュメント目次に戻る](./README.md)
