# Iframe embed example

Show how to drop the mejiro reader into a page that **isn't** a Vue / React
app at all. The host page is plain HTML; the reader lives inside an
`<iframe>` that points at a separately built reader entry.

```
┌── index.html ──────────────────┐
│  Plain HTML article            │
│  ┌── iframe (reader.html) ──┐  │
│  │  MejiroReader            │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

## File layout

| File | Purpose |
|------|---------|
| `index.html` | Host page. Pure HTML — no script tag for itself. |
| `reader.html` | Iframe target — boots the reader entry. |
| `src/reader.ts` | Mounts the reader app. |
| `src/Reader.vue` | One `<MejiroReader>`, reads `?epub=` from the URL. |
| `vite.config.ts` | Multi-page build (`index.html` + `reader.html`). |

The host page links to the reader with `?epub=/neko.epub`. Change the query
string to load a different book without rebuilding the reader.

## Deploying

Build with `yarn build`, then publish the contents of `dist/` to any static
host (GitHub Pages, Cloudflare Pages, Vercel static). The reader becomes a
self-contained widget you can drop into other sites:

```html
<iframe
  src="https://your-host.example/reader.html?epub=https://your-host.example/book.epub"
  width="600"
  height="800"
  loading="lazy"
></iframe>
```

## Run it

```bash
yarn install
yarn workspace @mejiro/example-embed-iframe dev
```

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/embed-iframe my-widget
cd my-widget
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.8.0\"'));"
npm install
npm run dev
```

## Reading further

- [`examples/vue`](../vue) — single-page (no iframe) Vue variant.
- [`@libraz/mejiro-vue` README](../../packages/mejiro-vue) — full API reference.
