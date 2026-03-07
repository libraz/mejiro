# Ruby Annotations

## What is Ruby?

Ruby annotations (振り仮名 / furigana) are small characters placed alongside base text to indicate pronunciation. They are common in Japanese text, where they provide readings for kanji characters.

For example, in the word 漢字 (kanji), the small hiragana かんじ displayed above or beside the characters is the ruby annotation. In vertical text layout, ruby appears to the right of the base characters.

Ruby is essential for readability in many contexts: children's books, educational materials, legal documents, and literary works that use unusual or archaic kanji readings.

## Ruby Types

The JLReq (Requirements for Japanese Text Layout, W3C) specification defines three ruby types:

### Mono Ruby

One base character paired with one or more ruby characters. Each base character has its own independent annotation.

Example: 字 with ruby じ.

Mono ruby allows line breaks between annotated characters since each annotation is self-contained.

### Group Ruby

Multiple base characters share a single ruby annotation that cannot be split. The annotation must stay together with all of its base characters.

Example: 東京 with ruby とうきょう. The four ruby characters annotate the two-character compound as a unit; you cannot break the line between 東 and 京.

### Jukugo Ruby

A compound word where each kanji has its own reading, but the characters form a visual unit. Unlike group ruby, jukugo ruby can be split at designated points when necessary for line breaking.

Example: 東京都 where 東=とう, 京=きょう, 都=と. Split points allow breaks after 東 and after 京, but the ruby text for each sub-group stays with its base characters.

## Core Level: RubyAnnotation and preprocessRuby()

At the core level, ruby works with codepoint arrays and measured advance widths. The core module has zero external dependencies.

### RubyAnnotation Interface

```ts
interface RubyAnnotation {
  startIndex: number;        // Start in base text codepoint array (inclusive)
  endIndex: number;          // End in base text codepoint array (exclusive)
  rubyText: Uint32Array;     // Ruby text as codepoints
  rubyAdvances: Float32Array; // Measured ruby character widths in pixels
  type?: 'mono' | 'group' | 'jukugo'; // Default: 'mono'
  jukugoSplitPoints?: number[]; // For jukugo: base-text-relative indices where breaks are allowed
}
```

### preprocessRuby()

`preprocessRuby()` distributes ruby text widths across base characters and generates cluster IDs to prevent invalid line breaks within ruby groups. It returns two arrays:

- **effectiveAdvances** -- Adjusted advance widths. When ruby text is wider than its base text, the excess is distributed across the base characters.
- **clusterIds** -- Characters sharing the same cluster ID cannot be split across lines. Group ruby assigns one cluster ID to all base characters; jukugo ruby creates sub-group clusters between split points.

Width distribution follows JLReq rules:

1. If ruby text is wider than base text, check for adjacent kana characters.
2. Up to 50% of an adjacent kana character's advance can absorb ruby overhang (left and right independently).
3. Any remaining excess is distributed proportionally across the base characters.

```ts
import { preprocessRuby, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('漢字を読む');
const advances = new Float32Array([16, 16, 16, 16, 16]);

const annotations: RubyAnnotation[] = [{
  startIndex: 0,
  endIndex: 2,
  rubyText: toCodepoints('かんじ'),
  rubyAdvances: new Float32Array([8, 8, 8]), // 3 ruby chars x 8px = 24px
  type: 'group',
}];

const { effectiveAdvances, clusterIds } = preprocessRuby(text, advances, annotations);
// Base width for indices 0-1: 32px (2 x 16). Ruby width: 24px.
// Ruby is narrower than base, so no excess to distribute.
// clusterIds: [0, 0, 2, 3, 4] -- indices 0 and 1 share a cluster (group ruby)
```

In practice, you rarely call `preprocessRuby()` directly. When you pass `rubyAnnotations` in a `LayoutInput` to `computeBreaks()`, the function calls `preprocessRuby()` internally and uses the resulting effective advances and cluster IDs during line breaking.

```ts
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const text = toCodepoints('漢字を読む');
const advances = new Float32Array([16, 16, 16, 16, 16]);

const result = computeBreaks({
  text,
  advances,
  lineWidth: 48,
  rubyAnnotations: [{
    startIndex: 0,
    endIndex: 2,
    rubyText: toCodepoints('かんじ'),
    rubyAdvances: new Float32Array([8, 8, 8]),
    type: 'group',
  }],
});
// Line breaks respect group clustering: indices 0 and 1 will not be split.
```

## Browser Level: RubyInputAnnotation

The browser layer provides a string-based annotation interface that is easier to work with. Codepoint conversion and advance measurement are handled automatically.

### RubyInputAnnotation Interface

```ts
interface RubyInputAnnotation {
  startIndex: number;   // Character index in base text string
  endIndex: number;     // End index (exclusive)
  rubyText: string;     // Ruby text as a plain string
  type?: 'mono' | 'group' | 'jukugo';
  jukugoSplitPoints?: number[];
}
```

When you call `MejiroBrowser.layout()` or `layoutChapter()` with `rubyAnnotations`, the browser layer automatically:

1. Converts the ruby text string to a `Uint32Array` of codepoints.
2. Measures ruby character advance widths using `Canvas.measureText()`.
3. Derives the ruby font size (typically 50% of the base font size).
4. Constructs core-level `RubyAnnotation[]` and passes them to `computeBreaks()`.

```ts
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';

const mejiro = new MejiroBrowser();

const result = await mejiro.layout({
  text: '漢字を読む',
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: 200,
  rubyAnnotations: [{
    startIndex: 0,
    endIndex: 2,
    rubyText: 'かんじ',
    type: 'group',
  }],
});
```

For chapter-level layout with multiple paragraphs, use `layoutChapter()`:

```ts
const chapterResult = await mejiro.layoutChapter({
  paragraphs: [
    {
      text: '漢字を読む',
      rubyAnnotations: [{
        startIndex: 0,
        endIndex: 2,
        rubyText: 'かんじ',
        type: 'group',
      }],
    },
    {
      text: '名前はまだ無い',
      rubyAnnotations: [],
    },
  ],
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: verticalLineWidth(600, 16),
});
```

## Ruby from EPUB

When parsing EPUB files, the `extractRubyContent()` function automatically detects `<ruby><rt>` elements in XHTML content and produces `RubyInputAnnotation[]` for each paragraph.

```ts
import { parseEpub } from '@libraz/mejiro/epub';

const book = await parseEpub(buffer);
const paragraph = book.chapters[0].paragraphs[0];
// paragraph.text   -- base text with ruby content stripped out
// paragraph.rubyAnnotations -- RubyInputAnnotation[] with character indices into text
```

The extractor handles all common HTML ruby markup patterns:

- Simple: `<ruby>漢字<rt>かんじ</rt></ruby>`
- With `<rp>` (parenthesized fallback): `<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>`
- With `<rb>` (explicit base): `<ruby><rb>漢字</rb><rt>かんじ</rt></ruby>`
- Multiple base-rt pairs (jukugo): `<ruby>東<rt>とう</rt>京<rt>きょう</rt>都<rt>と</rt></ruby>`

For multiple base-rt pairs, the extractor creates individual annotations for each pair and an additional jukugo-level annotation spanning the entire compound word with split points, so the line breaking algorithm can split the compound at sub-group boundaries when needed.

## Rendering Ruby

`buildRenderPage()` produces `RenderSegment` entries that distinguish between plain text and ruby-annotated text:

```ts
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import { paginate } from '@libraz/mejiro';

// After layout...
const pages = paginate(400, measures);
const page = buildRenderPage(pages[0], entries);

for (const para of page.paragraphs) {
  for (const line of para.lines) {
    for (const segment of line.segments) {
      if (segment.type === 'ruby') {
        // segment.base     -- base text string
        // segment.rubyText -- ruby text string
        // Render as: <ruby>base<rt>rubyText</rt></ruby>
      } else {
        // segment.type === 'text'
        // segment.text -- plain text string
      }
    }
  }
}
```

The `mejiro.css` stylesheet (imported from `@libraz/mejiro/render/mejiro.css`) styles `<ruby>` and `<rt>` elements within `.mejiro-page`:

- `ruby-align: center` -- centers ruby text over the base.
- `rt { font-size: 0.5em; font-weight: 400; }` -- ruby text at half the base font size with normal weight.

The React and Vue component packages (`@libraz/mejiro-react`, `@libraz/mejiro-vue`) render `RenderPage` data directly, including ruby segments as proper `<ruby><rt>` HTML elements.

## Related Documentation

- [Getting Started](01-getting-started.md) -- Installation and quick start
- [Core Concepts](02-core-concepts.md) -- Architecture and data flow
- [Line Breaking](03-line-breaking.md) -- Kinsoku and hanging punctuation
- [Browser Integration](05-browser-integration.md) -- MejiroBrowser class
- [API Reference](10-api-reference.md) -- Complete API listing
