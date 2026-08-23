# React example — bookshelf gallery

A two-screen app: a "library" grid of book cards, click one to launch
`MejiroReader` with that book. The reader's logo slot becomes a
**← 本棚に戻る** button so the user can return.

```
┌──────────────┐                ┌──────────────┐
│ 📚 Library   │   click card   │ ← 本棚に戻る │
│              │ ─────────────► │              │
│  ░  ░  ░  +  │                │   spread     │
└──────────────┘                └──────────────┘
```

## Highlights

- **`useEpub` hook** is used as a stateless loader (parses + tracks loading);
  the parsed `EpubBook` instances are folded into the app's own `shelf`
  array so the gallery persists across switches.
- **`epub` prop** on `MejiroReader` accepts the pre-parsed book — no second
  parse, instant render.
- **`logo` prop** is reused for the back button: header stays consistent.
- The reader's per-book state (image overlays + font cache) is cleared
  automatically when the `epub` prop changes — no manual cleanup.

## Run it

```bash
yarn install
yarn workspace @mejiro/example-react-shelf dev
```

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/react-shelf my-library
cd my-library
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.9.0\"'));"
npm install
npm run dev
```

Drop your own EPUBs into `public/` (or use the **+ Add EPUB** card) to
populate the shelf. The pre-bundled sample (`/neko.epub`) only works inside
this monorepo.

## Reading further

- [`examples/react`](../react) — the minimal one-component variant.
- [`@libraz/mejiro-react` README](../../packages/mejiro-react) — full API reference.
