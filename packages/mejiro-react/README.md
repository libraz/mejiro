# @libraz/mejiro-react

React components for [mejiro](https://github.com/libraz/mejiro) vertical text rendering.

## Install

```bash
npm install @libraz/mejiro @libraz/mejiro-react
```

Peer dependency: `react >= 18`

## Components

### `MejiroPageView` (Recommended)

Renders a `PageResult` from `ChapterLayout`. Automatically selects the rendering strategy based on whether images are present.

```tsx
import { MejiroBook } from '@libraz/mejiro/book';
import { verticalLineWidth } from '@libraz/mejiro/browser';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro.css';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
});
book.setPageSize({ pageWidth: 400, lineWidth: verticalLineWidth(600, 16) });

const epub = await parseEpub(buffer);
const layout = await book.layoutChapter(epub.chapters[0]);
const spread = layout.getSpread(0);

function App() {
  return (
    <div style={{ display: 'flex' }}>
      <MejiroPageView result={spread.right} fontFamily='"Noto Serif JP"' lineSpacing={1.8} />
      <MejiroPageView result={spread.left} fontFamily='"Noto Serif JP"' lineSpacing={1.8} />
    </div>
  );
}
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `result` | `PageResult` | Required. Page result from `ChapterLayout`. |
| `fontFamily` | `string` | CSS font family (used in slot-based rendering mode). |
| `lineSpacing` | `number` | Line spacing multiplier (used in slot-based rendering mode). |
| `className` | `string` | Additional CSS class name. |
| `style` | `CSSProperties` | Additional inline styles. |

### `MejiroPage` (Low-Level)

Renders a `RenderPage` data structure using CSS `writing-mode: vertical-rl`. Use this when you are working with the lower-level `buildRenderPage()` API directly.

```tsx
import { buildRenderPage } from '@libraz/mejiro/render';
import { MejiroPage } from '@libraz/mejiro-react';
import '@libraz/mejiro/render/mejiro.css';

const renderPage = buildRenderPage(pageSlices, entries);

function App() {
  return <MejiroPage page={renderPage} />;
}
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `page` | `RenderPage` | Required. Render page data from `buildRenderPage()`. |
| `className` | `string` | Additional CSS class name. |
| `style` | `CSSProperties` | Additional inline styles. |

## CSS

Import the base stylesheet for vertical text layout:

```ts
import '@libraz/mejiro/render/mejiro.css';
```

## License

[Apache License 2.0](../../LICENSE)
