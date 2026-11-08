# Advanced

This document covers advanced usage of mejiro, including custom kinsoku rules, morphological analysis integration, performance characteristics, server-side usage, and custom rendering.

---

## 1. Custom Kinsoku Rules

You can override the default line break prohibition rules by providing a `KinsokuRules` object to `computeBreaks()`.

### Extending the Defaults

Use `getDefaultKinsokuRules()` to get a copy of the built-in strict rules, then modify them:

<!-- doc-example: 09-kinsoku.ts#kinsoku -->
```ts
import {
  computeBreaks,
  extendKinsokuRules,
  getDefaultKinsokuRules,
  toCodepoints,
} from '@libraz/mejiro';

// The default rules, with ％ also kept off the start of a line
const rules = extendKinsokuRules(getDefaultKinsokuRules(), { lineStartProhibited: [0xff05] });

const result = computeBreaks({
  text: toCodepoints('ただいま５％引きです。'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  kinsoku: rules,
});
// result.breakPoints → [3, 8]: ５ moves down with ％ instead of leaving ％ at a line start
```

### Creating Rules from Scratch

To create rules that do not extend the defaults:

```ts
const rules = buildKinsokuRules({
  lineStartProhibited: [0x3001, 0x3002], // Only 、and 。
  lineEndProhibited: [0x300c],           // Only 「
});
```

Custom rules passed as `kinsoku` **replace** the built-in rules entirely; `kinsoku` takes either a mode (`'strict'` / `'loose'`) or rules, never both.

### KinsokuRules Structure

```ts
interface KinsokuRules {
  lineStartProhibited: number[];        // Codepoint arrays
  lineEndProhibited: number[];
  unbreakablePairs: Array<readonly [number, number]>; // Pairs never split across lines
  lineStartProhibitedSet: Set<number>;  // Pre-computed lookup sets
  lineEndProhibitedSet: Set<number>;
  unbreakablePairSet: Set<string>;
}
```

Always use `buildKinsokuRules()` to create rules -- it generates the lookup sets automatically from the codepoint arrays. Constructing a `KinsokuRules` object manually without the sets will result in incorrect behavior.

---

## 2. Token Boundaries (Morphological Analysis Integration)

The `tokenBoundaries` option lets you integrate a morphological analyzer or tokenizer, such as [`@libraz/suzume`](https://github.com/libraz/suzume), to prefer natural word boundaries for line breaks. For browser-only deployments, Suzume's WASM build is roughly 628 KB with its dictionaries embedded, about 260 KB gzipped; a server-side analyzer with a larger dictionary is the trade when dictionary accuracy matters more than footprint.

### Basic Usage

<!-- doc-example: 09-tokens.ts#tokens -->
```ts
import { computeBreaks, toCodepoints, tokenLengthsToBoundaries } from '@libraz/mejiro';

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

<!-- doc-example: 09-tokens.ts#token-array -->
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
- **Use `layoutParagraphs()`** when you need each paragraph's characters alongside its breaks. It lays the paragraphs out one at a time, as a `layout()` loop on the same instance would, and shares nothing beyond the instance's width cache; what it adds is `chars` in the NFC form the break points and annotations address, and per-paragraph font overrides.
- **Pre-measure fonts with `preloadFont()`** before the first layout to improve perceived performance:

<!-- doc-example: 09-preload.ts#preload -->
```ts
const mejiro = new MejiroBrowser({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
});

// Preload during app initialization
await mejiro.preloadFont();

// Subsequent layout calls skip the font loading step
const result = await mejiro.layout({ text, lineWidth: 400 });
```

---

## 4. Server-Side Usage

The core module (`@libraz/mejiro`) has zero DOM dependencies and works in any JavaScript runtime (Node.js, Deno, Bun, edge workers).

<!-- doc-example: 09-headless.ts#headless -->
```ts
import { computeBreaks, getLineRanges, paginate, toCodepoints } from '@libraz/mejiro';

// You must provide advance widths yourself (no Canvas available)
const text = toCodepoints('吾輩は猫である。名前はまだ無い。');
const advances = new Float32Array(text.length).fill(16); // Fixed-width assumption

const result = computeBreaks({ text, advances, lineWidth: 128 });
const lines = getLineRanges(result.breakPoints, text.length);
const pages = paginate(400, [{ lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 }]);
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
  readonly paragraphs: readonly RenderParagraph[];
}

interface RenderParagraph {
  readonly lines: readonly RenderLine[];
  readonly headingLevel?: HeadingLevel;
  readonly kind?: ParagraphKind;
  readonly scale?: number;
}

interface RenderLine {
  readonly segments: readonly RenderSegment[];
}

type RenderSegment =
  | { type: 'text'; text: string }
  | { type: 'ruby'; text: string; rubyText: string; children?: readonly RenderSegment[] }
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

Every variant carries the flattened text of its whole span under `text` (the base text, for `ruby`), and `children` covers the same range with the nested annotations. Draw one of the two, never both. A renderer that only draws characters reads `segment.text` and ignores `children`.

For DOM output, use `segmentToInlineNode()` instead — see
[Pagination & Rendering](07-pagination-and-rendering.md).

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
        for (const char of segment.text) {
          ctx.fillText(char, x, y + 16);
          y += 16;
        }
        // Ruby text, emphasis marks and tate-chu-yoko rotation omitted for brevity
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
            .map((s) => (s.type === 'ruby' ? `${s.text}(${s.rubyText})` : s.text))
            .join('')
        )
        .join('\n')
    )
    .join('\n\n');
}
```

---

## 6. Image Exclusion (Text Wrapping)

mejiro supports flowing text around arbitrary rectangular obstacles (images, figures, etc.) via the `ExclusionEngine` class.

### Basic Usage

<!-- doc-example: 09-exclusion.ts#exclusion -->
```ts
import { computeBreaks, ExclusionEngine, toCodepoints } from '@libraz/mejiro';

const engine = new ExclusionEngine({
  lineWidth: 600, // Column height (px)
  lineCount: 12, // Number of columns
  linePitch: 30.4, // fontSize × lineHeight
  contentWidth: 380, // Available width for columns (px)
});

// Add images (content-area coordinates)
engine.addImage({ x: 100, y: 50, width: 120, height: 160 });
engine.addImage({ x: 50, y: 300, width: 80, height: 100 });

// Compute column slots and line widths
const { slots, lineWidths } = engine.compute();

// Pass lineWidths to the layout engine
const text = toCodepoints('...');
const advances = new Float32Array(text.length).fill(16);
const result = computeBreaks({
  text,
  advances,
  lineWidth: 600,
  lineWidths, // Per-column widths from ExclusionEngine
});

// Render each column at slots[i].xPos, slots[i].yStart
// with height = slots[i].height
```

### How It Works

1. For each column, the engine collects all image regions that overlap it horizontally.
2. Overlapping regions are merged into non-overlapping intervals.
3. **Every** contiguous gap left between those intervals becomes a slot, as long as it is at least `minGapHeight` tall (defaults to `linePitch`). A column split by an image contributes one slot above it and one below it; a column an image covers entirely contributes none.
4. The gap's height becomes the effective `lineWidth` for that slot, and its vertical position (`yStart`) indicates where to render the text.
5. Slots are emitted in reading order: column by column from the right, and within a column from the gap above an image to the gap below it, so a line an image interrupts continues past it in the same column before the next column starts. The exception is an image that crosses the full page width: when every column with text has text both above and below a range the images block in every column, that range divides the page into tiers, and the upper tier is read across the whole page before the lower one. Within each tier the column-by-column order applies again.

Because a column may yield several slots or none, `slots.length` is unrelated to `lineCount` and `slots[columnIndex]` is not a valid lookup — a slot's index is a line index. Use `columnIndex` to recover the physical column, not `xPos`. The two-image example above produces 20 slots for 12 columns.

### Coordinate System (Vertical Writing)

In `writing-mode: vertical-rl`:
- **Block direction** = horizontal (columns flow right-to-left)
- **Inline direction** = vertical (text flows top-to-bottom)
- `ImageRect.x` / `.width` correspond to the block axis
- `ImageRect.y` / `.height` correspond to the inline axis
- Coordinates are relative to the **content area** origin (after padding)

### Dynamic Updates

`ExclusionEngine` is designed for interactive use (e.g., drag-and-drop image placement):

```ts
const engine = new ExclusionEngine(geometry);
const img = { x: 100, y: 50, width: 120, height: 160 };
engine.addImage(img);

// On drag: update coordinates and recompute
img.x = 150;
img.y = 80;
const { slots, lineWidths } = engine.compute(); // Sub-millisecond

// On resize
engine.setGeometry({ ...geometry, lineWidth: 500 });
engine.compute();

// Remove an image
engine.removeImage(img);
```

### Spread Layout (Two-Page Flow)

For book-style layouts where text flows across a two-page spread, use `SpreadExclusionEngine`. It handles gutter (spine padding) coordinate conversion automatically:

<!-- doc-example: 09-spread-exclusion.ts#spread -->
```ts
import { computeBreaks, SpreadExclusionEngine } from '@libraz/mejiro';

const spread = new SpreadExclusionEngine({
  pageWidth: 537,
  paddingX: 52, // Inner + outer padding
  paddingY: 56,
  lineWidth: 676,
  linePitch: 30.4,
});

// Images are positioned relative to the right page's top-left corner.
// Negative x values automatically map to the left page with gutter offset.
spread.addImage({ x: 200, y: 100, width: 120, height: 160, inlineMargin: 16 });
spread.addImage({ x: -100, y: 300, width: 80, height: 100 }); // left page

const { rightSlots, leftSlots, lineWidths } = spread.compute();

// One computeBreaks call for the entire spread
const result = computeBreaks({ text, advances, lineWidth: 676, lineWidths });

// Split lines for rendering:
// Lines 0..rightSlots.length-1 → render on right page using rightSlots
// Lines rightSlots.length..     → render on left page using leftSlots
```

Key differences from `ExclusionEngine`:
- **Automatic gutter handling** — No manual coordinate conversion needed
- **Continuous text flow** — Single `lineWidths` array spans both pages
- **Split rendering** — the first `rightSlots.length` lines go on the right page, the rest on the left

### One-Shot Convenience Function

For static layouts where images don't change, use `computeExclusionSlots()`:

```ts
import { computeExclusionSlots, computeBreaks } from '@libraz/mejiro';

const { slots, lineWidths } = computeExclusionSlots({
  lineWidth: 600,
  lineCount: 12,
  linePitch: 30.4,
  contentWidth: 380,
  images: [
    { x: 100, y: 50, width: 120, height: 160 },
  ],
});
```

---

## 7. Integration guide for novel-posting sites

mejiro covers the "read / write / take away as EPUB" portion of a Japanese novel-posting platform. The table below shows where mejiro's responsibility ends and the host application's begins.

| Site capability | What mejiro provides | What the application owns |
|-----------------|----------------------|---------------------------|
| Manuscript submission form | `<MejiroManuscriptEditor>` / `useManuscriptDraft` / `parseManuscript()` | Auth, server transport, draft sharing |
| Vertical reading view | `<MejiroReader>` / `useReadingPosition` | Comments, ratings, share UI |
| EPUB authoring per chapter / per work | `EpubProject.fromManuscript()` / `EditableEpub` | When to build, how to deliver, signed URLs |
| Editing existing EPUBs | `<MejiroEditor>` / `useEditableEpub` | File ACLs, revision management |
| In-chapter search | `ChapterLayout.findText()` | Cross-work search (see below) |
| Reading-position persistence | `ReadingAnchor` / `useReadingPosition` | Server DB, device sync |
| Work metadata schema | `EpubProjectMetadata` type | DB columns, edit UI |

A typical wiring looks like:

```
[Author] ──→ MejiroManuscriptEditor ──→ EpubProject ──→ server save
                                                 └→ EPUB export (optional)

[Reader] ──→ MejiroReader  ←──── server API (metadata + chapters or EPUB URL)
                ↑               ↓
        useReadingPosition ←→ server DB (ReadingAnchor JSON)
```

### 7.1 Wiring up the submission flow

Use `useManuscriptDraft` for local draft state and `useEpubProject` for "chapter drafts → EPUB". The shortest path to server persistence is to POST the draft chapters and the project metadata that `buildProject()` returns. `useEpubProject` reads its `metadata` and `chapters` options only at mount, so later draft edits reach the project through `setChapters`, and `save()` sends `draft.chapters`, which always holds the chapters as currently edited.

```tsx
import { useEffect } from 'react';
import { useEpubProject, useManuscriptDraft } from '@libraz/mejiro-react';

const draft = useManuscriptDraft({ initialChapters: saved.chapters });
const project = useEpubProject({
  metadata: { title: saved.title, language: 'ja' },
  chapters: draft.chapters, // [{ id, title, body }]
  debounceMs: 400,
  onPreview(book) {
    // Receives an EpubBook one level up from the manuscript text.
  },
});

// Options are read once; forward every later draft edit to the project.
const { setChapters } = project;
useEffect(() => setChapters(draft.chapters), [draft.chapters, setChapters]);

async function save() {
  const built = project.buildProject();
  await fetch(`/api/works/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      metadata: built.metadata,
      chapters: draft.chapters, // The drafts as currently edited
    }),
  });
}
```

The least surprising DB schema is to dump `EpubProjectMetadata` (`title`, `creators`, `subjects`, `language`, `description`, ...) and `chapters: { id, title, body }[]` straight into JSON columns. Inline notation — ruby, emphasis dots, tate-chu-yoko — survives inside `body` as `parseManuscript` markers (`｜漢字《かんじ》`, `《《重要》》`, `〔20〕`, ...).

### 7.2 Reading flow (public page)

"Pass the URL" is the shortest path. When the server stores EPUBs as files, hand the URL via `epubUrl`. When metadata comes from a separate API and the EPUB is streamed, parse it first and pass the resulting `EpubBook` via `epub`.

```tsx
<MejiroReader epubUrl={`/api/works/${slug}/epub`} title={work.title} />
```

#### 7.2.1 Authenticated EPUB delivery

For works that require login, attach cookies or a bearer token through `fetchOptions`, or replace the loader entirely with `fetchEpub`:

```tsx
<MejiroReader
  epubUrl={url}
  fetchOptions={{ credentials: 'include' }}
  // or
  fetchEpub={async (u) => {
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await res.text());
    return res.arrayBuffer();
  }}
/>
```

#### 7.2.2 First paint under SSR

Paginated layout depends on Canvas/FontFace and therefore runs on the client. `renderEpubStatic(chapter)` returns a plain `writing-mode: vertical-rl` HTML string with no measurement; piping that into the `fallback` prop keeps real text on screen until the client reader hydrates.

`parseEpub()` reads XHTML through the host DOM globals `DOMParser`, `XMLSerializer`, and `Node`, none of which plain Node provides. Register a DOM implementation once before the server component runs, or the call fails with an error naming what is missing.

```ts
// instrumentation.ts (or any module imported before the first parseEpub call)
import { Window } from 'happy-dom';

const window = new Window() as unknown as typeof globalThis;
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;
globalThis.Node = window.Node;
```

<!-- doc-example: 09-ssr/page.tsx#server -->
```tsx
// app/works/[slug]/page.tsx — server component
import { parseEpub } from '@libraz/mejiro/epub';
import { renderEpubStatic } from '@libraz/mejiro/render';
import { ReaderClient } from './ReaderClient';

export default async function ReaderPage({ params }: { params: { slug: string } }) {
  // fetchEpubBuffer() stands for however your server loads the EPUB bytes.
  const buf = await fetchEpubBuffer(params.slug);
  const epub = await parseEpub(buf);
  // renderEpubStatic() output is built from parseEpub() results with text and
  // attributes escaped, and link hrefs restricted to safe URL schemes.
  const initialHtml = renderEpubStatic(epub.chapters[0], { ariaLabel: epub.title });
  return <ReaderClient slug={params.slug} initialHtml={initialHtml} />;
}
```

<!-- doc-example: 09-ssr/ReaderClient.tsx#client -->
```tsx
// app/works/[slug]/ReaderClient.tsx — client component
'use client';

import { MejiroReader } from '@libraz/mejiro-react';

// `initialHtml` must come from a trusted source (your own server, via
// renderEpubStatic). For user-supplied HTML, sanitize with DOMPurify
// before passing it into the fallback wrapper below.
function StaticFallback({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

interface Props {
  slug: string;
  initialHtml: string;
}

export function ReaderClient({ slug, initialHtml }: Props) {
  return (
    <MejiroReader
      epubUrl={`/api/works/${slug}/epub`}
      fallback={<StaticFallback html={initialHtml} />}
    />
  );
}
```

`renderEpubStatic()` skips measurement and pagination and lets the browser's native vertical-rl flow do the layout. It escapes content internally and drops executable link schemes such as `javascript:` from EPUBs round-tripped through `parseEpub()`. Its wrapper is runtime-restricted to `div`, `article`, or `section`; an invalid value falls back to `div`. The output is also crawlable, so it doubles as a search-engine target and a slow-network placeholder.

### 7.3 Persisting the reading position to a server

`useReadingPosition` only needs a `localStorage`-shaped backend (`getItem` / `setItem` / `removeItem`), so wrapping a server endpoint is straightforward. The value stored is a `ReadingAnchor` (`{ chapterIndex, paragraphIndex, charIndex }`) as versioned JSON, which survives font-size and viewport changes that would otherwise invalidate spread indices.

```ts
const remoteStorage: MejiroStorage = {
  getItem(k) {
    return cachedSnapshot[k] ?? null; // Prefetched at startup
  },
  setItem(k, v) {
    cachedSnapshot[k] = v;
    void fetch(`/api/reading-position/${encodeURIComponent(k)}`, {
      method: 'PUT',
      body: v,
      keepalive: true,
    });
  },
  removeItem(k) {
    delete cachedSnapshot[k];
    void fetch(`/api/reading-position/${encodeURIComponent(k)}`, { method: 'DELETE' });
  },
};

const { position, save } = useReadingPosition({
  key: `mejiro:position:${userId}:${bookId}`,
  storage: remoteStorage,
  debounceMs: 1000,
  onError: (error) => reportToMonitoring(error),
});
```

`debounceMs` is a debounce delay: `storage.setItem` receives the latest value this long after the last `save()`, and a pending write is flushed on page hide, `key` change and unmount. A storage that throws is reported to `onError` as `storage-read-failed` / `storage-write-failed`; without `onError` the hook writes it to `console.warn`.

For multi-device sync, prefer to compare against the server's latest `updatedAt` inside `storage.setItem` so the conflict logic stays self-contained.

### 7.4 Delivering image assets (assetResolver)

When you want image bytes to live in external object storage (S3 / CloudFront / R2) rather than in the editor session, register an asset by `url` instead of `data` and resolve the bytes lazily at export time.

```ts
editor.addImage(0, {
  filename: 'figure-01.png',
  url: 'https://cdn.example.com/works/1/figure-01.png',
  alt: 'figure',
});

// Bytes are fetched only when the EPUB is being assembled.
const bytes = await editor.export({
  assetResolver: async ({ href, url, signal }) => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!res.ok) throw new Error(`asset fetch failed: ${href} (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  },
});
```

Omit `assetResolver` and mejiro falls back to the runtime `fetch(url, { signal })`. Write an explicit wrapper when you need to mint S3 signed URLs per request, hit an IndexedDB cache offline, or attach custom headers.

The same wiring exists on the manuscript-to-EPUB path: `EpubProject` accepts a `url` in place of `data` in `addAsset`, `addImage` and `setCover`. `<MejiroEditor>` and `useEditableEpub` register URL-only images through `editor.addImage({ filename, url })`; `useEpubProject` registers them through its own `setCover` / `setAssets`. All three surface `assetResolver` as a prop / option and forward it to the internal `editor.export()` / `project.export()` call, so the URLs are resolved only while the EPUB is assembled.

```ts
const project = useEpubProject({
  assetResolver: async ({ url, signal }) => (await fetch(url, { signal })).arrayBuffer(),
});

project.setCover({ url: 'https://cdn.example.com/works/1/cover.jpg', mediaType: 'image/jpeg' });
const bytes = await project.exportEpub(); // cover bytes fetched here
```

One resolver serves both paths. Its `AssetResolverRequest` carries `url`, `href` — the ZIP path the bytes are written to in the exported EPUB, the same on both paths — `mediaType` when the asset declares one, and the export's `signal`:

```ts
const resolver: AssetResolver = async ({ href, url, mediaType, signal }) => {
  const res = await fetch(url, { signal, headers: mediaType ? { Accept: mediaType } : {} });
  if (!res.ok) throw new Error(`asset fetch failed: ${href} ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};
```

Notes:

- An asset carries `data` or `url`, never both; the input types are unions that reject the pair. Adding an image, cover or asset with neither throws `TypeError`.
- The default `fetch` reports a failure status as `MejiroError` `asset-fetch-failed`; whatever a custom resolver throws rejects the export as it is.
- The same export-level `AbortSignal` is forwarded to the resolver, so long-running fetches can be interrupted.

### 7.5 Cross-work search

`ChapterLayout.findText()` only searches **the current chapter**. To implement work-wide, author-wide, or site-wide full-text search, maintain a separate index on the server (Meilisearch / Elasticsearch / PostgreSQL `pg_trgm` / SQLite FTS5) and convert hits into `ReadingAnchor` form (`{ chapterIndex, paragraphIndex, charIndex }`) before handing them to the reader. If your primary store is MySQL, [MygramDB](https://github.com/libraz/mygram-db) — an in-memory n-gram index that syncs via MySQL binlog replication — keeps MySQL as the source of truth while delivering sub-millisecond CJK full-text search.

```ts
// Search API returns ReadingAnchor hits
const hits = await searchApi(query); // [{ workId, anchor: ReadingAnchor, snippet }]

// Jump to a hit
const reader = useRef<MejiroReaderHandle>(null);
reader.current?.goToAnchor(hits[0].anchor);
```

Indexing the same source the reader sees keeps `charIndex` consistent — pick either `ManuscriptChapter.body` (raw manuscript notation) or the paragraph text extracted by `parseEpub()`.

### 7.6 Out of scope

| Concern | Recommended approach |
|---------|---------------------|
| Real-time collaboration / conflict resolution (CRDT/OT) | `EditableEpub` assumes a single editor. Drive multi-author flows on the plain-text `body` layer via Yjs / Automerge, then feed the result into `EpubProject` on save. |
| Version history / diffs | Paragraph IDs (`EditableParagraphBlock.id`) are stable across edits — diff against them in your own version store. |
| Comments / ratings / reports | Not included in `<MejiroReader>`. `ReadingAnchor` ranges work well as primary keys for "comments anchored to a position in the text". |
| Auth / billing / notifications | Entirely the host's responsibility. |
| Image upload / preview | `prepareImage()` (`@libraz/mejiro/image`) handles client-side decoding and downscaling; the upload itself is up to the host. |

---

## Related Documentation

- [03-line-breaking.md](./03-line-breaking.md) -- Line breaking algorithm, kinsoku modes, hanging punctuation
- [05-browser-integration.md](./05-browser-integration.md) -- MejiroBrowser, font measurement, width caching
- [08-react-and-vue.md](./08-react-and-vue.md) -- Pre-built React and Vue components for RenderPage
- [02-core-concepts.md](./02-core-concepts.md) -- Architecture, data flow, TypedArray conventions
