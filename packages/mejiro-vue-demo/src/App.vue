<script setup lang="ts">
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { DEFAULT_HEADING_STYLES, DEFAULT_PAGE_PADDING, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-vue';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

const FONTS = [
  { value: "'Shippori Mincho', serif", label: 'Shippori Mincho' },
  { value: "'Noto Serif JP', serif", label: 'Noto Serif JP' },
  { value: "'Zen Kaku Gothic New', sans-serif", label: 'Zen Kaku Gothic New' },
  { value: 'serif', label: 'System Serif' },
];

const book = new MejiroBook({
  fontFamily: FONTS[0].value,
  fontSize: 16,
  lineSpacing: 1.9,
  headingStyles: DEFAULT_HEADING_STYLES,
});

const epub = ref<EpubBook | null>(null);
const layout = shallowRef<ChapterLayout | null>(null);
const spread = ref<SpreadResult | null>(null);
const spreadIdx = ref(0);
const chapter = ref(0);
const loading = ref(false);
const turning = ref(false);
const settingsOpen = ref(false);
const fontFamily = ref(FONTS[0].value);
const fontSize = ref(16);
const lineSpacing = ref(1.9);
const mode = ref<'strict' | 'loose'>('strict');
const hanging = ref(true);
const stats = ref('');
const pageW = ref(0);
const pageH = ref(0);
const surfaceEl = ref<HTMLDivElement | null>(null);
const fileEl = ref<HTMLInputElement | null>(null);

// Image overlay composable — manages imageRect, drag, and resize internally
const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, spreadIdx, (s) => {
    spread.value = s;
  });

const contentH = computed(() => pageH.value - DEFAULT_PAGE_PADDING.y - DEFAULT_PAGE_PADDING.bottom);
const totalSpreads = computed(() => (spread.value ? Math.ceil(spread.value.totalPages / 2) : 0));
const currentPage = computed(() => spreadIdx.value * 2);
const fontStyle = computed(() => ({
  fontSize: `${fontSize.value}px`,
  fontFamily: fontFamily.value,
  lineHeight: `${lineSpacing.value}`,
}));
const runningTitleRight = computed(() => {
  if (!epub.value) return '';
  return epub.value.author ? `${epub.value.author}  ${epub.value.title}` : epub.value.title;
});
const runningTitleLeft = computed(() => epub.value?.chapters[chapter.value]?.title ?? '');

async function loadEpub(buf: ArrayBuffer) {
  loading.value = true;
  try {
    epub.value = await parseEpub(buf);
    chapter.value = 0;
    spreadIdx.value = 0;
    imageRect.value = null;
  } finally {
    loading.value = false;
  }
}

// Default EPUB
onMounted(async () => {
  const res = await fetch('/neko.epub');
  if (res.ok) loadEpub(await res.arrayBuffer());
});

// Layout chapter
watch(
  [epub, chapter, fontFamily, fontSize, lineSpacing, mode, hanging],
  async () => {
    if (!epub.value) return;
    const ch = epub.value.chapters[chapter.value];
    if (!ch) return;
    if (!surfaceEl.value) return;

    book.setOptions({
      fontFamily: fontFamily.value,
      fontSize: fontSize.value,
      lineSpacing: lineSpacing.value,
      mode: mode.value,
      enableHanging: hanging.value,
    });
    const { pageWidth, pageHeight } = book.computePageSize(surfaceEl.value);
    pageW.value = pageWidth;
    pageH.value = pageHeight;

    const t0 = performance.now();
    layout.value = await book.layoutChapter(ch);
    const elapsed = performance.now() - t0;
    spreadIdx.value = 0;
    imageRect.value = null;

    const totalChars = ch.paragraphs.reduce((s, p) => s + p.text.length, 0);
    const totalRuby = ch.paragraphs.reduce((s, p) => s + p.rubyAnnotations.length, 0);
    const fontLabel = FONTS.find((f) => f.value === fontFamily.value)?.label ?? '';
    stats.value = [
      `${totalChars}ch`,
      `${layout.value.totalPages}pp`,
      totalRuby > 0 ? `${totalRuby}ruby` : null,
      `${fontLabel} ${fontSize.value}px`,
      `${elapsed.toFixed(0)}ms`,
    ]
      .filter(Boolean)
      .join(' / ');
  },
  { immediate: true },
);

// Update spread
watch([layout, spreadIdx], () => {
  if (layout.value && !imageRect.value) spread.value = layout.value.getSpread(spreadIdx.value);
});

function navigate(delta: number) {
  const next = spreadIdx.value + delta;
  if (next < 0 || next >= totalSpreads.value) return;
  turning.value = true;
  setTimeout(() => {
    spreadIdx.value = next;
    turning.value = false;
  }, 180);
}

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) file.arrayBuffer().then(loadEpub);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') navigate(1);
  if (e.key === 'ArrowRight') navigate(-1);
}

function onResize() {
  if (!(surfaceEl.value && layout.value)) return;
  // computePageSize calculates dimensions and updates book's internal page size
  const { pageWidth, pageHeight, contentHeight } = book.computePageSize(surfaceEl.value);
  pageW.value = pageWidth;
  pageH.value = pageHeight;
  layout.value.resize({
    pageWidth,
    // Derive line width from content height using the same formula as verticalLineWidth
    lineWidth: contentHeight - fontSize.value * 0.5,
  });
  // Re-sync images to reflow with new dimensions
  const images = imageRect.value
    ? [{ x: imageRect.value.x, y: imageRect.value.y, w: imageRect.value.w, h: imageRect.value.h }]
    : undefined;
  spread.value = layout.value.syncImages(spreadIdx.value, images);
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <header>
    <div class="header-left">
      <div class="logo">
        <span class="logo-mark">mejiro</span>
        <span class="logo-sub">Vue Demo</span>
      </div>
      <div v-if="epub" class="chapter-nav">
        <select :value="chapter" @change="chapter = Number(($event.target as HTMLSelectElement).value); spreadIdx = 0">
          <option v-for="(ch, i) in epub.chapters" :key="i" :value="i">{{ ch.title ?? `Chapter ${i + 1}` }}</option>
        </select>
      </div>
    </div>
    <div class="header-actions">
      <span class="stats">{{ stats }}</span>
      <button class="btn-header" @click="fileEl?.click()">Open</button>
      <button :class="['btn-header', { active: hasImage }]" @click="toggleImage">Image</button>
      <button :class="['btn-header', { active: settingsOpen }]" @click="settingsOpen = !settingsOpen">
        Settings<span class="arrow">&#9662;</span>
      </button>
    </div>
  </header>

  <div :class="['settings-panel', { open: settingsOpen }]">
    <div class="settings-inner">
      <div class="settings-group">
        <span class="settings-group-title">Font</span>
        <div class="control">
          <select :value="fontFamily" @change="fontFamily = ($event.target as HTMLSelectElement).value">
            <option v-for="f in FONTS" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </div>
        <div class="control">
          <label class="control-label">Size</label>
          <input type="number" :value="fontSize" min="10" max="48" @change="fontSize = Number(($event.target as HTMLInputElement).value)" />
        </div>
      </div>
      <div class="settings-group">
        <span class="settings-group-title">Layout</span>
        <div class="control">
          <label class="control-label">Kinsoku</label>
          <select :value="mode" @change="mode = ($event.target as HTMLSelectElement).value as 'strict' | 'loose'">
            <option value="strict">Strict</option>
            <option value="loose">Loose</option>
          </select>
        </div>
        <div class="control">
          <label class="control-label">Hanging</label>
          <select :value="String(hanging)" @change="hanging = ($event.target as HTMLSelectElement).value === 'true'">
            <option value="true">On</option>
            <option value="false">Off</option>
          </select>
        </div>
        <div class="control">
          <label class="control-label">行間</label>
          <input class="line-spacing" type="number" :value="lineSpacing" min="1.0" max="3.0" step="0.1" @change="lineSpacing = Number(($event.target as HTMLInputElement).value)" />
        </div>
      </div>
    </div>
  </div>

  <div ref="surfaceEl" class="reading-surface">
    <div v-if="!epub && !loading" class="drop-zone" @click="fileEl?.click()">
      <div class="drop-zone-icon">&#x1F4D6;</div>
      <div class="drop-zone-text"><strong>Drop an EPUB file here</strong><br>or click to browse</div>
      <div class="drop-zone-hint">Supports EPUB with furigana / ruby</div>
    </div>
    <div v-if="loading" class="loading-indicator">Loading...</div>
    <div v-if="epub && spread && pageW > 0" class="book">
      <div :class="['spread', { turning }]">
        <div class="page-container page-right" :style="{ width: `${pageW}px`, height: `${pageH}px`, overflow: hasImage ? 'visible' : undefined }">
          <div class="page-rule" />
          <div class="page-header">
            <span class="page-header-title">{{ runningTitleRight }}</span>
            <span class="page-header-num">{{ currentPage + 1 }}</span>
          </div>
          <div class="page-viewport">
            <div class="page-clip" :style="{ height: `${contentH}px` }">
              <MejiroPageView :result="spread.right" :slot-mode="hasImage" class="page-content" :style="{ ...fontStyle, height: `${contentH}px` }" :font-family="fontFamily" :line-spacing="lineSpacing" />
            </div>
          </div>
          <div
            v-if="imageRect"
            class="image-overlay visible"
            :style="{ left: `${imageRect.x}px`, top: `${imageRect.y}px`, width: `${imageRect.w}px`, height: `${imageRect.h}px`, cursor: 'grab', touchAction: 'none' }"
            @pointerdown="onOverlayPointerDown"
          >
            <div class="image-overlay-label"><div class="image-overlay-icon" /><span>Image</span></div>
            <div class="image-overlay-resize" @pointerdown="onResizePointerDown" />
            <div class="image-overlay-close" @pointerdown.stop.prevent="toggleImage" />
          </div>
        </div>
        <div class="page-container page-left" :style="{ width: `${pageW}px`, height: `${pageH}px` }">
          <div class="page-rule" />
          <div class="page-header">
            <span class="page-header-title">{{ runningTitleLeft }}</span>
            <span class="page-header-num">{{ currentPage + 2 <= spread.totalPages ? currentPage + 2 : '' }}</span>
          </div>
          <div class="page-viewport">
            <div class="page-clip" :style="{ height: `${contentH}px` }">
              <MejiroPageView :result="spread.left" :slot-mode="hasImage" class="page-content" :style="{ ...fontStyle, height: `${contentH}px` }" :font-family="fontFamily" :line-spacing="lineSpacing" />
            </div>
          </div>
        </div>
        <div class="nav-zone nav-zone--prev" @click="navigate(-1)" />
        <div class="nav-zone nav-zone--next" @click="navigate(1)" />
        <div class="page-indicator">{{ spreadIdx + 1 }} / {{ totalSpreads }}</div>
      </div>
    </div>
  </div>

  <input ref="fileEl" type="file" accept=".epub" hidden @change="onFileChange" />
</template>
