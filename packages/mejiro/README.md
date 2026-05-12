# @libraz/mejiro

[![npm version](https://img.shields.io/npm/v/@libraz/mejiro.svg)](https://www.npmjs.com/package/@libraz/mejiro)
[![license](https://img.shields.io/npm/l/@libraz/mejiro.svg)](https://github.com/libraz/mejiro/blob/main/LICENSE)

Japanese vertical text layout engine for the web — line breaking, kinsoku shori, hanging punctuation, ruby, image exclusion, and EPUB parsing/authoring. The core has zero DOM dependencies. Pairs with [`@libraz/mejiro-react`](https://www.npmjs.com/package/@libraz/mejiro-react) / [`@libraz/mejiro-vue`](https://www.npmjs.com/package/@libraz/mejiro-vue) for ready-to-use reader/editor components.

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
| `@libraz/mejiro` | Core: line breaking, kinsoku, hanging, ruby, image exclusion |
| `@libraz/mejiro/browser` | Font measurement + browser integration |
| `@libraz/mejiro/epub` | EPUB parsing, `EditableEpub`, `EpubProject` |
| `@libraz/mejiro/render` | Layout → render data + CSS |
| `@libraz/mejiro/book` | High-level `MejiroBook` / `ChapterLayout` API |
| `@libraz/mejiro/image` | Browser-side image decode / downscale helpers |

## Documentation

- [Project README](https://github.com/libraz/mejiro)
- [Getting started](https://github.com/libraz/mejiro/tree/main/docs/en/01-getting-started.md)
- [API reference](https://github.com/libraz/mejiro/tree/main/docs/en/10-api-reference.md)
- 日本語ドキュメント: [docs/ja](https://github.com/libraz/mejiro/tree/main/docs/ja)

## License

[Apache License 2.0](https://github.com/libraz/mejiro/blob/main/LICENSE)
