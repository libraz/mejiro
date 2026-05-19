<script setup lang="ts">
// Headless = bypass MejiroReader, build the UI yourself from composables.
// Shown here: custom header + MejiroSpread + custom prev/next zones.
import '@libraz/mejiro/render/mejiro-fonts.css';
import { DEFAULT_BOOK_OPTIONS } from '@libraz/mejiro/book';
import {
  MejiroSpread,
  useChapterLayout,
  useEpub,
  useMejiroBook,
  useSpread,
} from '@libraz/mejiro-vue';
import { computed, ref } from 'vue';

const surface = ref<HTMLDivElement | null>(null);
const chapter = ref(0);

const { book } = useMejiroBook({ ...DEFAULT_BOOK_OPTIONS, fontSize: 18, lineSpacing: 2.0 });
const { epub } = useEpub({ defaultUrl: '/neko.epub' });
const layoutCtx = useChapterLayout(book, epub, chapter, surface);
const spreadCtx = useSpread(layoutCtx.layout, { enableKeyboard: true });

const heading = computed(() => {
  const b = epub.value;
  if (!b) return '読み込み中…';
  return b.author ? `${b.author} — ${b.title}` : b.title;
});
</script>

<template>
  <div class="shell">
    <header class="bar">
      <span class="title">{{ heading }}</span>
      <span class="nav-info" v-if="spreadCtx.spread.value">
        {{ spreadCtx.spreadIdx.value + 1 }} / {{ spreadCtx.totalSpreads.value }}
      </span>
    </header>

    <div ref="surface" class="surface">
      <MejiroSpread
        v-if="spreadCtx.spread.value && layoutCtx.layout.value"
        :spread="spreadCtx.spread.value"
        :page-width="layoutCtx.pageWidth.value"
        :page-height="layoutCtx.pageHeight.value"
        :content-height="layoutCtx.contentHeight.value"
        :font-family="book.getOptions().fontFamily"
        :font-size="book.getOptions().fontSize"
        :line-spacing="book.getOptions().lineSpacing"
        :turning="spreadCtx.turning.value"
        @prev="spreadCtx.prev()"
        @next="spreadCtx.next()"
      />
      <p v-else class="loading">Loading…</p>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.bar {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #f0eadb;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
  font-size: 0.78rem;
}

.title {
  font-family: 'Shippori Mincho', 'Noto Serif JP', serif;
  letter-spacing: 0.04em;
}

.nav-info {
  font-variant-numeric: tabular-nums;
  color: #6b6156;
  font-size: 0.7rem;
}

.surface {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 30% 0%, rgba(60, 50, 38, 0.06) 0%, transparent 70%),
    #faf6ec;
  overflow: hidden;
}

.loading {
  color: #8a8078;
  font-size: 0.85rem;
  letter-spacing: 0.1em;
}
</style>
