# @libraz/mejiro-react

[![npm version](https://img.shields.io/npm/v/@libraz/mejiro-react.svg)](https://www.npmjs.com/package/@libraz/mejiro-react)
[![license](https://img.shields.io/npm/l/@libraz/mejiro-react.svg)](https://github.com/libraz/mejiro/blob/main/LICENSE)

React components and hooks for [mejiro](https://www.npmjs.com/package/@libraz/mejiro) — vertical text rendering plus full-featured `MejiroReader` / `MejiroEditor` / `MejiroManuscriptEditor` components.

## Install

```bash
npm install @libraz/mejiro @libraz/mejiro-react react
npm install -D @types/react
```

Peer dependency: `react >= 18`.

## Quick start

```tsx
import '@libraz/mejiro/render/mejiro-fonts.css';  // optional webfonts
import { MejiroReader } from '@libraz/mejiro-react';

export default function App() {
  return <MejiroReader epubUrl="/book.epub" />;
}
```

`MejiroReader` fills its container, so the root chain needs an explicit height:

```css
html, body, #root { height: 100%; margin: 0; }
```

## Templates

Copy-paste-ready starters live under [`examples/`](https://github.com/libraz/mejiro/tree/main/examples):

```bash
npx degit libraz/mejiro/examples/react my-reader
npx degit libraz/mejiro/examples/react-shelf my-library
npx degit libraz/mejiro/examples/react-editor my-editor
npx degit libraz/mejiro/examples/react-manuscript my-author
```

## Documentation

- [React / Vue guide](https://github.com/libraz/mejiro/tree/main/docs/en/08-react-and-vue.md) — components, hooks, props, theming, SSR
- [Project README](https://github.com/libraz/mejiro)
- 日本語ドキュメント: [docs/ja/08-react-and-vue.md](https://github.com/libraz/mejiro/tree/main/docs/ja/08-react-and-vue.md)

## License

[Apache License 2.0](https://github.com/libraz/mejiro/blob/main/LICENSE)
