<script setup lang="ts">
// Opt in to the demo webfonts (Shippori Mincho / Noto Serif JP /
// Zen Kaku Gothic New). Skip this line for system fonts.
import '@libraz/mejiro/render/mejiro-fonts.css';
import { type ManuscriptEditorChapter, MejiroManuscriptEditor } from '@libraz/mejiro-vue';

/*
 * MejiroManuscriptEditor is the author flow for writing a NEW EPUB from
 * scratch:
 *
 *   - edit metadata (title, author, optional cover image),
 *   - add / remove chapters,
 *   - type the body using Aozora-bunko ruby syntax
 *     (e.g. `｜漢字《かんじ》` or `漢字《かんじ》`),
 *   - live-preview the result and export to .epub.
 *
 * The preview is debounced and rebuilds whenever metadata or chapters
 * change. For editing an existing EPUB, see the `vue-editor` example.
 */
const initialChapters: ManuscriptEditorChapter[] = [
  {
    id: 'chapter-1',
    title: '第一話 出会い',
    body:
      'これは｜縦書き《たてがき》のサンプルです。\n\n' +
      '段落は空行で区切ります。｜漢字《かんじ》にルビをふれます。',
  },
  {
    id: 'chapter-2',
    title: '第二話 旅立ち',
    body: 'ふたつ目の章は空のテンプレートから書き始められます。',
  },
];

function onExport(buffer: ArrayBuffer): void {
  // The editor also triggers a browser download. Use this hook to upload to
  // your backend, replace the URL, run a server-side validator, etc.
  // eslint-disable-next-line no-console
  console.log('[manuscript] exported', buffer.byteLength, 'bytes');
}
</script>

<template>
  <MejiroManuscriptEditor
    title="新しい作品"
    author="名無しの権兵衛"
    :chapters="initialChapters"
    @export="onExport"
  />
</template>
