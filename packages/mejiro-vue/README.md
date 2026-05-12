# @libraz/mejiro-vue

[![npm version](https://img.shields.io/npm/v/@libraz/mejiro-vue.svg)](https://www.npmjs.com/package/@libraz/mejiro-vue)
[![license](https://img.shields.io/npm/l/@libraz/mejiro-vue.svg)](https://github.com/libraz/mejiro/blob/main/LICENSE)

Vue 3 components and composables for [mejiro](https://www.npmjs.com/package/@libraz/mejiro) — vertical text rendering plus full-featured `MejiroReader` / `MejiroEditor` / `MejiroManuscriptEditor` components.

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

## Templates

Copy-paste-ready starters live under [`examples/`](https://github.com/libraz/mejiro/tree/main/examples):

```bash
npx degit libraz/mejiro/examples/vue my-reader
npx degit libraz/mejiro/examples/vue-shelf my-library
npx degit libraz/mejiro/examples/vue-editor my-editor
npx degit libraz/mejiro/examples/vue-manuscript my-author
```

## Documentation

- [React / Vue guide](https://github.com/libraz/mejiro/tree/main/docs/en/08-react-and-vue.md) — components, composables, props, theming, SSR
- [Project README](https://github.com/libraz/mejiro)
- 日本語ドキュメント: [docs/ja/08-react-and-vue.md](https://github.com/libraz/mejiro/tree/main/docs/ja/08-react-and-vue.md)

## License

[Apache License 2.0](https://github.com/libraz/mejiro/blob/main/LICENSE)
