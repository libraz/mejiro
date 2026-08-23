# React example — headless (hooks only)

Build a custom reader UI from the hooks directly, without going through
`MejiroReader`. Useful when you want full control over the header, chrome,
transitions, or anything else.

## What you compose

| Hook | Used for |
|------|----------|
| `useMejiroBook(options)` | One `MejiroBook` instance |
| `useEpub({ defaultUrl })` | Parse + load state |
| `useChapterLayout(book, epub, chapter, surfaceRef)` | Layout the active chapter, react to resize |
| `useSpread(layout, { enableKeyboard })` | Track current spread, prev/next, keyboard nav |
| `MejiroSpread` (component) | Renders the two-page spread |

The example draws a 40px top bar with the book title + `n / total`, then
the spread fills the rest. Add anything else (TOC drawer, settings overlay,
custom transitions) by extending the JSX.

## Run it

```bash
yarn install
yarn workspace @mejiro/example-react-headless dev
```

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/react-headless my-reader
cd my-reader
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.8.0\"'));"
npm install
npm run dev
```

## Reading further

- [`examples/react`](../react) — the high-level `MejiroReader` variant.
- [`@libraz/mejiro-react` README](../../packages/mejiro-react#hooks-headless-no-ui) — hook reference.
