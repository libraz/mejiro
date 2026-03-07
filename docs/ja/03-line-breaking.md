# 改行処理

このドキュメントでは、mejiro の改行アルゴリズムについて、禁則処理、ぶら下げ組み、クラスタ処理を含めて説明します。

## 1. 貪欲 O(n) アルゴリズム

`computeBreaks` 関数は、禁則処理に対応した後方探索付きの単一パス貪欲アルゴリズムを実装しています。

### 動作の仕組み

1. **前方走査** -- 文字を左から右へ順に走査し、送り幅を累積します。
2. **オーバーフロー検出** -- 累積幅が `lineWidth` を超えた時点で改行が必要になります。
3. **後方探索** -- オーバーフロー位置から後方に有効な改行位置を探索します。以下のすべてを満たす位置が「有効」です:
   - **禁則行末チェック** -- 改行位置の文字が行末禁則文字でないこと。
   - **禁則行頭チェック** -- 改行位置の直後の文字が行頭禁則文字でないこと。
   - **クラスタ境界チェック** -- 同じクラスタ ID に属する文字間で改行しないこと。
4. **強制改行** -- 後方探索で有効な位置が見つからない場合、オーバーフロー位置で強制的に改行します。
5. **幅の再計算** -- 改行を配置した後、新しい行で既に消費された文字の累積幅を再計算します。

### 時間計算量

アルゴリズムの計算量は O(n)（n は文字数）です。各文字は最大2回参照されます: 前方走査で1回、後方探索で最大1回です。後方探索は前の行に配置済みの文字を再び参照することはありません。`lineStart` が単調増加するためです。

### トークン境界の優先

`tokenBoundaries` が指定されている場合、後方探索はトークンの境界での改行を優先します。有効な改行候補の中にトークン境界が見つからない場合、アルゴリズムは最初の禁則処理に適合する位置にフォールバックします。

---

## 2. LayoutInput

`LayoutInput` インターフェースは、改行アルゴリズムに必要なすべてのパラメータを定義します。

```ts
interface LayoutInput {
  text: Uint32Array;                      // Unicode codepoints
  advances: Float32Array;                 // Per-character advance widths (px)
  lineWidth: number;                      // Available line width (px)
  mode?: KinsokuMode;                     // 'strict' (default) | 'loose'
  enableHanging?: boolean;                // Default: true
  clusterIds?: Uint32Array;               // Characters with same ID cannot be split
  rubyAnnotations?: RubyAnnotation[];     // Ruby preprocessing (see 04-ruby.md)
  tokenBoundaries?: Uint32Array | readonly number[]; // Preferred break positions
  kinsokuRules?: KinsokuRules;            // Custom prohibition rules
}
```

| フィールド          | 必須 | デフォルト | 説明                                                               |
|--------------------|------|----------|--------------------------------------------------------------------|
| `text`             | はい | --       | Unicode コードポイントの `Uint32Array`。文字列からの変換には `toCodepoints()` を使用します。 |
| `advances`         | はい | --       | 文字ごとの送り幅（ピクセル単位）。`text` と同じ長さである必要があります。 |
| `lineWidth`        | はい | --       | 行の最大幅（ピクセル単位）。                                        |
| `mode`             | いいえ | `'strict'` | 禁則処理モード。第4節を参照。                                     |
| `enableHanging`    | いいえ | `true`   | ぶら下げ組みを有効にするかどうか。第5節を参照。                     |
| `clusterIds`       | いいえ | --       | 分割不可の文字グループ用クラスタ ID。第6節を参照。                  |
| `rubyAnnotations`  | いいえ | --       | ルビ注釈。改行処理の前にルビの前処理が実行されます。                 |
| `tokenBoundaries`  | いいえ | --       | 各トークンの末尾コードポイントのインデックス。アルゴリズムはこれらの位置での改行を優先します。形態素解析器の出力から変換するには `tokenLengthsToBoundaries()` を使用します。 |
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

禁則処理は、特定の文字が行頭または行末に来ることを禁止する日本語組版のルール体系です。mejiro は2つのモードをサポートしています。

### strict モード（デフォルト）

**行頭禁則文字:**

| カテゴリ           | 文字                                        |
|--------------------|---------------------------------------------|
| 閉じ括弧           | ）〕］｝〉》」』】                          |
| 句読点             | 、。，．・：；？！                          |
| 小書き仮名         | ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ    |
| 長音記号           | ー                                          |
| 繰り返し記号       | 々〻ヽヾゝゞ                                |

**行末禁則文字:**

| カテゴリ           | 文字                                        |
|--------------------|---------------------------------------------|
| 開き括弧           | （〔［｛〈《「『【                          |

### loose モード

strict モードと同じルールですが、**小書き仮名**（ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ）と**長音記号**（ー）が行頭に許容されます。狭い段組みで strict 禁則が過度な空白を生じさせる場合に有用です。

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
// strict.breakPoints → [3, ...]
// 1行目: あいうえ (4文字), 2行目はおっ...から開始

// loose モード: っ は行頭に許容される。
// インデックス4で改行できる。
const loose = computeBreaks({ text, advances, lineWidth: 80, mode: 'loose' });
// loose.breakPoints → [4, ...]
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
// 「、」はぶら下げできないため、改行位置が前に移動する。
// result.breakPoints → [4]
// 1行目: あいうえお (5文字)
// 2行目: 、かきくけこ
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
  lineWidth: 40, // 2.5文字分
  clusterIds,
});
// クラスタ 0 内 (A-B または B-C) やクラスタ 1 内 (D-E) では改行できない。
// 有効な改行位置はインデックス2の後（C と D の間）のみ。
// result.breakPoints → [2]
// 1行目: ABC, 2行目: DE
```

`clusterIds` を省略した場合、すべての文字間位置が改行候補になります（禁則ルールの制約は適用されます）。

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

## 関連ドキュメント

- [01-getting-started.md](./01-getting-started.md) -- インストールと基本的な使い方
- [04-ruby.md](./04-ruby.md) -- ルビ注釈の前処理
