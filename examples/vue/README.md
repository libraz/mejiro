# Vue 3 example — `@libraz/mejiro-vue`

A minimal Vite + Vue 3 setup that reproduces the demo look with
**two imports and one component**.

```vue
<script setup lang="ts">
import '@libraz/mejiro/render/mejiro-fonts.css';  // optional webfonts
import { MejiroReader } from '@libraz/mejiro-vue';
</script>

<template>
  <MejiroReader epub-url="/book.epub" />
</template>
```

CSS is auto-loaded by the package — no extra `mejiro.css` import.

## Run it

```bash
yarn install
yarn workspace @mejiro/example-vue dev
# or from this folder:
yarn dev
```

The example loads `/neko.epub` on mount. ArrowLeft / ArrowRight to navigate,
and click **Settings** for font / size / kinsoku. Set `enable-drop-zone` or
`enable-image-overlay` when you want users to drop their own EPUB or place
draggable image placeholders.

## Use this as a starter

```bash
npx degit libraz/mejiro/examples/vue my-reader
cd my-reader
node -e "const fs = require('node:fs'); const p = 'package.json'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('\"workspace:*\"', '\"^0.8.0\"'));"
npm install
npm run dev
```

## What each file does

| File | Why it matters |
|------|----------------|
| `index.html` | `html, body, #app { height: 100% }` reset only. No CSS or font links. |
| `src/main.ts` | Mounts the Vue app. |
| `src/App.vue` | One `<MejiroReader epub-url>` and an optional `mejiro-fonts.css` import. |

## Common patterns

```vue
<!-- Open a URL on mount -->
<MejiroReader epub-url="/book.epub" />

<!-- Pre-parsed EpubBook -->
<MejiroReader :epub="myParsedBook" />

<!-- Bare spread (no header, no settings, no overlay) -->
<MejiroReader epub-url="/book.epub" bare />

<!-- Custom logo -->
<MejiroReader>
  <template #logo>
    <img src="/logo.svg" alt="My Library" height="24" />
  </template>
</MejiroReader>
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

- [`@libraz/mejiro-vue` README](https://github.com/libraz/mejiro/tree/main/packages/mejiro-vue) — full prop / composable reference.
- [Headless composables](https://github.com/libraz/mejiro/tree/main/packages/mejiro-vue#composables-headless-no-ui) — bypass `MejiroReader` and consume the composables directly.
