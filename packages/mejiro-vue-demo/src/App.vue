<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { verticalLineWidth } from '@libraz/mejiro/browser';
import type { EpubBook } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-vue';

const PAD_X = 52;
const PAD_Y = 56;
const PAD_BOTTOM = 40;

const FONTS = [
  { value: "'Shippori Mincho', serif", label: 'Shippori Mincho' },
  { value: "'Noto Serif JP', serif", label: 'Noto Serif JP' },
  { value: "'Zen Kaku Gothic New', sans-serif", label: 'Zen Kaku Gothic New' },
  { value: 'serif', label: 'System Serif' },
];

const HEADING_STYLES = {
  1: { scale: 1.6, gapAfterEm: 1.4 },
  2: { scale: 1.4, gapAfterEm: 1.2 },
  3: { scale: 1.2, gapAfterEm: 1.0 },
  4: { scale: 1.1, gapAfterEm: 0.8 },
};

const book = new MejiroBook({
  fontFamily: FONTS[0].value,
  fontSize: 16,
  lineSpacing: 1.9,
  headingStyles: HEADING_STYLES,
});

const epub = ref<EpubBook | null>(null);
const layout = ref<ChapterLayout | null>(null);
const spread = ref<SpreadResult | null>(null);
const spreadIdx = ref(0);
const chapter = ref(0);
const imageRect = ref<{ x: number; y: number; w: number; h: number } | null>(null);
const hasImage = computed(() => imageRect.value !== null);
const IMG_W = 120;
const IMG_H = 160;
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

const contentH = computed(() => pageH.value - PAD_Y - PAD_BOTTOM);
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

function computeSize() {
  const el = surfaceEl.value;
  if (!el) return null;
  const availH = el.clientHeight - 56;
  const availW = el.clientWidth - 48;
  const ratio = 1.45;
  let h = Math.min(availH, 780);
  let w = Math.round(h / ratio);
  if (w * 2 > availW) { w = Math.floor(availW / 2); h = Math.round(w * ratio); }
  return { w: Math.max(w, 280), h: Math.max(h, 400) };
}

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
    const size = computeSize();
    if (!size) return;

    pageW.value = size.w;
    pageH.value = size.h;
    book.setOptions({
      fontFamily: fontFamily.value,
      fontSize: fontSize.value,
      lineSpacing: lineSpacing.value,
      mode: mode.value,
      enableHanging: hanging.value,
    });
    book.setPageSize({
      pageWidth: size.w,
      lineWidth: verticalLineWidth(size.h - PAD_Y - PAD_BOTTOM, fontSize.value),
      pagePaddingX: PAD_X,
      pagePaddingY: PAD_Y,
    });

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
    ].filter(Boolean).join(' / ');
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

function syncImages(rect: { x: number; y: number; w: number; h: number } | null) {
  if (!layout.value) return;
  if (rect) {
    layout.value.setImages(spreadIdx.value, [rect]);
  } else {
    layout.value.clearImages();
  }
  spread.value = layout.value.getSpread(spreadIdx.value);
}

function toggleImage() {
  if (!layout.value) return;
  if (imageRect.value) {
    imageRect.value = null;
    syncImages(null);
  } else {
    imageRect.value = { x: 80, y: 100, w: IMG_W, h: IMG_H };
    syncImages(imageRect.value);
  }
}

function onOverlayPointerDown(e: PointerEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const start = { ...imageRect.value! };
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  target.classList.add('dragging');

  let rafId = 0;
  const onMove = (me: PointerEvent) => {
    const dx = me.clientX - startX;
    const dy = me.clientY - startY;
    const r = { ...start, x: start.x + dx, y: start.y + dy };
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { imageRect.value = r; syncImages(r); });
  };
  const onUp = () => {
    target.classList.remove('dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function onResizePointerDown(e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const start = { ...imageRect.value! };
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  target.parentElement?.classList.add('dragging');

  let rafId = 0;
  const onMove = (me: PointerEvent) => {
    const dx = me.clientX - startX;
    const dy = me.clientY - startY;
    const r = { ...start, w: Math.max(40, start.w + dx), h: Math.max(40, start.h + dy) };
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { imageRect.value = r; syncImages(r); });
  };
  const onUp = () => {
    target.parentElement?.classList.remove('dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
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
  const size = computeSize();
  if (size && layout.value) {
    pageW.value = size.w;
    pageH.value = size.h;
    layout.value.resize({
      pageWidth: size.w,
      lineWidth: verticalLineWidth(size.h - PAD_Y - PAD_BOTTOM, fontSize.value),
    });
    syncImages(imageRect.value);
  }
}

onMounted(() => { window.addEventListener('keydown', onKeydown); window.addEventListener('resize', onResize); });
onUnmounted(() => { window.removeEventListener('keydown', onKeydown); window.removeEventListener('resize', onResize); });
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
