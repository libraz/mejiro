# Browser Integration

This document covers the browser-specific layer of mejiro (`@libraz/mejiro/browser`), which handles font loading, character measurement, and provides a high-level API for laying out Japanese vertical text in the browser.

## 1. MejiroBrowser Class

`MejiroBrowser` is the main entry point for browser-based layout. It manages font loading, character width caching, and layout computation. Create an instance and reuse it across layout calls to benefit from the width cache.

```ts
import { MejiroBrowser } from '@libraz/mejiro/browser';

const mejiro = new MejiroBrowser();
```

You can pass constructor options to set defaults that apply to all subsequent layout calls:

```ts
const mejiro = new MejiroBrowser({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  strictFontCheck: false,
});
```

### Constructor Options (`MejiroBrowserOptions`)

| Option | Type | Description |
|--------|------|-------------|
| `fontFamily` | `FontFamily` | Default font family for all layouts. |
| `fontSize` | `number` | Default font size (in px) for all layouts. |
| `strictFontCheck` | `boolean` | When `true`, `layout()`, `layoutParagraphs()` and `preloadFont()` reject if the requested family measures like the host's default font (a silent fallback). When `false` (the default), a font that fails to load is not an error: layout proceeds with whatever font the host resolves. |
| `onFontsLoaded` | `() => void` | Called after the host reports newly loaded fonts and the width cache has been cleared. Results measured earlier may hold fallback widths; lay them out again here. |

When `fontFamily` and `fontSize` are set, you can omit them from individual `layout()` and `layoutParagraphs()` calls. The constructor throws `TypeError` for an empty `fontFamily` and `RangeError` for a `fontSize` that is not a positive finite number.

## 2. Font Loading

Fonts must be loaded before character measurement can produce accurate results. `MejiroBrowser` handles this automatically inside `layout()` and `layoutParagraphs()`, but you can preload fonts explicitly to avoid the latency on the first layout call:

```ts
await mejiro.preloadFont('"Noto Serif JP"', 16);
```

If the font values are already set on the instance, you can call `preloadFont()` with no arguments:

```ts
await mejiro.preloadFont();
```

Internally, `preloadFont()` delegates to the `FontLoader` class, which calls `document.fonts.load()` to ensure the specified font is available for Canvas measurement.

`preloadFont()` runs the same `strictFontCheck` probe as `layout()`. The probe compares Latin glyph widths, so under `strictFontCheck` mejiro also requests the family's Latin range before probing. A family that loads for the measured text but has no Latin glyphs is not rejected. Outside the browser (no `document.fonts`), font loading resolves immediately.

A `MejiroBrowser` subscribes to `document.fonts` so it can clear its width cache when new fonts arrive. Call `dispose()` when you are done with an instance, so the font set stops referencing it. A disposed instance still works and subscribes again on its next layout. `MejiroBook.dispose()` does the same for a book, and `useMejiroBook` calls it on unmount.

## 3. Character Measurement

`CharMeasurer` measures character widths using `Canvas.measureText()`. Measured widths are stored in a `WidthCache` with a two-level map structure:

```
Map<fontSpec, Map<codepoint, width>>
```

- The first measurement of a character at a given font calls `Canvas.measureText()`.
- Subsequent lookups for the same character and font return the cached value immediately.
- `fontSpec` is a CSS font spec string such as `'16px "Noto Serif JP"'`.

You can clear the cache when fonts change or to free memory:

```ts
mejiro.clearCache();                          // Clear all cached widths
mejiro.clearCache('16px "Noto Serif JP"');    // Clear a specific font only
```

## 4. layout() -- Single Paragraph

`layout()` lays out a single paragraph of text. It loads the font (if not already loaded), measures character widths, and computes line break positions.

<!-- doc-example: 05-browser-layout.ts#layout -->
```ts
const result = await mejiro.layout({
  text: '吾輩は猫である。名前はまだ無い。',
  fontFamily: '"Noto Serif JP"', // Optional if the MejiroBrowser has a fontFamily
  fontSize: 16, // Optional if the MejiroBrowser has a fontSize
  lineWidth: verticalLineWidth(600, 16),
  kinsoku: 'strict',
  enableHanging: true,
  inlineAnnotations: [],
  tokenBoundaries: undefined,
});
// result: BreakResult { breakPoints, hangingAdjustments, effectiveAdvances? }
```

### LayoutOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | `string` | (required) | Text to lay out. |
| `fontFamily` | `FontFamily` | instance `fontFamily` | CSS font family. Overrides the instance default. |
| `fontSize` | `number` | instance `fontSize` | Font size in px. Overrides the instance default. |
| `lineWidth` | `number` | (required) | Available line width in px. |
| `kinsoku` | `'strict' \| 'loose'` | `'strict'` | Kinsoku processing mode. |
| `enableHanging` | `boolean` | `true` | Enable hanging punctuation. |
| `inlineAnnotations` | `readonly InlineAnnotation[]` | `[]` | Inline ruby / emphasis / tcy / link annotations using string-based indices. |
| `tokenBoundaries` | `Uint32Array \| readonly number[]` | `undefined` | Token boundary indices for improved line breaking. |
| `hints` | `TypographyHints` | `undefined` | Line breaking hints from `deriveTypographyHints()`; offsets address the NFC form of the text. |
| `breakCost` | `BreakCostOptions` | `undefined` | Weights for the penalty search. No effect unless `hints` carries break penalties. |

## 5. layoutParagraphs() -- Multiple Paragraphs

`layoutParagraphs()` lays out an entire chapter as a sequence of paragraphs. Each paragraph can override the base font family and font size, which is useful for headings or other stylistic variations.

<!-- doc-example: 05-browser-layout.ts#layout-chapter -->
```ts
const result = await mejiro.layoutParagraphs({
  paragraphs: [
    { text: '第一章', fontSize: 22 },
    { text: '吾輩は猫である。名前はまだ無い。' },
    {
      text: '漢字を読む',
      // A ruby over more than one base character names its type.
      inlineAnnotations: [
        { type: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', rubyType: 'group' },
      ],
    },
  ],
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: verticalLineWidth(600, 16),
  kinsoku: 'strict',
  enableHanging: true,
});

// result.paragraphs[i].breakResult -- BreakResult for paragraph i
// result.paragraphs[i].chars       -- string[] of characters
```

### ChapterLayoutOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `paragraphs` | `readonly ParagraphInput[]` | (required) | Array of paragraphs to lay out. |
| `fontFamily` | `FontFamily` | instance `fontFamily` | Base font family applied to all paragraphs. |
| `fontSize` | `number` | instance `fontSize` | Base font size applied to all paragraphs. |
| `lineWidth` | `number` | (required) | Line width in px. |
| `kinsoku` | `'strict' \| 'loose'` | `'strict'` | Kinsoku processing mode. |
| `enableHanging` | `boolean` | `true` | Enable hanging punctuation. |
| `breakCost` | `BreakCostOptions` | `undefined` | Weights for the penalty search, applied to every paragraph. No effect unless a paragraph's `hints` carries break penalties. |

### ParagraphInput

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | `string` | (required) | Paragraph text. |
| `inlineAnnotations` | `readonly InlineAnnotation[]` | `[]` | Inline annotations for this paragraph. |
| `fontFamily` | `FontFamily` | (inherited) | Override the base font family for this paragraph. |
| `fontSize` | `number` | (inherited) | Override the base font size for this paragraph. |
| `tokenBoundaries` | `Uint32Array \| readonly number[]` | `undefined` | Token boundary indices. |
| `hints` | `TypographyHints` | `undefined` | Line breaking hints from `deriveTypographyHints()`; offsets address the NFC form of this paragraph's text. |

## 6. verticalLineWidth()

Computes the effective line width for vertical text layout. This compensates for the difference between Canvas horizontal measurement and CSS vertical rendering by subtracting half a character width from the container height.

```ts
import { verticalLineWidth } from '@libraz/mejiro/browser';

const lineWidth = verticalLineWidth(600, 16);
// Returns: 600 - 16 * 0.5 = 592
```

**Formula:** `containerHeight - fontSize * 0.5`

The `MejiroBrowser` instance also exposes this as a method, using its `fontSize` when set:

```ts
const lineWidth = mejiro.verticalLineWidth(600);
```

## 7. layoutText() -- Standalone Function

`layoutText()` is a one-shot layout function that does not require creating a `MejiroBrowser` instance. It creates its own measurer internally, so there is no caching across calls.

```ts
import { layoutText } from '@libraz/mejiro/browser';

const result = await layoutText({
  text: '吾輩は猫である。',
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: 128,
});
```

`layoutText()` takes `LayoutTextOptions`, which is `LayoutOptions` with `fontFamily` and `fontSize` required. This is convenient for single-use scenarios. For repeated layouts, use `MejiroBrowser` instead -- it reuses the width cache and avoids redundant font loading and measurement.

## 8. Other Exports

The `@libraz/mejiro/browser` subpath also exports lower-level building blocks:

| Export | Description |
|--------|-------------|
| `FontLoader` | Low-level font loading via the FontFace API (`document.fonts.load`). |
| `CharMeasurer` | Low-level character measurement via `Canvas.measureText()`. |
| `MejiroError` | The error class for failures that are not argument errors: `font-unavailable` under `strictFontCheck`, `font-load-failed` from `FontLoader`, `environment-unsupported` when no canvas is available. |
| `WidthCache` | Width cache with `Map<fontSpec, Map<codepoint, width>>` structure. |
| `deriveRubyFont(fontFamily, fontSize)` | Derives the ruby font spec (typically half the base font size). |
| `toFontSpec(fontFamily, fontSize)` | Composes a CSS font spec string (e.g., `'16px "Noto Serif JP"'`). |

---

## Related Documentation

- [Getting Started](./01-getting-started.md)
- [Core Concepts](./02-core-concepts.md)
