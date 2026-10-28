<script setup lang="ts">
import '@libraz/mejiro/render/mejiro-fonts.css';
import type { EpubBook } from '@libraz/mejiro/epub';
import {
  MejiroReader,
  MejiroShelf,
  useEpub,
  useLibrary,
  type VolumeInfo,
} from '@libraz/mejiro-vue';
import { computed, onMounted, ref, shallowRef } from 'vue';

/*
 * v0.5 ships `MejiroShelf` (visual bookshelf) and `useLibrary` (headless
 * volume tracker). They replace the hand-rolled shelf from v0.4 — pass any
 * list of `VolumeInfo<T>` and you get card grid + active-id tracking +
 * next/prev/goTo navigation.
 */
interface BookMeta {
  epub: EpubBook;
}

// Shallow: parsed books are large and must not be wrapped in deep reactive proxies.
const volumes = shallowRef<VolumeInfo<BookMeta>[]>([]);
const activeId = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const { loadBuffer, loadFile, loading, error } = useEpub();
const library = useLibrary({ volumes });
const active = computed(() => volumes.value.find((v) => v.id === activeId.value) ?? null);

let nextId = 0;

function addBook(book: EpubBook): void {
  nextId += 1;
  volumes.value = [
    ...volumes.value,
    {
      id: `book-${nextId}`,
      label: book.title,
      author: book.author ?? '',
      meta: { epub: book },
    },
  ];
}

// useEpub loads one book at a time, so every load (sample and picks) runs through one queue.
let queue: Promise<void> = Promise.resolve();
function enqueue(load: () => Promise<EpubBook | null>): void {
  queue = queue.then(async () => {
    const book = await load();
    if (book) addBook(book);
  });
}

// Pre-populate from the bundled sample if it exists (monorepo demo only).
onMounted(() => {
  enqueue(async () => {
    try {
      const res = await fetch('/neko.epub');
      // A dev server answers a missing file with index.html; that is "no sample".
      if (!res.ok || res.headers.get('content-type')?.includes('text/html')) return null;
      return await loadBuffer(await res.arrayBuffer());
    } catch {
      return null; // shelf starts empty
    }
  });
});

function onPickFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) enqueue(() => loadFile(file));
}
</script>

<template>
  <div v-if="!active" class="shelf">
    <MejiroShelf
      :volumes="volumes"
      :current-id="library.current.value?.id"
      title="本棚"
      @select="(v) => (activeId = v.id)"
    />
    <div class="shelf-actions">
      <button
        type="button"
        class="add-btn"
        :disabled="loading"
        @click="fileInput?.click()"
      >
        {{ loading ? 'Loading…' : '+ Add EPUB' }}
      </button>
      <p v-if="error" class="shelf-error" role="alert">{{ error.message }}</p>
    </div>
    <input ref="fileInput" type="file" accept=".epub" hidden @change="onPickFile" />
  </div>

  <MejiroReader
    v-else
    :epub="active.meta.epub"
    :subtitle="active.author"
    :enable-drop-zone="false"
  >
    <template #logo>
      <button type="button" class="back-btn" @click="activeId = null">← 本棚に戻る</button>
    </template>
  </MejiroReader>
</template>

<style scoped>
.shelf {
  width: 100%;
  height: 100%;
  padding: 48px 36px;
  box-sizing: border-box;
  overflow-y: auto;
  background:
    radial-gradient(ellipse at 30% 0%, rgba(60, 50, 38, 0.6) 0%, transparent 70%),
    #1c1915;
  color: #d6cfc5;
  font-family: 'Zen Kaku Gothic New', system-ui, sans-serif;
}

.shelf-actions {
  max-width: 960px;
  margin: 32px auto 0;
  display: flex;
  justify-content: center;
}

.shelf-error {
  margin: 0 0 0 16px;
  align-self: center;
  color: #e0a39a;
  font-size: 0.8rem;
}

.add-btn {
  background: rgba(255, 255, 255, 0.02);
  color: #b0a898;
  border: 1.5px dashed rgba(255, 255, 255, 0.18);
  padding: 14px 28px;
  font: inherit;
  font-size: 0.85rem;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-btn:hover:not(:disabled) {
  border-color: #a85c50;
  background: rgba(139, 58, 58, 0.06);
  color: #d6cfc5;
}

.add-btn:disabled {
  opacity: 0.5;
  cursor: progress;
}

.back-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #d6cfc5;
  padding: 6px 14px;
  font: inherit;
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.32);
}
</style>
