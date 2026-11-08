<script setup lang="ts">
// Opt in to the demo webfonts (Shippori Mincho / Noto Serif JP /
// Zen Kaku Gothic New). Skip this line for system fonts.
import '@libraz/mejiro/render/mejiro-fonts.css';
import { MejiroReader } from '@libraz/mejiro-vue';

/*
 * Common patterns:
 *
 *   <MejiroReader epub-url="/book.epub" />        // open a URL (this example)
 *   <MejiroReader :epub="parsedBook" />           // pre-parsed EPUB
 *   <MejiroReader epub-url="/book.epub" />        // no title: no header (bare spread)
 *   <MejiroReader :enable-drop-zone="true" />     // let users drop their own EPUB
 *
 * Swap just the logo with a slot:
 *   <MejiroReader>
 *     <template #logo>...your markup...</template>
 *   </MejiroReader>
 *
 * SaaS-style defaults: drop zone + image overlay are off; the host decides
 * which EPUB to deliver. Flip them with `:enable-drop-zone="true"` /
 * `:show-image-overlay-button="true"` when you want a free-form viewer.
 *
 * v0.5 additions worth trying:
 *   theme="dark"                                         'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto'
 *   mode="scroll"                                        continuous vertical scroll
 *   spread-mode="auto"                                   collapse to single page on portrait
 *   locale="ja"                                          'en' (default) | 'ja'
 *   :fetch-options="{ headers: { Authorization: '…' } }" authenticated EPUB fetch
 *   <template #fallback><p>Loading…</p></template>       shown until client layout is ready
 */
</script>

<template>
  <MejiroReader epub-url="/neko.epub" title="mejiro" subtitle="Vue Example" />
</template>
