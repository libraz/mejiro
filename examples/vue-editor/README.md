# Vue 3 editor example — `@libraz/mejiro-vue`

A minimal Vite + Vue 3 setup that opens an EPUB into `MejiroEditor` so an
author can proofread paragraphs, add ruby annotations, insert images, and
export the result.

```vue
<script setup lang="ts">
import '@libraz/mejiro/render/mejiro-fonts.css';  // optional webfonts
import { MejiroEditor } from '@libraz/mejiro-vue';
</script>

<template>
  <MejiroEditor epub-url="/book.epub" />
</template>
```

The drop zone is built in: when no URL is provided (or when the user wants to
load a different book), they can drop an EPUB onto the preview area.

## Run it

```bash
yarn install
yarn workspace @mejiro/example-vue-editor dev
# or from this folder:
yarn dev
```

The bundled demo EPUB (`/neko.epub`) loads on mount. Select a paragraph in
the right-hand panel, edit the text or ruby, then click **Export EPUB**.

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/vue-editor my-editor
cd my-editor
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.9.0\"'));"
npm install
npm run dev
```

## Editor vs ManuscriptEditor

| Component | When to use |
|-----------|-------------|
| `MejiroEditor` | You already have an EPUB and want to make targeted edits (proofreading, ruby, image insertion). |
| `MejiroManuscriptEditor` | You're authoring a brand-new book — chapters, metadata, optional cover. See `vue-manuscript`. |

## Events

| Event | Payload | When |
|-------|---------|------|
| `@load` | `EditableEpub` | After an EPUB is loaded into the editor. |
| `@export` | `ArrayBuffer` | After the user exports — useful for uploading to a backend. |
| `@error` | `Error` | Load failure (the editor also shows an inline message). |

## Reading further

- [`@libraz/mejiro-vue` README](https://github.com/libraz/mejiro/tree/main/packages/mejiro-vue) — full prop / composable reference.
- [`useEditableEpub`](https://github.com/libraz/mejiro/tree/main/packages/mejiro-vue) — the headless composable behind `MejiroEditor` if you want a custom UI.
