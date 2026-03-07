# mejiro Documentation

Japanese vertical text layout engine for the web — line breaking, kinsoku shori (禁則処理), hanging punctuation, ruby (furigana), and pagination.

## Documentation

| # | Title | Description |
|---|---|---|
| 01 | [Getting Started](01-getting-started.md) | Installation and first layout |
| 02 | [Core Concepts](02-core-concepts.md) | Architecture, data flow, TypedArrays |
| 03 | [Line Breaking](03-line-breaking.md) | computeBreaks, kinsoku, hanging punctuation |
| 04 | [Ruby](04-ruby.md) | Ruby (furigana) annotations |
| 05 | [Browser Integration](05-browser-integration.md) | MejiroBrowser, font measurement |
| 06 | [EPUB](06-epub.md) | EPUB parsing and ruby extraction |
| 07 | [Pagination & Rendering](07-pagination-and-rendering.md) | paginate, buildRenderPage, CSS |
| 08 | [React & Vue](08-react-and-vue.md) | Framework components |
| 09 | [Advanced](09-advanced.md) | Custom kinsoku, token boundaries, performance |
| 10 | [API Reference](10-api-reference.md) | Complete API reference |

## What Should I Read?

**I want to render vertical text in React or Vue**
→ [Getting Started](01-getting-started.md) → [React & Vue](08-react-and-vue.md)

**I want to understand the line breaking algorithm**
→ [Core Concepts](02-core-concepts.md) → [Line Breaking](03-line-breaking.md)

**I want to display an EPUB in vertical text**
→ [Getting Started](01-getting-started.md) → [EPUB](06-epub.md) → [Pagination & Rendering](07-pagination-and-rendering.md)

**I want to use the core engine without a browser**
→ [Core Concepts](02-core-concepts.md) → [Advanced](09-advanced.md)

---

[← Back to README](../../README.md)
