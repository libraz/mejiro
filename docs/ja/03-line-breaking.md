# 改行処理

このページでは、mejiro の改行アルゴリズムを説明します。禁則処理、ぶら下げ、クラスタ処理もここで扱います。

## 1. 貪欲 O(n) アルゴリズム

`computeBreaks` は、禁則処理のために必要な範囲だけ後方探索する、単一パスの貪欲アルゴリズムです。

### 動作の仕組み

1. **前方走査** -- 文字を左から右へ順に走査し、送り幅を累積します。
2. **オーバーフロー検出** -- 累積幅が `lineWidth` を超えた時点で改行が必要になります。
3. **後方探索** -- オーバーフローした位置から戻りながら、改行できる位置を探します。次の条件をすべて満たす位置を有効な改行位置とします。
   - **禁則行末チェック** -- 改行位置の文字が行末禁則文字でないこと。
   - **禁則行頭チェック** -- 改行位置の直後の文字が行頭禁則文字でないこと。
   - **クラスタ境界チェック** -- 同じクラスタ ID に属する文字間で改行しないこと。
4. **強制改行** -- 有効な位置が見つからない場合は、その行で最も後ろのクラスタ境界で改行します。行内にクラスタ境界が 1 つもない場合はオーバーフロー位置で改行します。第6節を参照。
5. **幅の再計算** -- 改行後、新しい行ですでに消費している文字の累積幅を計算し直します。

### 時間計算量

計算量は O(n)（n は文字数）です。各文字は、前方走査で 1 回、後方探索で最大 1 回参照されます。`lineStart` は単調に進むため、前の行に確定した文字を何度も見直すことはありません。

### トークン境界の優先

`tokenBoundaries` を指定すると、後方探索ではトークン境界での改行を優先します。有効な候補の中にトークン境界がない場合は、禁則条件を満たす最も近い位置にフォールバックします。

### 語境界の優先

トークン境界の有無にかかわらず、行の充填率が最も高くなる「最も近い有効な位置」を選びます。手前の空白を優先するのは、最も近い位置で改行すると語の途中で切れてしまう場合、すなわちその前後の文字がどちらも空白区切りの文字体系に属する場合だけです。CJK は任意の文字間で改行できるため、文中の空白が改行位置を行末から引き離すことはありません。

---

## 2. LayoutInput

`LayoutInput` インターフェースは、改行アルゴリズムに必要なすべてのパラメータを定義します。

```ts
interface LayoutInput {
  text: Uint32Array;                      // Unicode codepoints
  advances: Float32Array;                 // Per-character advance widths (px)
  lineWidth: number;                      // Available line width (px)
  lineWidths?: Float32Array;              // Per-line widths overriding lineWidth
  mode?: KinsokuMode;                     // 'strict' (default) | 'loose'
  enableHanging?: boolean;                // Default: true
  clusterIds?: Uint32Array;               // Characters with same ID cannot be split
  rubyAnnotations?: RubyAnnotation[];       // Core-level ruby preprocessing (see 04-ruby.md)
  tokenBoundaries?: Uint32Array | readonly number[]; // Preferred break positions
  breakPenalties?: Uint8Array;            // Per-position break cost (see section 8)
  breakCost?: BreakCostOptions;           // Weights for the penalty search
  kinsokuRules?: KinsokuRules;            // Custom prohibition rules
}
```

| フィールド          | 必須 | デフォルト | 説明                                                               |
|--------------------|------|----------|--------------------------------------------------------------------|
| `text`             | はい | --       | Unicode コードポイントの `Uint32Array`。文字列からの変換には `toCodepoints()` を使用します。 |
| `advances`         | はい | --       | 文字ごとの送り幅（ピクセル単位）。`text` と同じ長さである必要があります。 |
| `lineWidth`        | はい | --       | 行の最大幅（ピクセル単位）。                                        |
| `lineWidths`       | いいえ | --     | 行ごとの幅（ピクセル単位）。i 行目は `lineWidths[i]` を使い、配列長を超えた行は `lineWidth` にフォールバックします。列ごとに使える高さが変わる画像排除で使われます。 |
| `mode`             | いいえ | `'strict'` | 禁則処理モード。第4節を参照。                                     |
| `enableHanging`    | いいえ | `true`   | ぶら下げ組みを有効にするかどうか。第5節を参照。                     |
| `clusterIds`       | いいえ | --       | 分割不可の文字グループ用クラスタ ID。第6節を参照。                  |
| `rubyAnnotations`  | いいえ | --       | コアレベルのルビ注釈。改行処理の前にルビの前処理が実行されます。                 |
| `tokenBoundaries`  | いいえ | --       | 各トークンの末尾コードポイントのインデックス。アルゴリズムはこれらの位置での改行を優先します。形態素解析器の出力から変換するには `tokenLengthsToBoundaries()` を使用します。 |
| `breakPenalties`   | いいえ | --       | 各インデックスの後ろで改行するコスト。コードポイントごとに 1 要素。後方探索が範囲を区切ったコスト探索に切り替わり、`tokenBoundaries` に優先します。第8節を参照。 |
| `breakCost`        | いいえ | --       | そのコスト探索の重み。`breakPenalties` がない場合は無視されます。   |
| `kinsokuRules`     | いいえ | --       | カスタム禁則ルール。組み込みルールを完全に置き換えます。             |

### 最小限の使用例

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
});
```

### 全オプション指定の使用例

```ts
import { computeBreaks, toCodepoints, buildKinsokuRules } from '@libraz/mejiro';

const customRules = buildKinsokuRules({
  lineStartProhibited: [0x3001, 0x3002], // 、。
  lineEndProhibited: [0x300c],           // 「
});

const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  mode: 'loose',
  enableHanging: true,
  tokenBoundaries: new Uint32Array([4, 10]),
  kinsokuRules: customRules,
});
```

---

## 3. BreakResult

`computeBreaks` 関数は `BreakResult` を返します:

```ts
interface BreakResult {
  breakPoints: Uint32Array;             // Indices of last char before each break
  hangingAdjustments?: Float32Array;    // Hanging overhang per line (px), 0 if none
  effectiveAdvances?: Float32Array;     // Per-char advances after ruby distribution
  lineWidths?: Float32Array;            // Width actually used per line
}
```

### breakPoints

`breakPoints` の各値は、その行の最後の文字のインデックスです。改行位置より後の文字は次の行の先頭になります。

例えば、長さ15のテキストで `breakPoints = [4, 9]` の場合:

- 1行目: 文字 0..4（インデックス 0 から 4 まで、両端を含む）
- 2行目: 文字 5..9
- 3行目: 文字 10..14（残り）

### hangingAdjustments

`enableHanging` が `true`（デフォルト）の場合に存在します。各要素は `breakPoints` の各行に対応します。ゼロでない値は、その行の最後の文字が行端からはみ出しているピクセル数を示します。

### effectiveAdvances

`rubyAnnotations` が指定された場合にのみ存在します。ルビ幅の分配後の文字ごとの送り幅を含み、元の `advances` 入力とは異なる場合があります。

---

## 4. 禁則処理

禁則処理は、句読点や括弧などが行頭・行末に来ないようにする日本語組版のルールです。mejiro では 2 つのモードを選べます。

### strict モード（デフォルト）

**行頭禁則文字**（`getDefaultKinsokuRules().lineStartProhibited` の全文字）:

| カテゴリ           | 文字                                        |
|--------------------|---------------------------------------------|
| 閉じ括弧           | ）〕］｝〉》」』】〗〙〛                    |
| 閉じ引用符         | ’”〟                                        |
| 句読点             | 、。，．・：；？！                          |
| ダッシュ・三点リーダ | ‥…〜—―                                     |
| 小書き仮名         | ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ |
| 長音記号           | ー                                          |
| 繰り返し記号       | 々〻ヽヾゝゞ                                |

**行末禁則文字**（`getDefaultKinsokuRules().lineEndProhibited`）:

| カテゴリ           | 文字                                        |
|--------------------|---------------------------------------------|
| 開き括弧           | （〔［｛〈《「『【〖〘〚                    |
| 開き引用符         | 〝‘“                                         |

**分割禁止ペア**（`getDefaultKinsokuRules().unbreakablePairs`）— 2 文字の間では改行しません: `‥‥`、`……`、`——`、`――`。

### loose モード

strict モードを少し緩め、次の文字の行頭配置を許可します。

| カテゴリ           | 文字                                        |
|--------------------|---------------------------------------------|
| 小書き仮名         | ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ |
| 長音記号           | ー                                          |

狭い段組みで strict 禁則だと空きが目立つ場合に向いています。小書きのカ・ケには非対称があり、カタカナの `ヵヶ` は loose モードで行頭に置けますが、ひらがなの `ゕゖ` は両モードとも禁則のままです。括弧・引用符・句読点・ダッシュ・繰り返し記号など、strict モードで禁則となるその他の文字は loose モードでも禁則のままです。

### 改行判定ロジック

位置 `pos` の後での改行は、以下のすべてが満たされる場合に有効です:

1. 位置 `pos` の文字が行末禁則文字**でない**こと。
2. 位置 `pos + 1` の文字が（現在のモードにおいて）行頭禁則文字**でない**こと。
3. 改行がクラスタを分割しないこと（位置 `pos` と `pos + 1` の文字が異なるクラスタ ID を持つか、クラスタ ID が指定されていないこと）。

これは `canBreakAt()` で実装されています:

```ts
function canBreakAt(
  text: Uint32Array,
  pos: number,
  clusterIds?: Uint32Array,
  mode?: KinsokuMode,
  rules?: KinsokuRules,
): boolean;
```

### strict モードと loose モードの比較例

テキスト「あいうえおっかきくけこ」（11文字）を、各文字16px幅、行幅80px（5文字分）で改行する場合を考えます。

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいうえおっかきくけこ');
const advances = new Float32Array(11).fill(16);

// strict モード: っ（小さいつ）は行頭禁則文字。
// インデックス4の後で単純に改行すると（あいうえお）、2行目の先頭がっになる。
// アルゴリズムはこれを避けるためインデックス3まで後退する。
const strict = computeBreaks({ text, advances, lineWidth: 80, mode: 'strict' });
// strict.breakPoints → [3, 8]
// 1行目: あいうえ (4文字), 2行目はおっ...から開始

// loose モード: っ は行頭に許容される。
// インデックス4で改行できる。
const loose = computeBreaks({ text, advances, lineWidth: 80, mode: 'loose' });
// loose.breakPoints → [4, 9]
// 1行目: あいうえお (5文字), 2行目はっか...から開始
```

### カスタム禁則ルール

`buildKinsokuRules()` を使用して、事前計算されたルックアップセットを持つカスタムルールを作成できます:

```ts
import { buildKinsokuRules, computeBreaks, toCodepoints } from '@libraz/mejiro';

const rules = buildKinsokuRules({
  lineStartProhibited: [0x3001, 0x3002, 0xff0c, 0xff0e], // 、。，．
  lineEndProhibited: [0x300c, 0x300e],                     // 「『
});

const result = computeBreaks({
  text: toCodepoints('あいう「えお'),
  advances: new Float32Array(6).fill(16),
  lineWidth: 48,
  kinsokuRules: rules,
});
```

`kinsokuRules` を指定すると、組み込みルールが**完全に置き換え**られます。デフォルトを拡張したい場合は、`getDefaultKinsokuRules()` を起点として使用してください。

---

## 5. ぶら下げ組み

ぶら下げ組みは、特定の句読点を次の行に送る代わりに行端からはみ出させる機能です。デフォルトで有効です。

### 対象文字

| 文字 | Unicode | 名称                  |
|------|---------|-----------------------|
| 。   | U+3002  | 句点                  |
| 、   | U+3001  | 読点                  |
| ．   | U+FF0E  | 全角ピリオド          |
| ，   | U+FF0C  | 全角コンマ            |

### 動作の仕組み

累積幅が `lineWidth` を超え、はみ出した文字がぶら下げ対象の場合、アルゴリズムはその文字を追加する前に行が収まっていたかどうか（つまり `accWidth - advance <= lineWidth`）を確認します。収まっていた場合、その文字は行端からはみ出すことが許可され、はみ出し量が `hangingAdjustments` に記録されます。

### ぶら下げ有効時の例（デフォルト）

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80, // ちょうど5文字分
  enableHanging: true, // デフォルト
});
// インデックス5の「、」はオーバーフローするが、ぶら下げが許可される。
// result.breakPoints → [5]
// result.hangingAdjustments → Float32Array [16]
// 1行目: あいうえお、 (「、」が行端から16pxはみ出す)
// 2行目: かきくけこ
```

### ぶら下げ無効時の例

```ts
const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  enableHanging: false,
});
// 「、」はぶら下げできないため 2 行目の先頭に来るが、「、」は行頭禁則文字なので、
// 後方探索によって改行位置がもう 1 つ手前へ移動する。
// result.breakPoints → [3, 8]
// 1行目: あいうえ (4文字)
// 2行目: お、かきくけ
// 3行目: こ
```

注意: `enableHanging` が `false` の場合、結果の `hangingAdjustments` は `undefined` になります。

---

## 6. クラスタ ID

同じクラスタ ID を持つ文字は分割不可の単位を形成し、行をまたいで分割できません。この仕組みは、ルビの前処理で親文字とルビ注釈をまとめるために内部的に使用されますが、直接使用することもできます。

### 動作の仕組み

`clusterIds` 配列は各文字にクラスタ ID を割り当てます。アルゴリズムが位置 `pos` と `pos + 1` の間の改行を検討する際、`clusterIds[pos] === clusterIds[pos + 1]` かどうかを確認します。一致する場合、その位置での改行は禁止されます。

### 使用例

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('ABCDE');
const advances = new Float32Array(5).fill(16);
// ABC をグループ化 (クラスタ 0)、DE をグループ化 (クラスタ 1)
const clusterIds = new Uint32Array([0, 0, 0, 1, 1]);

const result = computeBreaks({
  text,
  advances,
  lineWidth: 48, // 3文字分
  clusterIds,
});
// クラスタ 0 内 (A-B または B-C) やクラスタ 1 内 (D-E) では改行できない。
// 有効な改行位置はインデックス2の後（C と D の間）のみ。
// result.breakPoints → [2]
// 1行目: ABC (48px), 2行目: DE (32px)
```

`clusterIds` を省略した場合、すべての文字間位置が改行候補になります（禁則ルールの制約は適用されます）。

### 行幅より広いクラスタ

利用可能な行幅より広いクラスタは、どの行にも収まりません。この場合だけは強制改行規則が働き、収まる最後の文字でクラスタを分割します。同じクラスタ ID を持つ文字の間で改行が起こるのはこの場合のみです。クラスタが単独で 1 行に収まる限り分割されることはなく、そのために行末禁則文字が行末に来る場合でもクラスタの保持を優先します。

---

## 7. getLineRanges

`getLineRanges` ユーティリティは、コンパクトな `breakPoints` 配列を各行の明示的な `[start, end)` インデックスペアに変換します。

```ts
import { computeBreaks, getLineRanges, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいうえおかきくけこさしすせそ'); // 15文字
const advances = new Float32Array(15).fill(16);
const result = computeBreaks({ text, advances, lineWidth: 80 });
// result.breakPoints → Uint32Array [4, 9]

const lines = getLineRanges(result.breakPoints, text.length);
// lines → [[0, 5], [5, 10], [10, 15]]
```

各ペアは `[start, end)` 形式で、start は包含、end は排他です。これは JavaScript のスライス範囲の標準的な慣例に従っているため、そのまま使用できます:

```ts
for (const [start, end] of lines) {
  const lineChars = text.slice(start, end);
  // 各行を処理...
}
```

---

## 8. 解析を使った改行

第7節までの改行位置は、すべて文字種だけで決まっていました。ここに形態素解析の結果を効かせることもできます。既定は無効です。

### 「語の切れ目で改行する」機能ではありません

日本語の本文は、禁則が許すかぎりどの文字間でも改行して組みます。語の切れ目でだけ改行すると、行末の詰まり方が行ごとにばらつき、本の誌面には見えません。第1節の `tokenBoundaries` 単体の優先を、罰則の代わりではなく罰則と併せて使うものと位置づけているのはこのためです。

解析結果が効くのは、もっと狭い範囲です。分割すれば組版の誤りになる並びを示すこと。そして、残った候補に順位を付けること。この 2 つです。

### 2 段階のオプトイン

| 段階 | 加わるもの | 改行位置への影響 |
|---|---|---|
| `'off'`（既定） | 何もしない。解析自体が走らない | なし |
| `'clusters'` | 分割不可の単位（ハードクラスタ）だけ | 分割すると誤りになる単位を割る位置を除き、変わらない |
| `'full'` | クラスタに加えて位置ごとの改行罰則 | 位置が動く |

まず選ぶなら `'clusters'` です。この段階は改行候補を減らすだけで、しかも減るのは誤った改行を生んでいた位置に限られます。`第1章` を `1` の後ろで切る、英単語を語中で切る、数詞から助数詞を引き離す。そうした位置です。

`'full'` は行の詰め方そのものを変えるので、正しさの問題ではなく組版方針の問題になります。向くのは見出し・キャプション・短い行長です。悪い改行が目立ちやすく、分量でならすこともできないためです。本文に使うかどうかは、意図して決めるハウススタイルの判断になります。

### クラスタ規則が見ているもの

`deriveTypographyHints()` が適用する規則は 4 つです。単位が分割不可になるのは表層の文字種がそれを裏づけたときだけで、品詞だけで決まることはありません。

| 規則 | 例 |
|---|---|
| 数詞とその後ろの助数詞 | `3人` |
| 接頭辞とそれが付く語 | `お名前` |
| 数字列の内部 | `１２３` |
| 日本語中の英単語の内部 | `mejiro` |

この設計により、規則は辞書の網羅性から意図的に切り離されています。解析器が品詞を付けられなかった形態素も、確信を持って付けられた形態素とまったく同じ条件で対象になります。未知語も既知語と同じ挙動になり、辞書のバージョンが変わっても出力は安定します。

同時に、仕組みのうえで対象外になるものもあります。`山田太郎` が 1 トークンか 2 トークンかは辞書の性質であって組版の性質ではないため、人名をまとめて保つことはこれらの規則の役目ではありません。またルビの生成もできません。解析器が返すのは表層形と見出し語であり、読みではないからです。

`maxHardClusterChars`（既定 6）を超えるクラスタは、短くするのではなく破棄します。行に収まらないクラスタは禁則を無視する強制改行で割られてしまうためです。第6節を参照してください。

### クラスタの例

クラスタのヒントは既存の `clusterIds` 入力から `computeBreaks()` に入ります。つまり第6節の仕組みそのままで、配列を手書きする代わりに解析から得るだけです。ルビや縦中横のクラスタと併用する場合は `mergeClusterIds()` でまとめてください。

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいうえ12人'); // 7文字
const advances = new Float32Array(7).fill(16);

// 文字種のみ: 最も近い有効位置が選ばれ、12 が割れる。
const plain = computeBreaks({ text, advances, lineWidth: 80 });
// plain.breakPoints → [4]
// 1行目: あいうえ1、2行目: 2人

// 12人 のクラスタを与えると、その位置は候補から消える。
const hinted = computeBreaks({
  text,
  advances,
  lineWidth: 80,
  clusterIds: new Uint32Array([0, 1, 2, 3, 4, 4, 4]),
});
// hinted.breakPoints → [3]
// 1行目: あいうえ、2行目: 12人
```

### 改行罰則

`breakPenalties` はコードポイントごとに 1 つの値を持ちます。`breakPenalties[i]` はインデックス `i` の「後ろ」で改行するコストで、位置の数え方は `breakPoints` と同じです。`0` は罰則なしで、値が大きいほど強く避けます。

| 値 | 位置 |
|---|---|
| 0 | 文節の最後の形態素の後ろ。最も優先したい位置 |
| 1 | 文節を閉じない形態素境界 |
| 2 | 形態素の内部。文字種規則ならここで切る |
| 3 | 自立語を、後続の助詞・助動詞から切り離す位置 |

罰則があると、後方探索は最も近い有効位置を取るのをやめ、範囲を区切った窓の中で最も安い位置を取ります。位置 `p` の後ろで改行するコストは次のとおりです。

```
penaltyWeight * breakPenalties[p] + shortfallWeight * shortfall(p)
```

`shortfall(p)` は、その行が行長に対してどれだけ短く終わるかを em 単位で表した値です。既定の重み（`penaltyWeight` は `1`、`shortfallWeight` は `1.5`）では、罰則 2 の位置を諦めるのは代わりの位置で空くのが 1.33em 未満のときまで、最大の罰則 3 でも 2em 未満のときまでです。この上限こそが重みの狙いです。縦組みの日本語は文字グリッドの上に組まれ、禁則処理が行をずらすのは通常 1 文字、多くて 2 文字ですから、3 文字分を空けて改行位置を買うのは慣習の許す範囲を超えます。効くのは 2 つの重みの比だけで、両方を同じ倍率にしてもすべてのコストが同じ倍率になるだけで順序は変わりません。片方だけ動かし、もう片方は既定のままにしてください。

窓の幅は `maxBacktrackChars`（既定 6）で、改行処理が文字数に対して線形であり続けるのはこの上限のおかげです。6 は候補が勝てなくなる境目でもあるので、窓を広げても探索時間が増えるだけです。`k` 個手前の位置は少なくとも `0.5k` em を捨てることになり（2 つの位置の間に置ける最も狭い文字が半角文字だからです）、罰則の上限が 3 である以上、勝てるのは `k < 6 * penaltyWeight / shortfallWeight` のあいだだけです。重みが等しければ `k < 6`、既定の重みなら `k < 4` になります。窓の中に有効な位置が 1 つもない場合は第1節の範囲無制限の探索に落ちるので、行頭禁則文字が長く続く場合もこれまでどおり扱えます。

罰則は `tokenBoundaries` と空白優先の両方に優先します。

### 罰則の例

`今日 / は / 良い / 天気 / です / ね` という分割に対して、規則は次に書き出した罰則を与えます。

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('今日は良い天気ですね'); // 10文字
const advances = new Float32Array(10).fill(16);

// 文字種のみ: 入るところまで詰めるため、天気 が割れる。
const plain = computeBreaks({ text, advances, lineWidth: 96 });
// plain.breakPoints → [5]
// 1行目: 今日は良い天、2行目: 気ですね

// 今 日  は 良 い  天 気  で す  ね
const breakPenalties = new Uint8Array([2, 3, 0, 2, 0, 2, 3, 2, 3, 0]);

const hinted = computeBreaks({ text, advances, lineWidth: 96, breakPenalties });
// インデックス5の後ろは行を埋められるが罰則 2 を払う。インデックス4の後ろは
// 罰則なしで 1em 空き、その空きに重み 1.5 が掛かって 1.5。安いほうが選ばれる。
// hinted.breakPoints → [4]
// 1行目: 今日は良い、2行目: 天気ですね
```

この釣り合いは `breakCost` で調整します。解析結果を厳しく守らせたいなら `penaltyWeight` を、行を詰めたいなら `shortfallWeight` を上げます。読まれるのは比だけなので、両方を上げても何も動きません。

### MejiroBook から使う

`MejiroBook` はこの流れ全体を引き受けます。解析器を渡し、段階を選ぶだけです。

```ts
import { createSuzumeAnalyzer } from '@libraz/mejiro/analysis';
import { MejiroBook } from '@libraz/mejiro/book';

const analyzer = await createSuzumeAnalyzer();

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  analyzer,
  wordAwareBreaking: 'clusters',
});
```

optional peer dependency の `@libraz/suzume` が未インストールの場合、`createSuzumeAnalyzer()` の Promise は reject します。この関数を呼ぶこと自体が、その解析器を明示的に要求する行為だからです。黙って品質を落とすほうがよい呼び出し側は、reject を捕まえて解析器なしでブックを構築します。

組み込みにあたっては、次の 4 点を押さえておいてください。

- 解析が走るのはレイアウトの前、段落ごとに 1 回だけです。リサイズ、フォント変更、画像回り込みの再計算は、いずれも最初の結果を再生するだけで再解析しません。解析は対話操作の経路には乗りません。
- 解析器の失敗で落ちるのは品質だけで、可用性は落ちません。解析器がない場合も例外を投げた場合も、その段落は文字種規則だけで、正しくレイアウトされます。コンソールへの通知はブックごとに 1 回であり、段落ごとには出しません。
- 段落ごとにヒントを持たせられます。`BookParagraph.hints` を指定した段落では、ブック側の解析器は参照されません。解析結果を計算済みで持っているときや、その段落だけ別の規則で組みたいときに使います。
- スナップショットのヒントが残るのは、解析器が一致したときだけです。`ChapterLayout.snapshot()` は解析器の identity を記録し、`layoutFromSnapshot()` は復元先のブックが同じ名前・同じバージョンの解析器を持つ場合にかぎって、保存されたヒントを使います。復元時に再解析は行いません。

各段階を自分で組み合わせるなら、`TextAnalysis` から `deriveTypographyHints()` でヒントを作り、それを `computeBreaks()` に渡します。上の 2 つの例で書き出した配列が、まさにその出力にあたります。

---

## 関連ドキュメント

- [01-getting-started.md](./01-getting-started.md) -- インストールと基本的な使い方
- [04-ruby.md](./04-ruby.md) -- ルビ注釈の前処理
- [10-api-reference.md](./10-api-reference.md) -- `deriveTypographyHints()`、`TypographyHints`、`@libraz/mejiro/analysis` サブパス
