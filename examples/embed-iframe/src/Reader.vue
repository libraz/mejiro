<script setup lang="ts">
// biome-ignore-all lint/style/useVueMultiWordComponentNames: iframe entry component, never registered as a custom element
// Iframe-target reader. Reads `?epub=` from the URL so the host page can
// pick which book to load without rebuilding this entry.
import '@libraz/mejiro/render/mejiro-fonts.css';
import { MejiroReader } from '@libraz/mejiro-vue';

const epubUrl = new URLSearchParams(window.location.search).get('epub') ?? undefined;
</script>

<template>
  <MejiroReader
    :epub-url="epubUrl"
    :enable-drop-zone="false"
    :enable-stats="false"
    :enable-settings="false"
  />
</template>
