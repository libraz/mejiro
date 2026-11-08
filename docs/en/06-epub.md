# EPUB Parsing and Authoring

The `@libraz/mejiro/epub` subpath export provides functions for parsing EPUB files into structured data with inline annotations, editing existing EPUBs, and building new EPUB 3 packages from manuscript text.

## parseEpub()

The main entry point for EPUB parsing. Accepts the EPUB file (a ZIP archive) as a `BinaryInput` — an `ArrayBuffer` or a `Uint8Array`, a Node `Buffer` included — and returns a promise resolving to an `EpubBook`. The input is read within its view and neither kept nor modified.

```ts
import { parseEpub } from '@libraz/mejiro/epub';

const epub = await parseEpub(epubBytes);
console.log(epub.title);   // Book title from OPF metadata
console.log(epub.author);  // Author (optional)
console.log(epub.chapters.length);
```

## Internal Flow

The following diagram shows how `parseEpub()` transforms an EPUB file into structured paragraph data:

![How parseEpub reads an EPUB in six steps: unzip under the import limits, container.xml, the OPF package, the spine's XHTML documents, extractRubyContent paragraphs and chapter grouping, with the navigation document and NCX as a dashed side branch that only supplies chapter titles](../images/epub-parse-flow.svg)

Steps:

1. **Unzip** -- The EPUB file is decompressed using JSZip, after the archive is checked against the import limits described below.
2. **container.xml** -- `META-INF/container.xml` is read to locate the rootfile path (the OPF file).
3. **OPF parsing** -- The OPF file is parsed to extract metadata (`dc:title`, `dc:creator`), the spine (reading order of content documents), and the table-of-contents documents: the EPUB 3 navigation document and the EPUB 2 NCX. A manifest map (id to href) is built to resolve spine itemrefs to file paths.
4. **XHTML extraction** -- For each spine item, the corresponding XHTML content document is read from the ZIP archive.
5. **Paragraph extraction** -- `extractRubyContent()` walks the DOM of each XHTML document, collecting base text and ruby annotations into `AnnotatedParagraph[]`.
6. **Chapter grouping** -- Paragraphs are grouped into `EpubChapter` entries and returned as an `EpubBook` with the title and author from the OPF metadata.

The chapter title comes from the document's own `id="chapter-title"` element if it has one, otherwise from its first `h1`, `h2` or `h3`, and otherwise from the table of contents: the navigation document first, then the NCX `navMap` for chapters the navigation document does not name.

Empty chapters (those with no paragraphs after extraction) are omitted from the result.

A failure is a `MejiroError` whose `code` says what went wrong: `epub-invalid-archive` for input that is not a readable ZIP archive, `epub-invalid-package` for a malformed container, package document or chapter (or no readable chapter), `epub-limit-exceeded` for an archive past the limits below, and `dom-unavailable` for a host without a DOM implementation.

```ts
import { MejiroError, parseEpub } from '@libraz/mejiro/epub';

try {
  await parseEpub(bytes);
} catch (error) {
  if (error instanceof MejiroError && error.code === 'epub-invalid-archive') {
    showMessage('This file is not an EPUB.');
  } else {
    throw error;
  }
}
```

Pass `signal` to cancel a parse: `parseEpub(bytes, { signal })` rejects with `signal.reason` once the signal fires.

### Import limits for untrusted EPUBs

`parseEpub()` and `parseEditableEpub()` reject archives that exceed safe defaults for compressed input size, entry count, expanded entry size, total expanded size, or compression ratio. Pass `limits` only when a trusted environment needs a different ceiling:

```ts
const epub = await parseEpub(data, {
  limits: { maxTotalBytes: 300 * 1024 * 1024 },
});
```

`DEFAULT_EPUB_PARSE_LIMITS` and the `EpubParseLimits` / `EpubParseOptions` types are exported from `@libraz/mejiro/epub`. `assertEpubInputSize(file.size, limits)` applies the `maxInputBytes` check to a `File` before any of it is read; the `loadFile` of `useEpub`, `useEditableEpub` and `MejiroEditor` already does.

## Data Model

```ts
interface EpubBook {
  readonly title: string;          // From OPF dc:title
  readonly author?: string;        // From OPF dc:creator
  readonly chapters: readonly EpubChapter[];
}

interface EpubChapter {
  readonly title?: string;         // From h1/h2/h3 in the XHTML
  readonly paragraphs: readonly AnnotatedParagraph[];
}

interface AnnotatedParagraph {
  text: string;                                   // Base text (ruby text stripped)
  inlineAnnotations: readonly InlineAnnotation[]; // Ruby / emphasis / tcy / links / notes
  headingLevel?: HeadingLevel;                    // 1-6 if from h1-h6 element
}
```

Ruby is represented as the `type: 'ruby'` variant of `InlineAnnotation`, defined in `@libraz/mejiro`:

```ts
interface InlineRubyAnnotation {
  type: 'ruby';
  startIndex: number;                  // Character index, not byte offset
  endIndex: number;                    // Exclusive
  rubyText: string;
  rubyType?: 'mono' | 'group' | 'jukugo';
  jukugoSplitPoints?: readonly number[];
}
```

When authoring from plain manuscript text, `parseManuscript(text, { dialect })` extracts ruby, emphasis dots, tate-chu-yoko, and other inline annotations in one pass. The full list of markers recognized by each dialect is summarized in [Manuscript notation dialects (parseManuscript)](#manuscript-notation-dialects-parsemanuscript) below.

## extractRubyContent()

Low-level function to extract paragraphs from an XHTML string. Used internally by `parseEpub()` but also available for direct use.

```ts
import { extractRubyContent } from '@libraz/mejiro/epub';

const xhtml = `<html><body>
  <p><ruby>漢字<rt>かんじ</rt></ruby>を読む</p>
  <h2>第二章</h2>
  <p>本文です。</p>
</body></html>`;

const paragraphs = extractRubyContent(xhtml);
// paragraphs[0].text === '漢字を読む'
// paragraphs[0].inlineAnnotations === [
//   { type: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', rubyType: 'group' }
// ]
// paragraphs[1].text === '第二章'
// paragraphs[1].headingLevel === 2
// paragraphs[2].text === '本文です。'
```

### Block-level elements

The following elements create paragraph boundaries: `p`, `div`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `blockquote`, `li`, `dt`, `dd`, `section`, `article`, `main`, `td`, `th`, `pre`, `table`, `tr`, `figcaption`.

If the XHTML document contains no block-level elements, the entire body is treated as a single paragraph.

When an element mixes inline content with block elements nested inside it, each inline run becomes its own paragraph, emitted in source order, whether or not the owning element is itself a block. For example `<div>A<p>B</p>C</div>` yields three paragraphs: `A`, `B`, `C`, and so does `<body>A<p>B</p><span>C</span></body>`.

### Ruby handling

- `<ruby>base<rt>reading</rt></ruby>` produces a mono annotation (single base character) or group annotation (multiple base characters).
- `<rp>` elements are ignored entirely.
- `<rb>` elements are treated as base text.
- When a `<ruby>` element has no direct `<rt>` children, the readings inside its `<rtc>` container are used instead.
- Multiple base-rt pairs within a single `<ruby>` element produce individual annotations for each pair, plus an additional jukugo-level annotation spanning the entire ruby group with `jukugoSplitPoints` indicating where line breaks are permitted within the base text.
- Other inline elements inside `<ruby>` are treated as base text.
- Trailing base text inside `<ruby>` with no following `<rt>` is emitted as plain text without a ruby annotation.

### Character indexing

Indices in `InlineRubyAnnotation` are character indices (counting Unicode characters, not UTF-16 code units). Surrogate pairs are counted as a single character.

## Loading EPUB Files

### From File Input

```ts
const input = document.createElement('input');
input.type = 'file';
input.accept = '.epub';
input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  const epub = await parseEpub(buffer);
});
```

### From Drag and Drop

```ts
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file?.name.endsWith('.epub')) return;
  const buffer = await file.arrayBuffer();
  const epub = await parseEpub(buffer);
});
```

### From fetch

```ts
const response = await fetch('/books/example.epub');
const buffer = await response.arrayBuffer();
const epub = await parseEpub(buffer);
```

## Using EPUB with Layout

Complete example showing the full pipeline from EPUB parsing through layout to render-ready page data:

<!-- doc-example: 06-epub-layout.ts#pipeline -->
```ts
import { paginate } from '@libraz/mejiro';
import { DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { parseEpub } from '@libraz/mejiro/epub';
import { buildParagraphMeasures, buildRenderPage, type RenderEntry } from '@libraz/mejiro/render';

const fontSize = 16;
const mejiro = new MejiroBrowser({
  fontFamily: '"Noto Serif JP"',
  fontSize: fontSize,
});

const epub = await parseEpub(buffer);
const chapter = epub.chapters[0];

// Break a heading at the size buildParagraphMeasures() measures it at: the level's
// DEFAULT_HEADING_STYLES scale, rounded to whole pixels.
const headingSize = (level: number) =>
  Math.round(fontSize * (DEFAULT_HEADING_STYLES[level]?.scale ?? 1));

const result = await mejiro.layoutParagraphs({
  paragraphs: chapter.paragraphs.map((p) => ({
    text: p.text,
    inlineAnnotations: p.inlineAnnotations,
    fontSize: p.headingLevel ? headingSize(p.headingLevel) : undefined,
  })),
  lineWidth: mejiro.verticalLineWidth(600),
});

const entries: RenderEntry[] = chapter.paragraphs.map((p, i) => ({
  chars: result.paragraphs[i].chars,
  breakPoints: result.paragraphs[i].breakResult.breakPoints,
  inlineAnnotations: p.inlineAnnotations,
  headingLevel: p.headingLevel,
}));

const measures = buildParagraphMeasures(entries, { fontSize, lineSpacing: 1.8 });
const pages = paginate(400, measures);
const renderPage = buildRenderPage(pages[0], entries);
```

## Editing Existing EPUBs

Use `parseEditableEpub()` / `EditableEpub` when you need to patch an existing package and export it again:

<!-- doc-example: 06-epub-editing.ts#update -->
```ts
import { parseEditableEpub } from '@libraz/mejiro/epub';

const editor = await parseEditableEpub(buffer);

// Mutators address an existing block by its id.
const [, , block] = editor.epub.chapters[0].blocks;

editor.updateParagraph(0, block.id, {
  text: '差し替え後の本文',
  inlineAnnotations: [
    // 本文 sits at indices 6 and 7: startIndex is inclusive, endIndex exclusive.
    { type: 'ruby', startIndex: 6, endIndex: 8, rubyText: 'ほんぶん', rubyType: 'group' },
  ],
});

const nextBuffer = await editor.export({
  onProgress(stage, ratio) {
    console.log(stage, ratio);
  },
});
```

Editable chapters hold their content in `chapter.blocks`, where paragraph blocks and image blocks are siblings. Every mutator addresses an existing block by `(chapterIndex, blockId)`; an index appears only where a block is put. An unknown chapter index or block id, or the id of a block of the wrong kind, throws `RangeError`, and an edit that throws changes and records nothing.

| Task | Call | Notes |
|---|---|---|
| Change a paragraph | `editor.updateParagraph(chapterIndex, blockId, patch)` | `patch` is a `ParagraphPatch`. Without `paragraphKind` the kind is kept; changing the kind brings the fields the new kind needs (`headingLevel` for `'heading'`, no text for `'sceneBreak'`). Text changed without new annotations keeps each annotation on the same base characters or drops it |
| Insert a paragraph | `editor.insertParagraph(chapterIndex, index, paragraph)` | `index` is a position in `chapter.blocks`; append with `chapter.blocks.length`. `paragraph` is a `NewParagraph`, so `{ text }` is a body paragraph. Returns the stored block with its generated `id` |
| Replace annotations | `editor.setInlineAnnotations(chapterIndex, blockId, annotations)` | Annotations outside the current text are dropped |
| Remove a block | `editor.deleteBlock(chapterIndex, blockId)` | Paragraph or image. Removing the last reference to an image asset also drops the asset |
| Split a paragraph | `editor.splitParagraph(chapterIndex, blockId, charIndex)` | The block keeps its id and the text before the split; returns the new block after it. A fractional `charIndex` is truncated, an out-of-range one is clamped and a non-finite one throws. Annotations straddling the split are dropped |
| Merge two paragraphs | `editor.mergeParagraphs(chapterIndex, { leftId, rightId })` | `rightId` must immediately follow `leftId`. Returns the merged block |
| Add an image | `editor.addImage(chapterIndex, { filename, data, alt?, caption?, placement?, afterBlockId? })` | Returns the image block; `block.assetKey` names the new asset. `url` in place of `data` defers the bytes to export time (below) |
| Remove an image asset | `editor.removeImageAsset(assetKey)` | Removes the asset and every block that shows it, as one history entry |
| Change an image block | `editor.updateImage(chapterIndex, blockId, patch)` / `editor.setImageCaption(chapterIndex, blockId, caption)` | In `updateImage` a field passed as `undefined` is removed and a field left out is untouched. `setImageCaption(…, null)` removes the caption |
| Move a block | `editor.moveBlock(chapterIndex, blockId, toIndex)` | `toIndex` is the target index in `blocks`, clamped |

#### Walking the blocks

A block keeps its id across edits, so a loop over `chapter.blocks` can edit the blocks it visits:

<!-- doc-example: 06-epub-editing.ts#walk-blocks -->
```ts
for (const block of editor.epub.chapters[0].blocks) {
  if (block.kind !== 'paragraph' || !block.text.includes(query)) continue;
  editor.updateParagraph(0, block.id, { text: block.text.replaceAll(query, replacement) });
}
```

#### Undo/redo, transactions, change notifications, and progress

`editor.transaction(fn)` groups several edits into one history entry; a throw inside `fn` rewinds them. `fn` runs synchronously, and a callback returning a promise is rejected by the type. `editor.undo()` / `editor.redo()` / `editor.history` expose the history. `editor.subscribe(listener)` calls `listener` after every change — each edit, each completed transaction once, each undo and redo — and returns the function that removes it; `useEditableEpub` relies on it, so an edit made on the editor directly still re-renders. `editor.export({ onProgress, signal, assetResolver, watermark })` resolves to a `Uint8Array`. `onProgress(phase, ratio)` runs `ratio` from 0 to 1 within each phase (`'serialize'`, then `'zip'`); `signal` cancels the export, which then rejects with `signal.reason`; `watermark` inserts a paragraph at the top of every exported chapter without touching the edited document.

Unedited chapters are written back from their original XHTML so stylesheet links, list wrappers, tables, and other source structure stay intact. Edited chapters preserve the document shell (`html`, `head`, `body`, and stylesheet links), any whole-chapter wrapper (`section`, `article`, `main` or `div` around the content, with its attributes) and the chapter-title element (`id="chapter-title"`, rewritten from `chapter.title`); the blocks are rebuilt inside them. An image inside a paragraph is imported as an image block of its own, splitting the paragraph around it. Exporting an edited chapter rejects with `MejiroError` `epub-unsupported-content` instead of silently losing content when its source carries list or table containers (`ul`, `ol`, `dl`, `table`, `thead`, `tbody`), embedded content (`svg`, `math`, `video`, `audio`, `iframe`, `object`, `embed`, `canvas`), an element `id` other than the chapter-title one, text inside a hidden or non-rendered element such as `script` or `style`, an image whose `src` does not resolve to a file in the archive (a `data:` URI included), a `figure` with more than one image or content besides one image and its caption, or a `blockquote` around anything other than paragraphs. A `blockquote` of paragraphs is imported as `blockquote` blocks and written back the same way.

#### URL-only image registration (assetResolver)

`addImage()` accepts `{ filename, url }` as an alternative to `{ filename, data }`. The bytes are only resolved when `editor.export({ assetResolver })` runs, so the editor session can hold remote URLs without ever materializing the image bytes client-side.

```ts
editor.addImage(0, {
  filename: 'figure-01.png',
  url: 'https://cdn.example.com/works/1/figure-01.png',
  alt: 'figure',
});

const bytes = await editor.export({
  assetResolver: async ({ href, url, signal }) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`asset ${href} failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
});
```

When `assetResolver` is omitted, the runtime `fetch(url, { signal })` is used by default, and a failure status rejects the export with `MejiroError` `asset-fetch-failed`. See [09-advanced.md §7.4](09-advanced.md#74-delivering-image-assets-assetresolver) for the end-to-end novel-posting-site pattern.

## Building EPUBs from Manuscript Text

`EpubProject` creates a new EPUB 3 package from `ManuscriptChapter` drafts (`{ id?, title, body }`). Manuscript ruby uses Aozora-style notation such as `｜漢字《かんじ》`.

```ts
import { EpubProject } from '@libraz/mejiro/epub';

const project = new EpubProject({
  metadata: {
    title: '新しい作品',
    creators: [{ name: '作者名', role: 'aut' }],
    language: 'ja',
  },
  dialect: 'mejiro',
  chapters: [
    {
      title: '第一話',
      body: 'これは｜漢字《かんじ》のルビ例です。\n\n本文を続けます。',
    },
  ],
});

project.addChapter({ title: '第二話', body: '続きの本文です。' });
const epubBytes = await project.export(); // Uint8Array
```

The project's state is read-only from outside. Change it through its methods: `updateMetadata(patch)`, `setStylesheet(css)`, `addChapter` / `updateChapter` / `removeChapter` / `reorderChapters`, `addImage(chapterIndex, { filename, data, atParagraphIndex, alt? })` (the class picks the path, `OPS/Images/<filename>`), `setCover({ data, mediaType, filename? })` and `addAsset`. `addChapter`, `addImage`, `setCover` and `addAsset` return what they stored. `export()` rejects with `MejiroError` `epub-invalid-package` when the project has no chapters.

## Manuscript notation dialects (parseManuscript)

`parseManuscript(text, options)` consumes one manuscript paragraph and returns `text` (the base text) plus `inlineAnnotations` (the array of inline annotations). `options.dialect` selects which markers are recognized — the default is `'mejiro'`.

```ts
import { parseManuscript } from '@libraz/mejiro/epub';

parseManuscript('｜漢字《かんじ》を読む');                       // defaults to 'mejiro'
parseManuscript('｜漢字《かんじ》を読む', { dialect: 'narou' });
parseManuscript('｜漢字《かんじ》を読む', { dialect: 'kakuyomu' });
```

`EpubProject.fromManuscript()` and `<MejiroManuscriptEditor>` call `parseManuscript()` internally, so passing `dialect` to those APIs switches interpretation for the whole manuscript. `useManuscriptDraft()` only stores the chapter text and `useEpubProject()` always parses with the `mejiro` dialect.

### Marker support per dialect

| Marker | Example | Emitted annotation | `mejiro` (default) | `narou` | `kakuyomu` |
|--------|---------|--------------------|:--:|:--:|:--:|
| Pipe ruby | `｜漢字《かんじ》` | `type: 'ruby'` | ✅ | ✅ | ✅ |
| Auto ruby (kanji + 《》) | `漢字《かんじ》` | `type: 'ruby'` | ✅ | ✅ | ✅ |
| Emphasis dots (sesame) | `《《重要》》` | `type: 'emphasis'` (`style: 'sesame'`) | ✅ | — | — |
| Tate-chu-yoko | `〔20〕` | `type: 'tcy'` | ✅ | — | — |
| Footnote reference | `[[#note-1]]` | `type: 'footnote-ref'` | ✅ | — | — |
| Link | `[label](https://example.com)` | `type: 'link'` | ✅ | — | — |
| Strong | `**text**` | `type: 'strong'` | ✅ | — | — |
| Emphasis (italic) | `*text*` | `type: 'em'` | ✅ | — | — |

`narou` and `kakuyomu` currently behave identically — both restrict parsing to Aozora-compatible ruby. Choose one of them when ingesting manuscripts copied from those sites verbatim, or when you want `*` / `[]` characters to survive as literal body text. Under those dialects, sequences such as `**text**` or `〔20〕` flow through to the body without producing annotations.

### Marker semantics and constraints

- **Auto ruby**: the base text must be a contiguous run of `Script=Han` (kanji) characters or one of `々〆ヶ`. Hiragana, katakana, and symbols do not trigger auto ruby — use the pipe form (`｜...《...》`) for those.
- **Pipe ruby**: any base text is allowed. The parser tries pipe ruby before auto ruby, so prefix `｜` whenever you need ruby over non-kanji. With an empty base (`｜《かな》`), the pipe is dropped and `《かな》` renders literally, with no annotation.
- **Line feeds**: a closing marker must sit on the same line as its opener, so no notation, auto ruby (`漢字《…》`) included, spans a line feed.
- **Emphasis dots**: if the matching `》》` cannot be found, the literal `《《...` flows through as plain text. The emitted annotation uses `style: 'sesame'`; for other styles (e.g. `dot`), build the `InlineAnnotation` directly.
- **Tate-chu-yoko**: the body inside `〔...〕` must match `[A-Za-z0-9!?]+` and be at most 5 characters long (7 including the brackets), so `〔12345〕` is annotated but `〔123456〕` is not. Mixed Japanese or longer payloads fall through as literal body text.
- **Footnote reference**: the body text receives `*<id>` (e.g. `*note-1`) plus the matching `type: 'footnote-ref'` annotation. Managing the footnote target itself is left to the host application.
- **Link**: both `[label](href)` and `[label](href "title")` are accepted. Empty link text (`[](url)`) stays literal body text. The `href` is a single whitespace-free token and `title` must be double-quoted.
- **Strong / Emphasis**: `**` is tried before `*`. Nested forms such as `***text***` do not nest cleanly (the outer `**` becomes `strong` and the leftover `*` remains as text). Build `InlineAnnotation`s by hand for compound styles.

### Filtering inline annotations from imported manuscripts

To keep only some annotation kinds, call `parseManuscript()` and narrow on `type`:

```ts
import { parseManuscript } from '@libraz/mejiro/epub';

const { text, inlineAnnotations } = parseManuscript(rawText, { dialect: 'narou' });
const rubyOnly = inlineAnnotations.filter((ann) => ann.type === 'ruby');
```

## Dependencies

The `@libraz/mejiro/epub` module depends on [JSZip](https://stuk.github.io/jszip/) for ZIP decompression and uses `DOMParser` for XML/XHTML parsing (available in all browsers and in server-side runtimes that provide a DOM implementation such as happy-dom or jsdom).

The globals used are `DOMParser`, `XMLSerializer`, and `Node`, none of which plain Node provides. When they are not registered, `parseEpub()`, `parseEditableEpub()` and `extractRubyContent()` throw `MejiroError` `dom-unavailable`, naming what is missing, instead of a bare `ReferenceError`. See [Advanced -- First paint under SSR](./09-advanced.md#722-first-paint-under-ssr) for a registration snippet.

---

## Related Documentation

- [Getting Started](./01-getting-started.md) -- Installation and basic usage
- [Core Concepts](./02-core-concepts.md) -- TypedArray-based API, codepoint processing
- [Line Breaking](./03-line-breaking.md) -- Kinsoku, hanging punctuation, ruby preprocessing
