# Line Breaking

This document describes the line breaking algorithm in mejiro, including kinsoku processing, hanging punctuation, and cluster handling.

## 1. The Greedy O(n) Algorithm

The `computeBreaks` function implements a single-pass greedy algorithm with backward search for kinsoku compliance.

### How It Works

1. **Forward scan** -- Iterate through characters left-to-right, accumulating advance widths.
2. **Overflow detection** -- When the accumulated width exceeds `lineWidth`, a break is needed.
3. **Backward search** -- Search backward from the overflow position for a valid break point. A position is "valid" if it passes all of:
   - **Kinsoku line-end check** -- The character at the break position is not prohibited at line end.
   - **Kinsoku line-start check** -- The character immediately after the break is not prohibited at line start.
   - **Cluster boundary check** -- The break does not split characters belonging to the same cluster ID.
4. **Forced break** -- If no valid position is found during backward search, the algorithm breaks at the nearest cluster boundary on the line, or at the overflow point when the line contains no cluster boundary at all. See section 6.
5. **Width recalculation** -- After placing a break, the accumulated width is recalculated for the characters already consumed on the new line.

### Time Complexity

The algorithm is O(n) where n is the number of characters. Each character is visited at most twice: once during the forward scan and at most once during a backward search. The backward search never revisits characters that were already placed on a previous line, because `lineStart` advances monotonically.

### Token Boundary Preference

When `tokenBoundaries` is provided, the backward search prefers breaking at token edges. If no token boundary is found among the valid break candidates, the algorithm falls back to the nearest kinsoku-valid position.

### Word Boundary Preference

With or without token boundaries, the nearest valid position wins, because it fills the line best. An earlier space is preferred only when breaking at the nearest position would split a word -- that is, when the characters on both sides of it belong to a space-delimited script. CJK text allows a break between any two characters, so a space in it never pulls the break away from the line end.

---

## 2. LayoutInput

The `LayoutInput` interface describes all parameters for the line breaking algorithm.

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

| Field              | Required | Default    | Description                                                        |
|--------------------|----------|------------|--------------------------------------------------------------------|
| `text`             | Yes      | --         | Unicode codepoints as `Uint32Array`. Use `toCodepoints()` to convert from a string. |
| `advances`         | Yes      | --         | Per-character advance widths in pixels. Must have the same length as `text`. |
| `lineWidth`        | Yes      | --         | Maximum line width in pixels.                                      |
| `lineWidths`       | No       | --         | Per-line widths in pixels. The i-th line uses `lineWidths[i]`; lines beyond the array fall back to `lineWidth`. Used by image exclusion, where each column has its own available height. |
| `mode`             | No       | `'strict'` | Kinsoku processing mode. See section 4.                            |
| `enableHanging`    | No       | `true`     | Whether to allow hanging punctuation. See section 5.               |
| `clusterIds`       | No       | --         | Cluster IDs for indivisible character groups. See section 6.       |
| `rubyAnnotations`  | No       | --         | Core-level ruby annotations. Triggers ruby preprocessing before line breaking. |
| `tokenBoundaries`  | No       | --         | Indices of the last codepoint in each token. The algorithm prefers breaking at these positions. Use `tokenLengthsToBoundaries()` to convert from morphological analyzer output. |
| `breakPenalties`   | No       | --         | Cost of breaking after each index, one entry per codepoint. Switches the backward search to a bounded cost search and supersedes `tokenBoundaries`. See section 8. |
| `breakCost`        | No       | --         | Weights for that cost search. Ignored unless `breakPenalties` is given. |
| `kinsokuRules`     | No       | --         | Custom kinsoku rules. Overrides the built-in rules entirely.       |

### Minimal Usage

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
});
```

### Full Usage

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

The `computeBreaks` function returns a `BreakResult`:

```ts
interface BreakResult {
  breakPoints: Uint32Array;             // Indices of last char before each break
  hangingAdjustments?: Float32Array;    // Hanging overhang per line (px), 0 if none
  effectiveAdvances?: Float32Array;     // Per-char advances after ruby distribution
  lineWidths?: Float32Array;            // Width actually used per line
}
```

### breakPoints

Each value in `breakPoints` is the index of the last character on that line. Characters after the break point start the next line.

For example, given text of length 15 and `breakPoints = [4, 9]`:

- Line 1: characters 0..4 (indices 0 through 4 inclusive)
- Line 2: characters 5..9
- Line 3: characters 10..14 (the remainder)

### hangingAdjustments

Present when `enableHanging` is `true` (the default). Each entry corresponds to a line in `breakPoints`. A non-zero value indicates that the line's final character hangs past the line edge by that many pixels.

### effectiveAdvances

Present only when `rubyAnnotations` were provided. Contains per-character advance widths after ruby width distribution, which may differ from the original `advances` input.

---

## 4. Kinsoku Shori (禁則処理)

Kinsoku shori is the set of Japanese typographic rules that prohibit certain characters from appearing at the start or end of a line. mejiro supports two modes.

### Strict Mode (default)

**Line-start prohibited characters** (the complete set returned by `getDefaultKinsokuRules().lineStartProhibited`):

| Category           | Characters                                  |
|--------------------|---------------------------------------------|
| Closing brackets   | ）〕］｝〉》」』】〗〙〛                    |
| Closing quotes     | ’”〟                                        |
| Punctuation        | 、。，．・：；？！                          |
| Dashes and ellipses | ‥…〜—―                                     |
| Small kana         | ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ |
| Long vowel mark    | ー                                          |
| Iteration marks    | 々〻ヽヾゝゞ                                |

**Line-end prohibited characters** (`getDefaultKinsokuRules().lineEndProhibited`):

| Category           | Characters                                  |
|--------------------|---------------------------------------------|
| Opening brackets   | （〔［｛〈《「『【〖〘〚                    |
| Opening quotes     | 〝‘“                                         |

**Unbreakable pairs** (`getDefaultKinsokuRules().unbreakablePairs`) — never split between the two characters: `‥‥`, `……`, `——`, `――`.

### Loose Mode

Same rules as strict mode, but these characters are allowed at line start:

| Category           | Characters                                  |
|--------------------|---------------------------------------------|
| Small kana         | ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ |
| Long vowel mark    | ー                                          |

This is useful for narrow columns where strict kinsoku would cause excessive whitespace.
Note the asymmetry between the two small ka/ke pairs: katakana `ヵヶ` are allowed at line
start in loose mode, while hiragana `ゕゖ` stay prohibited in both modes. Everything else
prohibited under strict mode — brackets, quotes, punctuation, dashes and iteration marks —
stays prohibited under loose mode.

### Break Validation Logic

A break after position `pos` is valid when all of the following hold:

1. The character at `pos` is **not** line-end prohibited.
2. The character at `pos + 1` is **not** line-start prohibited (under the current mode).
3. The break does not split a cluster (characters at `pos` and `pos + 1` have different cluster IDs, or no cluster IDs are specified).

This is implemented by `canBreakAt()`:

```ts
function canBreakAt(
  text: Uint32Array,
  pos: number,
  clusterIds?: Uint32Array,
  mode?: KinsokuMode,
  rules?: KinsokuRules,
): boolean;
```

### Strict vs Loose Example

Consider breaking the text "あいうえおっかきくけこ" (11 characters) with each character 16px wide and a line width of 80px (5 characters fit).

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいうえおっかきくけこ');
const advances = new Float32Array(11).fill(16);

// Strict mode: っ (small tsu) is prohibited at line start.
// The naive break after index 4 (あいうえお) would put っ at the start of line 2.
// The algorithm backtracks to index 3 to avoid this.
const strict = computeBreaks({ text, advances, lineWidth: 80, mode: 'strict' });
// strict.breakPoints → [3, 8]
// Line 1: あいうえ (4 chars), Line 2 starts with おっ...

// Loose mode: っ is allowed at line start.
// The break can stay at index 4.
const loose = computeBreaks({ text, advances, lineWidth: 80, mode: 'loose' });
// loose.breakPoints → [4, 9]
// Line 1: あいうえお (5 chars), Line 2 starts with っか...
```

### Custom Kinsoku Rules

Use `buildKinsokuRules()` to create custom rules with pre-computed lookup sets:

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

When `kinsokuRules` is provided, it **replaces** the built-in rules entirely. Use `getDefaultKinsokuRules()` as a starting point if you want to extend the defaults.

---

## 5. Hanging Punctuation (ぶら下げ組み)

Hanging punctuation allows certain punctuation marks to protrude past the line edge rather than being pushed to the next line. This is enabled by default.

### Eligible Characters

| Character | Unicode | Name                  |
|-----------|---------|-----------------------|
| 。        | U+3002  | Ideographic full stop |
| 、        | U+3001  | Ideographic comma     |
| ．        | U+FF0E  | Fullwidth full stop   |
| ，        | U+FF0C  | Fullwidth comma       |

### How It Works

When the accumulated width exceeds `lineWidth` and the overflowing character is a hanging target, the algorithm checks whether the line was within bounds *before* adding that character (i.e., `accWidth - advance <= lineWidth`). If so, the character is allowed to hang past the line edge, and the overhang amount is recorded in `hangingAdjustments`.

### Example: Hanging Enabled (default)

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80, // 5 chars fit exactly
  enableHanging: true, // default
});
// The 、 at index 5 overflows but is allowed to hang.
// result.breakPoints → [5]
// result.hangingAdjustments → Float32Array [16]
// Line 1: あいうえお、 (、 hangs 16px past the edge)
// Line 2: かきくけこ
```

### Example: Hanging Disabled

```ts
const result = computeBreaks({
  text: toCodepoints('あいうえお、かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  enableHanging: false,
});
// The 、 cannot hang, so it must start line 2 — but 、 is prohibited at line start,
// so the backward search moves the break one position earlier.
// result.breakPoints → [3, 8]
// Line 1: あいうえ (4 chars)
// Line 2: お、かきくけ
// Line 3: こ
```

Note: When `enableHanging` is `false`, `hangingAdjustments` is `undefined` in the result.

---

## 6. Cluster IDs

Characters sharing the same cluster ID form an indivisible unit that cannot be split across lines. This mechanism is used internally by ruby preprocessing to keep base characters and their ruby annotations together, but it can also be used directly.

### How It Works

The `clusterIds` array assigns a cluster ID to each character. When the algorithm considers a break between positions `pos` and `pos + 1`, it checks whether `clusterIds[pos] === clusterIds[pos + 1]`. If they match, the break is prohibited at that position.

### Example

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('ABCDE');
const advances = new Float32Array(5).fill(16);
// ABC grouped (cluster 0), DE grouped (cluster 1)
const clusterIds = new Uint32Array([0, 0, 0, 1, 1]);

const result = computeBreaks({
  text,
  advances,
  lineWidth: 48, // 3 chars fit
  clusterIds,
});
// Cannot break within cluster 0 (A-B or B-C) or cluster 1 (D-E).
// The only valid break is after index 2 (between C and D).
// result.breakPoints → [2]
// Line 1: ABC (48px), Line 2: DE (32px)
```

If `clusterIds` is omitted, every inter-character position is eligible for a break (subject to kinsoku rules).

### Clusters Wider Than the Line

A cluster that is wider than the available line width fits on no line at all. In that case the forced break rule splits it at the last character that fits, and that is the only situation in which a break falls between two characters sharing a cluster ID. As long as a cluster fits on a line of its own it is never split, even when honouring it means placing a line-end prohibited character at the line end.

---

## 7. getLineRanges

The `getLineRanges` utility converts the compact `breakPoints` array into explicit `[start, end)` index pairs for each line.

```ts
import { computeBreaks, getLineRanges, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいうえおかきくけこさしすせそ'); // 15 chars
const advances = new Float32Array(15).fill(16);
const result = computeBreaks({ text, advances, lineWidth: 80 });
// result.breakPoints → Uint32Array [4, 9]

const lines = getLineRanges(result.breakPoints, text.length);
// lines → [[0, 5], [5, 10], [10, 15]]
```

Each pair is `[start, end)` -- start is inclusive, end is exclusive. This follows standard JavaScript convention for slice ranges, so you can use them directly:

```ts
for (const [start, end] of lines) {
  const lineChars = text.slice(start, end);
  // process each line...
}
```

---

## 8. Analysis-Driven Breaking

Everything above decides where to break from character classes alone. A morphological analyzer can inform that decision, and the feature is off by default.

### This Is Not "Break at Word Boundaries"

The first thing to be clear about: breaking only at word edges is the wrong goal for Japanese. Body text is set by breaking wherever the kinsoku rules allow, and a line that ends at a word edge every time leaves loose, ragged lines that do not read like a book. That is why `tokenBoundaries` on its own — the preference described in section 1 — is useful next to penalties rather than instead of them.

What an analysis is good for is narrower and more valuable: it says which runs of characters it would be an outright typesetting error to split, and it can rank the positions that remain.

### Two Opt-In Stages

| Stage | What it adds | Effect on break positions |
|---|---|---|
| `'off'` (default) | Nothing. No analysis is run at all | None |
| `'clusters'` | Hard clusters — indivisible units | Unchanged, except where a break would have split one of those units |
| `'full'` | Clusters plus per-position break penalties | Positions move |

`'clusters'` is the stage to reach for first. It only removes break opportunities, and every one it removes is one that produced a wrong break: `第1章` cut after the `1`, a Latin word cut mid-word, a counter torn off its numeral.

`'full'` changes how lines are filled, which is a typographic decision rather than a correctness one. It suits headings, captions and short measures, where a bad break is conspicuous and there is little text to average out. Using it for body text is a deliberate house-style choice.

### What the Cluster Rules Recognise

`deriveTypographyHints()` applies four rules, and a unit becomes indivisible only when the character class of its surface confirms it — never on the part of speech alone:

| Rule | Example |
|---|---|
| A numeral and the counter that follows it | `3人` |
| A prefix and the word it binds to | `お名前` |
| The interior of a numeral | `１２３` |
| The interior of a Latin word inside Japanese text | `mejiro` |

This makes the rules deliberately blind to dictionary coverage. A morpheme the analyzer could not tag qualifies on exactly the same terms as a confidently tagged one, so an unknown word behaves like a known one and the output stays stable across dictionary versions.

It also puts some things out of scope by construction. Whether `山田太郎` is one token or two is a property of the dictionary, not of the typography, so a personal name is not something these rules keep together. And the analyzer cannot generate ruby: it returns surfaces and lemmas, not readings.

A cluster wider than `maxHardClusterChars` (6 by default) is dropped rather than shortened, because a cluster that cannot fit a line is split by the forced-break rule, which disregards kinsoku — see section 6.

### Cluster Example

Cluster hints ride into `computeBreaks()` through the existing `clusterIds` input, so this is section 6's mechanism with the array supplied by an analysis rather than by hand. Use `mergeClusterIds()` to combine them with ruby or tate-chu-yoko clustering.

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('あいうえ12人'); // 7 chars
const advances = new Float32Array(7).fill(16);

// Character classes alone: the nearest valid position wins, splitting 12.
const plain = computeBreaks({ text, advances, lineWidth: 80 });
// plain.breakPoints → [4]
// Line 1: あいうえ1, Line 2: 2人

// With the hint clusters for 12人, that position is no longer available.
const hinted = computeBreaks({
  text,
  advances,
  lineWidth: 80,
  clusterIds: new Uint32Array([0, 1, 2, 3, 4, 4, 4]),
});
// hinted.breakPoints → [3]
// Line 1: あいうえ, Line 2: 12人
```

### Break Penalties

`breakPenalties` holds one value per code point: `breakPenalties[i]` is the cost of breaking *after* index `i`, the same position convention `breakPoints` uses. `0` is unpenalised and larger values are avoided more strongly.

| Value | Position |
|---|---|
| 0 | After the last morpheme of a bunsetsu — the position to prefer |
| 1 | A morpheme boundary that does not close a bunsetsu |
| 2 | Inside a morpheme, which is where the character-class rules would cut |
| 3 | A break that cuts a base off the particle or auxiliary that follows it |
| 4 | Inside a word the rules keep whole — a conjunction, adverb, adnominal, pronoun or interjection by default. See "Keeping a Word Whole" below |

When penalties are present, the backward search stops taking the nearest valid position and takes the cheapest one within a bounded window instead. The cost of breaking after position `p` is:

```
penaltyWeight * breakPenalties[p] + shortfallWeight * shortfall(p)
```

`shortfall(p)` is how far short of the line width the line ends, measured in em. At the defaults — `penaltyWeight` `1`, `shortfallWeight` `1.5` — a penalty of 2 is given up only while the alternative leaves the line less than 1.33 em short, a penalty of 3 only while it leaves it less than 2 em short, and the heaviest penalty of 4 only while it leaves it less than 2.67 em short. That ceiling is the point of the weight: vertical Japanese is set on a character grid, where standard kinsoku shifts a line by one character and occasionally two, so a weight of `1` — at which the heaviest penalty buys four empty cells — reaches well past what the convention allows. Only the ratio of the two weights decides anything — scaling both scales every cost and cannot reorder them — so move one weight and leave the other where it is.

The window is `maxBacktrackChars` positions wide (6 by default), which is what keeps line breaking linear in the text length. Six is also the point past which a candidate cannot win, so a wider window only costs search time: a position `k` steps further back gives up at least `0.5k` em of line, a half-width character being the narrowest thing that can sit between the two, so against the largest penalty `P` in the array it can win only while `k < 2 * penaltyWeight * P / shortfallWeight` — `k < 5.33` at the default weights and the penalties `deriveTypographyHints()` emits, which is why six covers the search completely. A caller that both flattens the weights towards `1` and raises the keep-whole penalty pushes that bound past six and should widen the window to match, or the search will not reach the position its own settings say should win. A window holding no valid position at all falls through to the unbounded search of section 1, so a long run of line-start prohibited characters is still handled.

Penalties supersede both `tokenBoundaries` and the whitespace preference.

### Penalty Example

Given the segmentation `今日 / は / 良い / 天気 / です / ね`, the rules assign the penalties written out below.

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('今日は良い天気ですね'); // 10 chars
const advances = new Float32Array(10).fill(16);

// Character classes alone: the line is filled as far as it goes, splitting 天気.
const plain = computeBreaks({ text, advances, lineWidth: 96 });
// plain.breakPoints → [5]
// Line 1: 今日は良い天, Line 2: 気ですね

// 今 日  は 良 い  天 気  で す  ね
const breakPenalties = new Uint8Array([2, 3, 0, 2, 0, 2, 3, 2, 3, 0]);

const hinted = computeBreaks({ text, advances, lineWidth: 96, breakPenalties });
// Breaking after index 5 fills the line and costs its penalty of 2. Breaking
// after index 4 carries no penalty and leaves 1 em, which the shortfall weight
// prices at 1.5. The cheaper position wins.
// hinted.breakPoints → [4]
// Line 1: 今日は良い, Line 2: 天気ですね
```

Tune the trade-off through `breakCost`: raise `penaltyWeight` to respect the analysis more strictly, raise `shortfallWeight` to keep lines full. Raising both moves nothing, since only their ratio is read.

### Keeping a Word Whole

The penalty of 4 is the one value in the table a caller chooses rather than reads off the structure. `keepWholePos` names the parts of speech a break should avoid landing inside, and every position *strictly inside* such a morpheme carries `keepWholePenalty` in place of the ordinary inside-a-morpheme 2. The boundaries on either side keep their own values, because those are where a break escapes to.

The default set is the closed-class independent words, exported as `DEFAULT_KEEP_WHOLE_POS`:

| Code | Part of speech |
|---|---|
| `ADV` | Adverb |
| `CONJ` | Conjunction |
| `DET` | Adnominal |
| `INTJ` | Interjection |
| `PRON` | Pronoun |

These words are short, mostly written in kana, and read as a single unit, so a break inside one is conspicuous in a way a break inside a kanji compound is not: `国際|連合` still reads, `した|がって` does not. Being closed classes, they are also the words an analyzer's dictionary is most likely to know.

A code matches when it equals either the morpheme's `extendedPos` or its `pos`, so `'VERB'` selects every verb while `'VERB_連用'` selects one conjugation. Pass `[]` to switch the rule off, or spread the default to extend rather than replace it — formal nouns are the usual addition:

```ts
import { DEFAULT_KEEP_WHOLE_POS, deriveTypographyHints } from '@libraz/mejiro';

const hints = deriveTypographyHints(text, analysis, {
  penalties: true,
  keepWholePos: [...DEFAULT_KEEP_WHOLE_POS, 'NOUN_形式'],
});
```

This is the one rule that consults the part of speech, which the cluster rules refuse to do. The difference is what the two kinds of rule decide. A cluster changes what is *legal*, so a gap in the dictionary would change the layout. A penalty changes only what is *preferred*: a word the dictionary does not know keeps the penalty it would have had anyway, so the worst outcome of a gap is no improvement, never a different layout.

For the same reason there is no length cap of the kind `maxHardClusterChars` puts on clusters. A long cluster needs a guard because a cluster that cannot fit a line is split by the forced-break rule, which disregards kinsoku; a long keep-whole morpheme needs none, because an escape the search cannot afford is simply not taken.

### Choosing the Keep-Whole Penalty

The value is a price, not a switch, and raising it buys fewer breaks inside these words at the cost of emptier line ends. The figures below come from a 20,046-character corpus of Japanese prose (133 paragraphs) with a 16 px em and the default weights. The corpus holds 733 keep-whole morphemes covering 1,777 characters, 8.9% of the text. A paragraph's last line is left out of every count: its shortfall says where the text ran out, not what the search decided.

At a 24 em measure, roughly 750 break positions:

| Setting | Breaks landing inside such a word | Mean shortfall | Lines 1.5 em or more short | Worst line |
|---|---|---|---|---|
| No penalties at all (clusters only) | 42 (5.8%) | 0.058 em | 1.4% | 2.00 em |
| Rule off (`keepWholePos: []`) | 15 (2.0%) | 0.295 em | 3.4% | 2.00 em |
| `keepWholePenalty: 4` (default) | 10 (1.4%) | 0.317 em | 4.5% | 2.00 em |
| `keepWholePenalty: 5` and above | 0 (0.0%) | 0.363 em | 5.9% | 3.00 em |

A `keepWholePenalty` of 2 *is* the rule switched off, since 2 is what the position would carry anyway. Three behaves identically to two at every measure, and that is arithmetic rather than coincidence: at `shortfallWeight` `1.5` one point of penalty buys 0.67 em of empty line, and a full-width character is a whole em, so a single point can never carry a break past even one more character. In full-width text the scale therefore moves in effective steps of two — 0 and 1 alike, 2 and 3 alike — and 4 is the first value genuinely different from the inside-a-morpheme default. That is why the default is 4 rather than 3. In a Latin run, where a character is half an em, a single point does pay, so this is a property of the grid rather than a law of the scale.

At a 32 em measure:

| Setting | Breaks landing inside such a word | Mean shortfall | Lines 1.5 em or more short | Worst line |
|---|---|---|---|---|
| No penalties at all (clusters only) | 24 (4.7%) | 0.158 em | 2.6% | 2.00 em |
| Rule off (`keepWholePos: []`) | 15 (2.9%) | 0.326 em | 6.7% | 2.00 em |
| `keepWholePenalty: 4` (default) | 4 (0.8%) | 0.362 em | 8.8% | 2.50 em |
| `keepWholePenalty: 5` and above | 0 (0.0%) | 0.369 em | 9.0% | 3.50 em |

The rule reaches every measure rather than only narrow ones. Across 40, 48 and 56 em the rule off leaves 7, 12 and 4 breaks inside these words and the default leaves 3, 5 and 2: 48 em bites harder than 40 em, because break positions fall where the text puts them rather than in proportion to the measure. Only at 56 em does the effect begin to fall off.

The default is cheap rather than free. At 24 em it removes a third of the breaks the structural penalties leave inside these words and holds the worst line where the rule off already had it; at 32 em it removes eleven of fifteen and takes the worst line from 2.00 to 2.50 em. Five clears the last of them at every measure and pays with a hole of 3.00 to 3.50 em, which a character grid does not absorb.

### Using It Through MejiroBook

`MejiroBook` runs the whole path for you. Set an analyzer and pick a stage:

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

`BookOptions.keepWholePos` and `BookOptions.keepWholePenalty` forward to `deriveTypographyHints()` unchanged. They are read only under `'full'`, the one stage that emits penalties.

`createSuzumeAnalyzer()` rejects when the optional peer dependency `@libraz/suzume` is not installed, because calling it is an explicit request for that analyzer. A caller that would rather degrade quietly catches the rejection and constructs the book without an analyzer.

Four properties of the integration are worth knowing:

- **Analysis runs once per paragraph, before layout.** Resizing, changing the font, or reflowing around an image replays the first pass; none of them re-analyses. Analysis is not on the interactive path.
- **A failing analyzer costs quality, never availability.** If the analyzer is missing or throws, the paragraph is laid out on the character-class rules alone, which is a correct layout. One console notice is emitted per book, not per paragraph.
- **A paragraph can carry its own hints.** `BookParagraph.hints` bypasses the book's analyzer for that paragraph, which is how a caller supplies a pre-computed analysis or a different rule set for one paragraph.
- **Hints survive a snapshot only when the analyzer matches.** `ChapterLayout.snapshot()` records the analyzer's identity, and `layoutFromSnapshot()` keeps the stored hints only if the book it is restored into is configured with the same analyzer name and version. Nothing is re-analysed during a restore.

To run the pieces yourself, call `deriveTypographyHints()` on a `TextAnalysis` and pass the result to `computeBreaks()` — the two examples above are exactly what that produces.

---

## Related Documentation

- [01-getting-started.md](./01-getting-started.md) -- Installation and basic usage
- [04-ruby.md](./04-ruby.md) -- Ruby annotation preprocessing
- [10-api-reference.md](./10-api-reference.md) -- `deriveTypographyHints()`, `TypographyHints` and the `@libraz/mejiro/analysis` subpath
