# Pagination & Rendering

> **Tip:** For most applications, [`MejiroBook`](10-api-reference.md) from `@libraz/mejiro/book` is the recommended approach. It handles layout, pagination, and image exclusion in a single high-level API. The manual pipeline described below is useful when you need fine-grained control.

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
  inlineAnnotations: p.inlineAnnotations,
  kind: p.kind,
  headingLevel: p.headingLevel,
}));
```

| Field | Type | Description |
|-------|------|-------------|
| `chars` | `string[]` | Character array (grapheme clusters) of the paragraph text. |
| `breakPoints` | `Uint32Array` | Break points from the line breaking algorithm. |
| `inlineAnnotations` | `InlineAnnotation[]` | Inline ruby / emphasis / tcy / link annotations for this paragraph. |
| `kind` | `ParagraphKind \| undefined` | Structural classification (`'body'`, `'heading'`, `'blockquote'`, `'sceneBreak'`, `'pre'`, `'figure'`). Survives pagination into `RenderParagraph.kind`, where it selects the `mejiro-paragraph--*` class. Defaults to `'body'`. |
| `headingLevel` | `number \| undefined` | Heading level (1--6). Carry it through: without it every heading gets the same size, because per-level `headingStyles` are keyed on it, and the class falls back to the generic `--heading` modifier. |
| `isHeading` | `boolean \| undefined` | Deprecated. Set `kind: 'heading'` (with `headingLevel` when the level is known) instead. Ignored when `headingLevel` is set. |

## 2. buildParagraphMeasures()

Converts render entries into `ParagraphMeasure[]` for use with `paginate()`. Computes line pitch (font size x line spacing) and inter-paragraph gaps based on whether each paragraph is a heading or body text.

```ts
import { buildParagraphMeasures } from '@libraz/mejiro/render';

const measures = buildParagraphMeasures(entries, {
  fontSize: 16,
  lineSpacing: 1.8,
  headingScale: 1.4,
  paragraphGapEm: 0.4,
  headingGapEm: 1.2,
});
```

### MeasureOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fontSize` | `number` | (required) | Base font size in px. |
| `lineSpacing` | `number` | `1` | Line spacing multiplier. |
| `lineHeight` | `number` | -- | Deprecated alias for `lineSpacing`, used only when `lineSpacing` is absent. |
| `headingScale` | `number` | `1.4` | Scale factor for heading font size (e.g., `16 * 1.4 = 22.4`). Overridden per level by `headingStyles`. |
| `paragraphGapEm` | `number` | `0.4` | Gap before body paragraphs in em units. |
| `headingGapEm` | `number` | `1.2` | Gap after heading paragraphs in em units. Overridden per level by `headingStyles`. |
| `headingStyles` | `Record<number, HeadingStyle>` | -- | Per-level overrides of `scale` and `gapAfterEm`, keyed by heading level (1--6). |

### ParagraphMeasure

Each returned `ParagraphMeasure` contains:

| Field | Type | Description |
|-------|------|-------------|
| `lineCount` | `number` | Number of lines (`breakPoints.length + 1`). |
| `linePitch` | `number` | Size of each line in the block direction (px). `fontSize * lineSpacing` for body, `headingFontSize * lineSpacing` for headings. |
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
  headingLevel?: number;
  kind?: ParagraphKind;
}

interface RenderLine {
  segments: RenderSegment[];
}

type RenderSegment =
  | { type: 'text'; text: string }
  | { type: 'ruby'; base: string; rubyText: string; children?: readonly RenderSegment[] }
  | {
      type: 'emphasis';
      text: string;
      style: 'sesame' | 'dot' | 'circle';
      children?: readonly RenderSegment[];
    }
  | { type: 'tcy'; text: string; children?: readonly RenderSegment[] }
  | { type: 'em'; text: string; children?: readonly RenderSegment[] }
  | { type: 'strong'; text: string; children?: readonly RenderSegment[] }
  | { type: 'link'; text: string; href: string; title?: string; children?: readonly RenderSegment[] }
  | { type: 'footnote-ref'; text: string; noteId: string; children?: readonly RenderSegment[] };
```

Each line is split into segments. `text` contains plain text, `ruby` contains a base string and its ruby (furigana) reading, and other segment types represent inline emphasis, tate-chu-yoko, semantic emphasis, links, and footnote references.

`children` carries nested annotations (ruby inside emphasis, tate-chu-yoko inside a link, and so on). When it is present, render the children instead of the parent's own `text`/`base`; the parent still carries the flattened text of the whole span, so a renderer that only needs plain text can ignore `children` entirely.

## 5. mejiro.css

Required CSS for layout. Import it in your application:

```ts
import '@libraz/mejiro/render/mejiro.css';
```

### CSS Classes

| Class | Purpose |
|-------|---------|
| `.mejiro-page` | Root container. Sets `writing-mode: vertical-rl; width: 100%`. |
| `.mejiro-paragraph` | Paragraph column. `writing-mode: vertical-rl; display: inline-block; white-space: nowrap; margin-right: 0.4em`. |
| `.mejiro-paragraph:first-child` | Removes the block-start margin (`margin-right: 0`) on the first paragraph. |
| `.mejiro-paragraph--heading` | Heading style. `font-weight: 700; font-size: 1.4em; height: 100%`. |
| `.mejiro-paragraph--heading + .mejiro-paragraph` | Gap after a heading (`margin-right: 1.2em`). |
| `.mejiro-page ruby` | `ruby-align: center`. |
| `.mejiro-page rt` | `font-size: 0.5em; font-weight: 400`. |

Paragraph gaps are declared as `margin-right` because in `vertical-rl` the block-start
side is the right side: columns flow right to left, so the gap *before* a paragraph sits
on its right. Overriding `margin-left` adds a second gap on the opposite side instead of
changing the existing one.

## 6. Vanilla DOM Rendering

Rendering a `RenderPage` to DOM without a framework. `paragraphClassName()` is the
single source of the `mejiro-paragraph--*` modifiers, so the client renderer and
`renderEpubStatic()` agree on the class list:

```ts
import { paragraphClassName } from '@libraz/mejiro/render';

function renderPageToDOM(container: HTMLElement, page: RenderPage): void {
  container.innerHTML = '';
  container.classList.add('mejiro-page');

  for (const paragraph of page.paragraphs) {
    const div = document.createElement('div');
    div.className = paragraphClassName(paragraph.kind, paragraph.headingLevel);

    for (let li = 0; li < paragraph.lines.length; li++) {
      if (li > 0) div.appendChild(document.createElement('br'));
      for (const segment of paragraph.lines[li].segments) {
        appendInlineNode(div, segmentToInlineNode(segment));
      }
    }

    container.appendChild(div);
  }
}
```

`segmentToInlineNode()` (exported from `@libraz/mejiro/render`) resolves every
`RenderSegment` variant — including nested `children` and unsafe link URLs, which it
degrades to plain text — into a small, framework-agnostic element description:

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

The resulting markup per segment type:

| Segment type | Markup |
|--------------|--------|
| `text` | text node |
| `ruby` | `<ruby>base<rt>rubyText</rt></ruby>` |
| `emphasis` | `<span class="mejiro-emphasis mejiro-emphasis--sesame">` (or `--dot` / `--circle`) |
| `tcy` | `<span class="mejiro-tcy">` |
| `em` | `<em>` |
| `strong` | `<strong>` |
| `link` | `<a href>` with an optional `title`; a URL rejected by the sanitizer becomes a text node |
| `footnote-ref` | `<a class="mejiro-footnote-ref" href="#noteId">` |

Branching on `segment.type` by hand is still fine, but the branch must be exhaustive:
a two-way `text` / `ruby` split emits `<ruby>undefined<rt>undefined</rt></ruby>` for
emphasis, tate-chu-yoko, links and footnote references.

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
    inlineAnnotations: [],
    kind: 'heading',
    headingLevel: 1,
  },
  {
    chars: result.paragraphs[1].chars,
    breakPoints: result.paragraphs[1].breakResult.breakPoints,
    inlineAnnotations: [],
    kind: 'body',
  },
];

// 4. Build measures and paginate
const measures = buildParagraphMeasures(entries, {
  fontSize: 16,
  lineSpacing: 1.8,
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
