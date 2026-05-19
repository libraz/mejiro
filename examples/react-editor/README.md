# React editor example — `@libraz/mejiro-react`

A minimal Vite + React setup that opens an EPUB into `MejiroEditor` so an
author can proofread paragraphs, add ruby annotations, insert images, and
export the result.

```tsx
import '@libraz/mejiro/render/mejiro-fonts.css';  // optional webfonts
import { MejiroEditor } from '@libraz/mejiro-react';

export default function App() {
  return <MejiroEditor epubUrl="/book.epub" />;
}
```

The drop zone is built in: when no URL is provided (or when the user wants
to load a different book), they can drop an EPUB onto the preview area.

## Run it

```bash
yarn install
yarn workspace @mejiro/example-react-editor dev
# or from this folder:
yarn dev
```

The bundled demo EPUB (`/neko.epub`) loads on mount. Select a paragraph in
the right-hand panel, edit the text or ruby, then click **Export EPUB**.

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/react-editor my-editor
cd my-editor
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.5.0\"'));"
npm install
npm run dev
```

## Editor vs ManuscriptEditor

| Component | When to use |
|-----------|-------------|
| `MejiroEditor` | You already have an EPUB and want to make targeted edits (proofreading, ruby, image insertion). |
| `MejiroManuscriptEditor` | You're authoring a brand-new book — chapters, metadata, optional cover. See `react-manuscript`. |

## Callbacks

| Prop | Payload | When |
|------|---------|------|
| `onLoad` | `EditableEpub` | After an EPUB is loaded into the editor. |
| `onExport` | `ArrayBuffer` | After the user exports — useful for uploading to a backend. |
| `onError` | `Error` | Load failure (the editor also shows an inline message). |

## Reading further

- [`@libraz/mejiro-react` README](https://github.com/libraz/mejiro/tree/main/packages/mejiro-react) — full prop / hook reference.
- [`useEditableEpub`](https://github.com/libraz/mejiro/tree/main/packages/mejiro-react) — the headless hook behind `MejiroEditor` if you want a custom UI.
