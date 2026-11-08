<script setup lang="ts">
import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-vue';
import { computed, onMounted, ref, shallowRef } from 'vue';

const props = defineProps<{ paragraphs: { text: string }[] }>();

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
});

const containerRef = ref<HTMLElement | null>(null);
const layout = shallowRef<ChapterLayout | null>(null);
const spread = shallowRef<SpreadResult | null>(null);
const spreadIndex = ref(0);
const pageSize = ref({ width: 0, height: 0 });

// Image overlays: every change re-flows the spread around them (layout and spreadIndex are Refs)
const { currentImages, addOverlay, clearOverlays, onOverlayPointerDown, onResizePointerDown } =
  useImageOverlay(layout, {
    spreadIndex,
    onReflow: (s) => {
      spread.value = s;
    },
  });
const overlay = computed(() => currentImages.value[0]);

const spreadCount = computed(() => (spread.value ? Math.ceil(spread.value.pageCount / 2) : 0));

function goTo(index: number): void {
  if (!layout.value) return;
  spreadIndex.value = index;
  spread.value = layout.value.getSpread(index);
}

function toggleOverlay(): void {
  if (overlay.value) clearOverlays(spreadIndex.value);
  else addOverlay();
}

onMounted(async () => {
  const el = containerRef.value;
  if (!el) return;

  const { pageWidth, pageHeight } = book.fitPageSize(el);
  pageSize.value = { width: pageWidth, height: pageHeight };

  const lo = await book.layoutChapter({ paragraphs: props.paragraphs });
  layout.value = lo;
  spread.value = lo.getSpread(0);
});
</script>

<template>
  <div ref="containerRef">
    <template v-if="spread">
      <div style="display: flex; gap: 4px; justify-content: center">
        <!-- Right page (first in vertical-rl order) -->
        <div
          :style="{ width: pageSize.width + 'px', height: pageSize.height + 'px', position: 'relative' }"
        >
          <MejiroPageView
            :result="spread.right"
            font-family='"Noto Serif JP"'
            :line-spacing="1.8"
            :slot-mode="spread.right.hasImages"
            :style="{ width: '100%', height: '100%' }"
          />
          <!-- Image overlay on the right page -->
          <div
            v-if="overlay"
            :style="{
              position: 'absolute',
              left: overlay.rect.x + 'px',
              top: overlay.rect.y + 'px',
              width: overlay.rect.width + 'px',
              height: overlay.rect.height + 'px',
              background: 'rgba(0,0,0,0.1)',
              border: '2px dashed #888',
              cursor: 'move',
            }"
            @pointerdown="onOverlayPointerDown(overlay.id, $event)"
          >
            <!-- Resize handle -->
            <div
              :style="{
                position: 'absolute',
                right: 0,
                bottom: 0,
                width: '16px',
                height: '16px',
                cursor: 'nwse-resize',
              }"
              @pointerdown="onResizePointerDown(overlay.id, $event)"
            />
          </div>
        </div>

        <!-- Left page -->
        <div :style="{ width: pageSize.width + 'px', height: pageSize.height + 'px' }">
          <MejiroPageView
            :result="spread.left"
            font-family='"Noto Serif JP"'
            :line-spacing="1.8"
            :slot-mode="spread.left.hasImages"
            :style="{ width: '100%', height: '100%' }"
          />
        </div>
      </div>

      <div style="text-align: center; margin-top: 8px">
        <button :disabled="spreadIndex === 0" @click="goTo(spreadIndex - 1)">Previous</button>
        <span style="margin: 0 1em">{{ spreadIndex + 1 }} / {{ spreadCount }}</span>
        <button :disabled="spreadIndex >= spreadCount - 1" @click="goTo(spreadIndex + 1)">
          Next
        </button>
        <button style="margin-left: 1em" @click="toggleOverlay">
          {{ overlay ? 'Remove Image' : 'Add Image' }}
        </button>
      </div>
    </template>
    <div v-else>Loading...</div>
  </div>
</template>
