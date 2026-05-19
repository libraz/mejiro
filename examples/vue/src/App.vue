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
 *   <MejiroReader epub-url="/book.epub" bare />   // bare spread (no chrome)
 *   <MejiroReader :enable-drop-zone="true" />     // let users drop their own EPUB
 *
 * Swap just the logo with a slot:
 *   <MejiroReader>
 *     <template #logo>...your markup...</template>
 *   </MejiroReader>
 *
 * SaaS-style defaults: drop zone + image overlay are off; the host decides
 * which EPUB to deliver. Flip them with `:enable-drop-zone="true"` /
 * `:enable-image-overlay="true"` when you want a free-form viewer.
 *
 * v0.5 additions worth trying:
 *   theme="dark"                                         'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto'
 *   mode="scroll"                                        continuous vertical scroll
 *   spread-mode="auto"                                   collapse to single page on portrait
 *   locale="en"                                          'ja' (default) | 'en'
 *   :fetch-options="{ headers: { Authorization: '…' } }" authenticated EPUB fetch
 *   <template #fallback><p>Loading…</p></template>       shown until client layout is ready
 */
</script>

<template>
  <MejiroReader epub-url="/neko.epub" subtitle="Vue Example" />
</template>
