# React example — embedded reader

`MejiroReader` rendered inside a fixed-size card on a normal article page,
not full-screen. Useful for blog posts, product landings, or any context
where the reader is one widget among others.

## Highlights

- Reader fills its container — give the wrapper a `height` (and width) and
  the layout adapts.
- `enableDropZone`, `enableStats`, `enableSettings` are switched off so the
  embed shows just the spread chrome.
- Same `MejiroReader` API; no special "embed" mode needed.

## Run it

```bash
yarn install
yarn workspace @mejiro/example-react-embed dev
```

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/react-embed my-page
cd my-page
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.8.0\"'));"
npm install
npm run dev
```

## Reading further

- [`examples/react`](../react) — the minimal full-screen variant.
- [`@libraz/mejiro-react` README](../../packages/mejiro-react) — full API reference.
