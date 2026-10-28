# Vue 3 example — headless (composables only)

Build a custom reader UI from the composables directly, without going
through `MejiroReader`. Useful when you want full control over the header,
chrome, transitions, or anything else.

## What you compose

| Composable | Used for |
|------------|----------|
| `useMejiroBook(options)` | One `MejiroBook` instance |
| `useEpub({ defaultUrl })` | Parse + load state |
| `useChapterLayout(book, epub, chapter, surface)` | Layout the active chapter, react to resize |
| `useSpread(layout, { enableKeyboard })` | Track current spread, prev/next, keyboard nav |
| `MejiroSpread` (component) | Renders the two-page spread |

The example draws a 40px top bar with the book title + `n / total`, then
the spread fills the rest. Add anything else (TOC drawer, settings overlay,
custom transitions) by extending the template.

## Run it

```bash
yarn install
yarn workspace @mejiro/example-vue-headless dev
```

## Sample EPUB

The example loads `/neko.epub`, which is generated rather than checked in. In the monorepo, run `yarn fetch-demo-epub` once from the repo root (it downloads the text from Aozora Bunko). A degit copy has no such file: put your own EPUB at `public/neko.epub`, or point the example at another URL.

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/vue-headless my-reader
cd my-reader
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.9.2\"'));"
npm install
npm run dev
```

## Reading further

- [`examples/vue`](../vue) — the high-level `MejiroReader` variant.
- [Composable reference](https://github.com/libraz/mejiro/tree/main/docs/en/10-api-reference.md#composables) — every composable and its options.
