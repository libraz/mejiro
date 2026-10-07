<script setup lang="ts">
import type { SpreadResult } from '@libraz/mejiro/book';
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-vue';
import { onMounted, ref, shallowRef } from 'vue';

// Create once so the cache persists
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

const surfaceEl = ref<HTMLDivElement | null>(null);
const spread = shallowRef<SpreadResult | null>(null);
const pageW = ref(0);
const pageH = ref(0);

onMounted(async () => {
  if (!surfaceEl.value) return;

  // Compute page dimensions from container
  const { pageWidth, pageHeight } = book.computePageSize(surfaceEl.value);
  pageW.value = pageWidth;
  pageH.value = pageHeight;

  // Load EPUB and lay out the first chapter
  const res = await fetch('/book.epub');
  const epub = await parseEpub(await res.arrayBuffer());
  const layout = await book.layoutChapter(epub.chapters[0]);

  // Get first spread
  spread.value = layout.getSpread(0);
});

const fontFamily = '"Noto Serif JP", serif';
const lineSpacing = 1.8;
</script>

<template>
  <div ref="surfaceEl" style="display: flex; justify-content: center; width: 100%; height: 100vh">
    <template v-if="spread">
      <MejiroPageView
        :result="spread.right"
        :style="{ width: `${pageW}px`, height: `${pageH}px`, fontSize: '16px', fontFamily, lineHeight: lineSpacing }"
        :font-family="fontFamily"
        :line-spacing="lineSpacing"
      />
      <MejiroPageView
        :result="spread.left"
        :style="{ width: `${pageW}px`, height: `${pageH}px`, fontSize: '16px', fontFamily, lineHeight: lineSpacing }"
        :font-family="fontFamily"
        :line-spacing="lineSpacing"
      />
    </template>
  </div>
</template>
