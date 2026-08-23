# @libraz/mejiro

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/mejiro/ci.yml?branch=main&label=CI)](https://github.com/libraz/mejiro/actions)
[![npm](https://img.shields.io/npm/v/@libraz/mejiro)](https://www.npmjs.com/package/@libraz/mejiro)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/mejiro/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)

**Japanese vertical text layout engine for the web.** It handles line breaking, kinsoku shori, hanging punctuation, ruby, tate-chu-yoko, pagination, image exclusion, and EPUB parsing and authoring. The core has zero DOM dependencies. Pairs with [`@libraz/mejiro-react`](https://www.npmjs.com/package/@libraz/mejiro-react) / [`@libraz/mejiro-vue`](https://www.npmjs.com/package/@libraz/mejiro-vue) for ready-to-use reader/editor components.

## Install

```bash
npm install @libraz/mejiro
```

## Quick start

```ts
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});
book.computePageSize(document.querySelector('.reader')!);

const epub = await parseEpub(epubBuffer);
const layout = await book.layoutChapter(epub.chapters[0]);
const spread = layout.getSpread(0);
```

## Subpath exports

| Import path | Description |
|---|---|
| `@libraz/mejiro` | Core: line breaking, kinsoku, hanging, ruby (`preprocessRuby`), tate-chu-yoko (`preprocessTcy` / `buildTcyAnnotations`), NFC normalization (`normalizeText`), pagination (`paginate` / `getLineRanges`), image exclusion, annotation / reading-position persistence, i18n message catalogs |
| `@libraz/mejiro/browser` | Font measurement (`MejiroBrowser`, `CharMeasurer`), ruby font derivation, image drag and resize sessions (`createOverlayDragSession`) |
| `@libraz/mejiro/epub` | EPUB parsing (`parseEpub`) with untrusted-archive resource limits, `EditableEpub` write-back, `cloneEditableEpubBook` / `clampEditableEpubSelection`, manuscript parsing (`parseManuscript`), `EpubProject` authoring |
| `@libraz/mejiro/render` | Layout → `RenderPage` data, `paragraphClassName`, static HTML (`renderEpubStatic`), stylesheets |
| `@libraz/mejiro/book` | High-level `MejiroBook` / `ChapterLayout`: pagination, full-text search (`findText`), reading anchors, layout snapshots, `estimateReadingTime` |
| `@libraz/mejiro/image` | Browser-side image decode / downscale helpers (`prepareImage`) |

## Stylesheets

Five stylesheets ship as separate subpaths, so a host app imports only what it renders:

| Import path | Purpose |
|---|---|
| `@libraz/mejiro/render/mejiro.css` | Base vertical text layout — required whenever `RenderPage` data is rendered |
| `@libraz/mejiro/render/mejiro-reader.css` | Reader chrome: header, spread frame, page navigation |
| `@libraz/mejiro/render/mejiro-editor.css` | Editor chrome: toolbars, inline editing, image overlays |
| `@libraz/mejiro/render/mejiro-fonts.css` | Optional Japanese webfont declarations |
| `@libraz/mejiro/render/mejiro-print.css` | Print / PDF output |

## Untrusted EPUB archives

`parseEpub()` and `parseEditableEpub()` enforce resource limits by default, so a hostile
or malformed archive cannot exhaust memory: caps on compressed input size, entry count,
per-entry and total expanded size, and per-entry compression ratio. Limits are checked
against the bytes the decompressor really produces, not the sizes the archive declares
for itself, and reading stops as soon as a cap would be passed.

The defaults are exported as `DEFAULT_EPUB_PARSE_LIMITS`. In a trusted environment —
a build step over your own files, say — raise individual caps through
`EpubParseOptions.limits`:

```ts
import { parseEpub } from '@libraz/mejiro/epub';

const book = await parseEpub(buffer, { limits: { maxTotalBytes: 1024 * 1024 * 1024 } });
```

## Documentation

- [Project README](https://github.com/libraz/mejiro)
- [Getting started](https://github.com/libraz/mejiro/tree/main/docs/en/01-getting-started.md)
- [API reference](https://github.com/libraz/mejiro/tree/main/docs/en/10-api-reference.md)
- 日本語ドキュメント: [docs/ja](https://github.com/libraz/mejiro/tree/main/docs/ja)

## License

[Apache License 2.0](https://github.com/libraz/mejiro/blob/main/LICENSE)
