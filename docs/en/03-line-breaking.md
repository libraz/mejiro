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
4. **Forced break** -- If no valid position is found during backward search, the algorithm forces a break at the overflow point.
5. **Width recalculation** -- After placing a break, the accumulated width is recalculated for the characters already consumed on the new line.

### Time Complexity

The algorithm is O(n) where n is the number of characters. Each character is visited at most twice: once during the forward scan and at most once during a backward search. The backward search never revisits characters that were already placed on a previous line, because `lineStart` advances monotonically.

### Token Boundary Preference

When `tokenBoundaries` is provided, the backward search prefers breaking at token edges. If no token boundary is found among the valid break candidates, the algorithm falls back to the first kinsoku-valid position.

---

## 2. LayoutInput

The `LayoutInput` interface describes all parameters for the line breaking algorithm.

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

| Field              | Required | Default    | Description                                                        |
|--------------------|----------|------------|--------------------------------------------------------------------|
| `text`             | Yes      | --         | Unicode codepoints as `Uint32Array`. Use `toCodepoints()` to convert from a string. |
| `advances`         | Yes      | --         | Per-character advance widths in pixels. Must have the same length as `text`. |
| `lineWidth`        | Yes      | --         | Maximum line width in pixels.                                      |
| `mode`             | No       | `'strict'` | Kinsoku processing mode. See section 4.                            |
| `enableHanging`    | No       | `true`     | Whether to allow hanging punctuation. See section 5.               |
| `clusterIds`       | No       | --         | Cluster IDs for indivisible character groups. See section 6.       |
| `rubyAnnotations`  | No       | --         | Ruby annotations. Triggers ruby preprocessing before line breaking. |
| `tokenBoundaries`  | No       | --         | Indices of the last codepoint in each token. The algorithm prefers breaking at these positions. Use `tokenLengthsToBoundaries()` to convert from morphological analyzer output. |
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

**Line-start prohibited characters:**

| Category           | Characters                                  |
|--------------------|---------------------------------------------|
| Closing brackets   | ）〕］｝〉》」』】                          |
| Punctuation        | 、。，．・：；？！                          |
| Small kana         | ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ    |
| Long vowel mark    | ー                                          |
| Iteration marks    | 々〻ヽヾゝゞ                                |

**Line-end prohibited characters:**

| Category           | Characters                                  |
|--------------------|---------------------------------------------|
| Opening brackets   | （〔［｛〈《「『【                          |

### Loose Mode

Same rules as strict mode, but **small kana** (ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ) and the **long vowel mark** (ー) are allowed at line start. This is useful for narrow columns where strict kinsoku would cause excessive whitespace.

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
// strict.breakPoints → [3, ...]
// Line 1: あいうえ (4 chars), Line 2 starts with おっ...

// Loose mode: っ is allowed at line start.
// The break can stay at index 4.
const loose = computeBreaks({ text, advances, lineWidth: 80, mode: 'loose' });
// loose.breakPoints → [4, ...]
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
// The 、 cannot hang, so the break moves earlier.
// result.breakPoints → [4]
// Line 1: あいうえお (5 chars)
// Line 2: 、かきくけこ
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
  lineWidth: 40, // 2.5 chars fit
  clusterIds,
});
// Cannot break within cluster 0 (A-B or B-C) or cluster 1 (D-E).
// The only valid break is after index 2 (between C and D).
// result.breakPoints → [2]
// Line 1: ABC, Line 2: DE
```

If `clusterIds` is omitted, every inter-character position is eligible for a break (subject to kinsoku rules).

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

## Related Documentation

- [01-getting-started.md](./01-getting-started.md) -- Installation and basic usage
- [04-ruby.md](./04-ruby.md) -- Ruby annotation preprocessing
