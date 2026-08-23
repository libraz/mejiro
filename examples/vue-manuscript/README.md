# Vue 3 manuscript example — `@libraz/mejiro-vue`

A minimal Vite + Vue 3 setup that uses `MejiroManuscriptEditor` to write a
new book from scratch — metadata, chapters, optional cover — with a live
vertical-rl preview.

```vue
<script setup lang="ts">
import '@libraz/mejiro/render/mejiro-fonts.css';  // optional webfonts
import { MejiroManuscriptEditor } from '@libraz/mejiro-vue';
</script>

<template>
  <MejiroManuscriptEditor title="新しい作品" author="名無しの権兵衛" />
</template>
```

## Run it

```bash
yarn install
yarn workspace @mejiro/example-vue-manuscript dev
# or from this folder:
yarn dev
```

Type into the **Draft** textarea — the right preview rebuilds (debounced)
as you go. Click **Export EPUB** to download the result.

## Ruby syntax

Aozora-bunko style:

| Source | Renders as |
|--------|------------|
| `漢字《かんじ》` | 漢字 with かんじ as ruby (group) |
| `｜漢字熟語《かんじじゅくご》` | bounded range with ruby on the whole span |

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/vue-manuscript my-author
cd my-author
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.9.0\"'));"
npm install
npm run dev
```

## Manuscript vs Editor

| Component | When to use |
|-----------|-------------|
| `MejiroManuscriptEditor` | Writing a brand-new EPUB. This example. |
| `MejiroEditor` | Targeted edits on an existing EPUB (proofreading, ruby, image insertion). See `vue-editor`. |

## Events

| Event | Payload | When |
|-------|---------|------|
| `@export` | `ArrayBuffer` | After the user exports — useful for uploading to a backend. |

## Reading further

- [`@libraz/mejiro-vue` README](https://github.com/libraz/mejiro/tree/main/packages/mejiro-vue) — full prop / composable reference.
- [`useEpubProject`](https://github.com/libraz/mejiro/tree/main/packages/mejiro-vue) — the headless composable behind `MejiroManuscriptEditor`.
