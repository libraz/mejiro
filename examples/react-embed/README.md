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

## Sample EPUB

The example loads `/neko.epub`, which is generated rather than checked in. In the monorepo, run `yarn fetch-demo-epub` once from the repo root (it downloads the text from Aozora Bunko). A degit copy has no such file: put your own EPUB at `public/neko.epub`, or point the example at another URL.

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/react-embed my-page
cd my-page
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.9.2\"'));"
npm install
npm run dev
```

## Reading further

- [`examples/react`](../react) — the minimal full-screen variant.
- [`@libraz/mejiro-react` API reference](https://github.com/libraz/mejiro/tree/main/docs/en/10-api-reference.md#librazmejiro-react--react-component) — full prop / hook reference.
