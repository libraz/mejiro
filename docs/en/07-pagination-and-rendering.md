# Pagination & Rendering

After computing line breaks, the next steps are:

1. Build paragraph measures (line pitch, gaps)
2. Paginate -- distribute lines across fixed-size pages
3. Build render pages -- convert page slices into renderable data
4. Render to DOM (vanilla JS, React, or Vue)

This document covers steps 1--3 and vanilla DOM rendering. For React and Vue components, see [React & Vue](./08-react-and-vue.md).

## 1. RenderEntry

`RenderEntry` is the bridge between layout results and the rendering pipeline. Build one per paragraph from the output of `layoutChapter()`:

```ts
import type { RenderEntry } from '@libraz/mejiro/render';

const entries: RenderEntry[] = chapter.paragraphs.map((p, i) => ({
  chars: result.paragraphs[i].chars,
  breakPoints: result.paragraphs[i].breakResult.breakPoints,
  rubyAnnotations: p.rubyAnnotations,
  isHeading: !!p.headingLevel,
}));
```

| Field | Type | Description |
|-------|------|-------------|
| `chars` | `string[]` | Character array (grapheme clusters) of the paragraph text. |
| `breakPoints` | `Uint32Array` | Break points from the line breaking algorithm. |
| `rubyAnnotations` | `RubyInputAnnotation[]` | Ruby annotations for this paragraph. |
| `isHeading` | `boolean` | Whether this paragraph is a heading. |

## 2. buildParagraphMeasures()

Converts render entries into `ParagraphMeasure[]` for use with `paginate()`. Computes line pitch (font size x line height) and inter-paragraph gaps based on whether each paragraph is a heading or body text.

```ts
import { buildParagraphMeasures } from '@libraz/mejiro/render';

const measures = buildParagraphMeasures(entries, {
  fontSize: 16,
  lineHeight: 1.8,
  headingScale: 1.4,
  paragraphGapEm: 0.4,
  headingGapEm: 1.2,
});
```

### MeasureOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fontSize` | `number` | (required) | Base font size in px. |
| `lineHeight` | `number` | (required) | Line height multiplier. |
| `headingScale` | `number` | `1.4` | Scale factor for heading font size (e.g., `16 * 1.4 = 22.4`). |
| `paragraphGapEm` | `number` | `0.4` | Gap before body paragraphs in em units. |
| `headingGapEm` | `number` | `1.2` | Gap after heading paragraphs in em units. |

### ParagraphMeasure

Each returned `ParagraphMeasure` contains:

| Field | Type | Description |
|-------|------|-------------|
| `lineCount` | `number` | Number of lines (`breakPoints.length + 1`). |
| `linePitch` | `number` | Size of each line in the block direction (px). `fontSize * lineHeight` for body, `headingFontSize * lineHeight` for headings. |
| `gapBefore` | `number` | Gap before this paragraph (px). Derived from the *previous* paragraph: `headingGap` if the previous paragraph was a heading, otherwise `paragraphGap`. Ignored when the paragraph starts a page. |

## 3. paginate()

Distributes paragraph lines across pages of fixed block size, splitting paragraphs at page boundaries when necessary.

```ts
import { paginate } from '@libraz/mejiro';

const pages = paginate(400, measures);
// pages[0] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 5 }, ...]
// pages[1] = [...]
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `pageBlockSize` | `number` | Available size in the block direction per page (px). In vertical-rl, this is the page **width** (columns flow right-to-left). |
| `paragraphs` | `ParagraphMeasure[]` | Measures for each paragraph. |

### Returns: `PageSlice[][]`

An array of pages, each containing an array of paragraph slices:

```ts
interface PageSlice {
  paragraphIndex: number;  // Index in the entries array
  lineStart: number;       // First line (0-based)
  lineEnd: number;         // End line (exclusive)
}
```

A paragraph that spans a page boundary will produce two `PageSlice` entries -- one on each page -- with different `lineStart`/`lineEnd` ranges.

## 4. buildRenderPage()

Converts page slices and render entries into a framework-agnostic `RenderPage` data structure ready for rendering.

```ts
import { buildRenderPage } from '@libraz/mejiro/render';

const renderPage = buildRenderPage(pages[0], entries);
```

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

Each line is split into segments. A `text` segment contains plain text; a `ruby` segment contains a base string and its ruby (furigana) reading. This structure maps directly to HTML `<ruby>` / `<rt>` elements.

## 5. mejiro.css

Required CSS for layout. Import it in your application:

```ts
import '@libraz/mejiro/render/mejiro.css';
```

### CSS Classes

| Class | Purpose |
|-------|---------|
| `.mejiro-page` | Root container. Sets `writing-mode: vertical-rl; width: 100%`. |
| `.mejiro-paragraph` | Paragraph column. `display: inline-block; white-space: nowrap; margin-left: 0.4em`. |
| `.mejiro-paragraph:first-child` | Removes left margin on the first paragraph. |
| `.mejiro-paragraph--heading` | Heading style. `font-weight: 700; font-size: 1.4em; height: 100%`. |
| `.mejiro-paragraph--heading + .mejiro-paragraph` | Gap after a heading (`margin-left: 1.2em`). |
| `.mejiro-page ruby` | `ruby-align: center`. |
| `.mejiro-page rt` | `font-size: 0.5em; font-weight: 400`. |

## 6. Vanilla DOM Rendering

Rendering a `RenderPage` to DOM without a framework:

```ts
function renderPageToDOM(container: HTMLElement, page: RenderPage): void {
  container.innerHTML = '';
  container.classList.add('mejiro-page');

  for (const paragraph of page.paragraphs) {
    const div = document.createElement('div');
    div.className = paragraph.isHeading
      ? 'mejiro-paragraph mejiro-paragraph--heading'
      : 'mejiro-paragraph';

    for (let li = 0; li < paragraph.lines.length; li++) {
      if (li > 0) div.appendChild(document.createElement('br'));
      for (const segment of paragraph.lines[li].segments) {
        if (segment.type === 'text') {
          div.appendChild(document.createTextNode(segment.text));
        } else {
          const ruby = document.createElement('ruby');
          ruby.appendChild(document.createTextNode(segment.base));
          const rt = document.createElement('rt');
          rt.textContent = segment.rubyText;
          ruby.appendChild(rt);
          div.appendChild(ruby);
        }
      }
    }

    container.appendChild(div);
  }
}
```

## 7. Complete Example

Full pipeline from text to rendered pages:

```ts
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderEntry } from '@libraz/mejiro/render';
import '@libraz/mejiro/render/mejiro.css';

// 1. Create a MejiroBrowser instance
const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

// 2. Lay out a chapter
const result = await mejiro.layoutChapter({
  paragraphs: [
    { text: '第一章' },
    { text: '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。' },
  ],
  lineWidth: mejiro.verticalLineWidth(600),
});

// 3. Build render entries
const entries: RenderEntry[] = [
  {
    chars: result.paragraphs[0].chars,
    breakPoints: result.paragraphs[0].breakResult.breakPoints,
    rubyAnnotations: [],
    isHeading: true,
  },
  {
    chars: result.paragraphs[1].chars,
    breakPoints: result.paragraphs[1].breakResult.breakPoints,
    rubyAnnotations: [],
    isHeading: false,
  },
];

// 4. Build measures and paginate
const measures = buildParagraphMeasures(entries, {
  fontSize: 16,
  lineHeight: 1.8,
});
const pages = paginate(400, measures);

// 5. Render each page
const container = document.getElementById('reader')!;
for (let i = 0; i < pages.length; i++) {
  const pageDiv = document.createElement('div');
  const renderPage = buildRenderPage(pages[i], entries);
  renderPageToDOM(pageDiv, renderPage);
  container.appendChild(pageDiv);
}
```

---

## Related Documentation

- [Browser Integration](./05-browser-integration.md) -- MejiroBrowser, font measurement, layoutChapter
- [EPUB](./06-epub.md) -- EPUB parsing and ruby extraction
- [React & Vue](./08-react-and-vue.md) -- Framework components for rendering
- [Core Concepts](./02-core-concepts.md) -- Architecture, data flow, TypedArrays
