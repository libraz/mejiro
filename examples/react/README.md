# React example — `@libraz/mejiro-react`

A minimal Vite + React 19 setup that reproduces the demo look with
**two imports and one component**.

```tsx
import '@libraz/mejiro/render/mejiro-fonts.css';  // optional webfonts
import { MejiroReader } from '@libraz/mejiro-react';

export default function App() {
  return <MejiroReader epubUrl="/book.epub" />;
}
```

CSS is auto-loaded by the package — no extra `mejiro.css` import.

## Run it

```bash
yarn install
yarn workspace @mejiro/example-react dev
# or from this folder:
yarn dev
```

The example loads `/neko.epub` on mount. ArrowLeft / ArrowRight to navigate,
and click **Settings** for font / size / kinsoku. Set `enableDropZone` or
`enableImageOverlay` when you want users to drop their own EPUB or place
draggable image placeholders.

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/react my-reader
cd my-reader
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.9.0\"'));"
npm install
npm run dev
```

## What each file does

| File | Why it matters |
|------|----------------|
| `index.html` | `html, body, #root { height: 100% }` reset only. No CSS or font links. |
| `src/main.tsx` | Mounts the React app. |
| `src/App.tsx` | One `<MejiroReader epubUrl>` and an optional `mejiro-fonts.css` import. |

## Common patterns

```tsx
{/* Open a URL on mount */}
<MejiroReader epubUrl="/book.epub" />

{/* Pre-parsed EpubBook */}
<MejiroReader epub={myParsedBook} />

{/* Bare spread (no header, no settings, no overlay) */}
<MejiroReader epubUrl="/book.epub" bare />

{/* Custom logo */}
<MejiroReader logo={<img src="/logo.svg" alt="My Library" height={24} />} />
```

## Theme

Override CSS variables on `.mejiro-reader`:

```css
.mejiro-reader {
  --mejiro-bg-deep: #0c0c0c;
  --mejiro-bg-paper: #fafafa;
  --mejiro-accent: #2266aa;
  --mejiro-font-body: 'Noto Serif JP', serif;
}
```

## Self-host webfonts instead of Google Fonts

Drop the `mejiro-fonts.css` import and override the font variables to point
at your own `@font-face` rules.

## Reading further

- [`@libraz/mejiro-react` README](https://github.com/libraz/mejiro/tree/main/packages/mejiro-react) — full prop / hook reference.
- [Headless hooks](https://github.com/libraz/mejiro/tree/main/packages/mejiro-react#hooks-headless-no-ui) — bypass `MejiroReader` and consume the hooks directly.
