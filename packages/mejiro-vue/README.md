# @libraz/mejiro-vue

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/mejiro/ci.yml?branch=main&label=CI)](https://github.com/libraz/mejiro/actions)
[![npm](https://img.shields.io/npm/v/@libraz/mejiro-vue)](https://www.npmjs.com/package/@libraz/mejiro-vue)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/libraz/mejiro/blob/main/LICENSE)
[![core](https://img.shields.io/npm/v/@libraz/mejiro?label=%40libraz%2Fmejiro)](https://www.npmjs.com/package/@libraz/mejiro)

**Vue 3 components and composables for [mejiro](https://www.npmjs.com/package/@libraz/mejiro).** Render vertical text yourself with the composables, or drop in the `MejiroReader` / `MejiroEditor` / `MejiroManuscriptEditor` components, with `MejiroShelf` and `MejiroToc` for library and table-of-contents screens.

## Install

```bash
npm install @libraz/mejiro @libraz/mejiro-vue vue
```

Peer dependency: `vue >= 3.3`.

## Quick start

```vue
<script setup lang="ts">
import '@libraz/mejiro/render/mejiro-fonts.css';  // optional webfonts
import { MejiroReader } from '@libraz/mejiro-vue';
</script>

<template>
  <MejiroReader epub-url="/book.epub" />
</template>
```

`MejiroReader` fills its container, so the root chain needs an explicit height:

```css
html, body, #app { height: 100%; margin: 0; }
```

To embed in normal page flow instead (a blog post, a docs page) with no height
math, use `fit="width"` — the reader self-sizes its height from its width:

```vue
<MejiroReader epub-url="/book.epub" fit="width" />
```

> Embedding inside a framework with an unlayered global CSS reset (VitePress,
> Tailwind preflight, normalize.css)? See the [cascade-layers note](https://github.com/libraz/mejiro/tree/main/docs/en/08-react-and-vue.md#css-cascade-layers-host-resets-can-clobber-the-reader-chrome)
> so host resets don't clobber the reader chrome.

## Templates

Copy-paste-ready starters live under [`examples/`](https://github.com/libraz/mejiro/tree/main/examples):

```bash
npx degit libraz/mejiro/examples/vue my-reader
npx degit libraz/mejiro/examples/vue-shelf my-library
npx degit libraz/mejiro/examples/vue-editor my-editor
npx degit libraz/mejiro/examples/vue-manuscript my-author
npx degit libraz/mejiro/examples/vue-embed my-embed
npx degit libraz/mejiro/examples/vue-headless my-headless
```

Templates are workspace members, so the copied `package.json` still carries
`workspace:*` versions. Each starter's own `README.md` carries the exact
one-liner that rewrites them to the matching published release — run it before
`npm install`.

## Documentation

- [React / Vue guide](https://github.com/libraz/mejiro/tree/main/docs/en/08-react-and-vue.md) — components, composables, props, theming, SSR
- [Project README](https://github.com/libraz/mejiro)
- 日本語ドキュメント: [docs/ja/08-react-and-vue.md](https://github.com/libraz/mejiro/tree/main/docs/ja/08-react-and-vue.md)

## License

[Apache License 2.0](https://github.com/libraz/mejiro/blob/main/LICENSE)
