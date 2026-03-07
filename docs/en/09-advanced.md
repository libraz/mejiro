# Advanced

This document covers advanced usage of mejiro, including custom kinsoku rules, morphological analysis integration, performance characteristics, server-side usage, and custom rendering.

---

## 1. Custom Kinsoku Rules

You can override the default line break prohibition rules by providing a `KinsokuRules` object to `computeBreaks()`.

### Extending the Defaults

Use `getDefaultKinsokuRules()` to get a copy of the built-in strict rules, then modify them:

```ts
import { buildKinsokuRules, getDefaultKinsokuRules, computeBreaks, toCodepoints } from '@libraz/mejiro';

// Get defaults and customize
const defaults = getDefaultKinsokuRules();
const rules = buildKinsokuRules({
  lineStartProhibited: [...defaults.lineStartProhibited, 0x2026], // Add …
  lineEndProhibited: defaults.lineEndProhibited,
});

const result = computeBreaks({
  text: toCodepoints('あいうえお…かきくけこ'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  kinsokuRules: rules,
});
```

### Creating Rules from Scratch

To create rules that do not extend the defaults:

```ts
const rules = buildKinsokuRules({
  lineStartProhibited: [0x3001, 0x3002], // Only 、and 。
  lineEndProhibited: [0x300c],           // Only 「
});
```

When `kinsokuRules` is provided to `computeBreaks()`, it **replaces** the built-in rules entirely. The `mode` option (`'strict'` / `'loose'`) is ignored when custom rules are active.

### KinsokuRules Structure

```ts
interface KinsokuRules {
  lineStartProhibited: number[];        // Codepoint arrays
  lineEndProhibited: number[];
  lineStartProhibitedSet: Set<number>;  // Pre-computed lookup sets
  lineEndProhibitedSet: Set<number>;
}
```

Always use `buildKinsokuRules()` to create rules -- it generates the lookup sets automatically from the codepoint arrays. Constructing a `KinsokuRules` object manually without the sets will result in incorrect behavior.

---

## 2. Token Boundaries (Morphological Analysis Integration)

The `tokenBoundaries` option lets you integrate morphological analyzers (such as MeCab, kuromoji, or Sudachi) to prefer natural word boundaries for line breaks.

### Basic Usage

```ts
import { tokenLengthsToBoundaries, computeBreaks, toCodepoints } from '@libraz/mejiro';

// Input: "新しいプログラミング言語" tokenized as:
// ["新しい" (3), "プログラミング" (7), "言語" (2)]
const boundaries = tokenLengthsToBoundaries([3, 7, 2]);
// boundaries → Uint32Array [2, 9]  (prefer breaks after index 2 and 9)

const text = toCodepoints('新しいプログラミング言語');
const result = computeBreaks({
  text,
  advances: new Float32Array(text.length).fill(16),
  lineWidth: 80,
  tokenBoundaries: boundaries,
});
```

### How It Works

1. When searching backward for a break position, the algorithm first looks for a position that is both kinsoku-valid **and** a token boundary.
2. If no token boundary is found among the valid candidates, it falls back to any kinsoku-valid position.
3. Token boundaries are a **preference**, not a hard constraint -- kinsoku rules always take priority.

### Accepting Raw Arrays

You can also pass a plain `number[]` instead of a `Uint32Array`:

```ts
computeBreaks({
  text,
  advances,
  lineWidth: 80,
  tokenBoundaries: [2, 9], // readonly number[] also accepted
});
```

### tokenLengthsToBoundaries

The `tokenLengthsToBoundaries()` helper converts an array of token lengths (in codepoints) into boundary indices. Each boundary is the index of the **last codepoint** in that token. The last token's boundary is omitted since it coincides with the text end.

```ts
tokenLengthsToBoundaries([3, 7, 2])
// → Uint32Array [2, 9]
```

---

## 3. Performance

### O(n) Guarantee

`computeBreaks()` runs in O(n) time where n is the number of characters:

- **Forward scan**: each character is visited once.
- **Backward search on overflow**: each character is visited at most once more (amortized), because `lineStart` advances monotonically.
- No dynamic programming, no global optimization.
- For a 10,000-character chapter, the algorithm touches at most ~20,000 positions.

### Width Caching

`MejiroBrowser` caches character widths at the codepoint level:

- Cache key: `"${fontSize}px ${fontFamily}"` maps to `Map<codepoint, width>`.
- Japanese text typically uses 2,000--3,000 unique characters, so the cache stabilizes quickly.
- First layout of a chapter: measures all characters via `Canvas.measureText()`.
- Subsequent layouts with the same font: near-instant (cache hits).
- Call `clearCache()` when changing fonts or after memory-intensive operations.

### Benchmarking

```bash
yarn bench  # Runs benchmarks
```

### Tips

- **Reuse a single `MejiroBrowser` instance** across layouts to benefit from the width cache.
- **Use `layoutChapter()`** instead of calling `layout()` in a loop -- it shares font loading and measurement across paragraphs.
- **Pre-measure fonts with `preloadFont()`** before the first layout to improve perceived performance:

```ts
const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

// Preload during app initialization
await mejiro.preloadFont();

// Subsequent layout calls skip the font loading step
const result = await mejiro.layout({ text, lineWidth: 400 });
```

---

## 4. Server-Side Usage

The core module (`@libraz/mejiro`) has zero DOM dependencies and works in any JavaScript runtime (Node.js, Deno, Bun, edge workers).

```ts
import { computeBreaks, toCodepoints, getLineRanges, paginate } from '@libraz/mejiro';

// You must provide advance widths yourself (no Canvas available)
const text = toCodepoints('吾輩は猫である。名前はまだ無い。');
const advances = new Float32Array(text.length).fill(16); // Fixed-width assumption

const result = computeBreaks({ text, advances, lineWidth: 128 });
const lines = getLineRanges(result.breakPoints, text.length);
const pages = paginate(400, [
  { lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 },
]);
```

Since `Canvas.measureText()` is not available on the server, options for obtaining advance widths include:

- **Fixed-width assumption** -- All CJK characters have equal advance. Simple and often sufficient for monospaced or fixed-layout scenarios.
- **Client-side pre-computation** -- Measure advances in the browser and send them to the server.
- **Font metrics libraries** -- Use a library such as fontkit or opentype.js to measure advances directly from font files.

---

## 5. Custom Rendering

The `RenderPage` data structure is framework-agnostic. You can render it to any target beyond the provided React and Vue components.

### RenderPage Structure

```ts
interface RenderPage {
  paragraphs: RenderParagraph[];
}

interface RenderParagraph {
  lines: RenderLine[];
  isHeading: boolean;
}

interface RenderLine {
  segments: RenderSegment[];
}

type RenderSegment =
  | { type: 'text'; text: string }
  | { type: 'ruby'; base: string; rubyText: string };
```

### Canvas Rendering

```ts
function renderToCanvas(ctx: CanvasRenderingContext2D, page: RenderPage): void {
  let x = ctx.canvas.width; // Start from right (vertical-rl)
  const lineHeight = 28.8;  // fontSize * lineHeight

  for (const paragraph of page.paragraphs) {
    for (const line of paragraph.lines) {
      x -= lineHeight;
      let y = 0;
      for (const segment of line.segments) {
        const text = segment.type === 'text' ? segment.text : segment.base;
        for (const char of text) {
          ctx.fillText(char, x, y + 16);
          y += 16;
        }
        // Ruby rendering omitted for brevity
      }
    }
  }
}
```

### String Output (for testing/debugging)

```ts
function renderToString(page: RenderPage): string {
  return page.paragraphs
    .map((p) =>
      p.lines
        .map((l) =>
          l.segments
            .map((s) => (s.type === 'text' ? s.text : `${s.base}(${s.rubyText})`))
            .join('')
        )
        .join('\n')
    )
    .join('\n\n');
}
```

---

## Related Documentation

- [03-line-breaking.md](./03-line-breaking.md) -- Line breaking algorithm, kinsoku modes, hanging punctuation
- [05-browser-integration.md](./05-browser-integration.md) -- MejiroBrowser, font measurement, width caching
- [08-react-and-vue.md](./08-react-and-vue.md) -- Pre-built React and Vue components for RenderPage
- [02-core-concepts.md](./02-core-concepts.md) -- Architecture, data flow, TypedArray conventions
