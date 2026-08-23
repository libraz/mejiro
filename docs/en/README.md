# mejiro Documentation

Japanese vertical text layout engine for the web — line breaking, kinsoku shori (禁則処理), hanging punctuation, ruby (furigana), tate-chu-yoko (縦中横), pagination, EPUB parsing/authoring, static rendering, and reader/editor components for React and Vue.

## Documentation

| # | Title | Description |
|---|---|---|
| 01 | [Getting Started](01-getting-started.md) | Installation and first layout |
| 02 | [Core Concepts](02-core-concepts.md) | Architecture, data flow, TypedArrays |
| 03 | [Line Breaking](03-line-breaking.md) | computeBreaks, kinsoku, hanging punctuation |
| 04 | [Ruby](04-ruby.md) | Ruby (furigana) annotations |
| 05 | [Browser Integration](05-browser-integration.md) | MejiroBrowser, font measurement |
| 06 | [EPUB](06-epub.md) | EPUB parsing, editing, authoring, ruby extraction |
| 07 | [Pagination & Rendering](07-pagination-and-rendering.md) | paginate, buildRenderPage, CSS |
| 08 | [React & Vue](08-react-and-vue.md) | Framework components |
| 09 | [Advanced](09-advanced.md) | Custom kinsoku, token boundaries, performance, server-side usage, custom rendering, image exclusion, novel-posting site integration |
| 10 | [API Reference](10-api-reference.md) | Complete API reference |

## What Should I Read?

**I want to lay out an EPUB quickly (recommended)**
→ [Getting Started](01-getting-started.md) → `MejiroBook` in [API Reference](10-api-reference.md)

**I want to render vertical text in React or Vue**
→ [Getting Started](01-getting-started.md) → [React & Vue](08-react-and-vue.md)

**I want to understand the line breaking algorithm**
→ [Core Concepts](02-core-concepts.md) → [Line Breaking](03-line-breaking.md)

**I want to understand what is inside an EPUB and how it is converted**
→ [EPUB](06-epub.md) → [Pagination & Rendering](07-pagination-and-rendering.md)

**I want to use the core engine without a browser**
→ [Core Concepts](02-core-concepts.md) → [Advanced](09-advanced.md)

**I want to flow text around images**
→ `MejiroBook` + `layout.setImages()` in [API Reference](10-api-reference.md), or [Advanced](09-advanced.md) for low-level control

**I want the reader/editor surface**
→ [React & Vue](08-react-and-vue.md) → [API Reference](10-api-reference.md)

---

[← Back to README](../../README.md)
