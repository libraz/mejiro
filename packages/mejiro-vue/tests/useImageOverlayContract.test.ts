// @vitest-environment happy-dom

import type { BookImage, ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { withSetup } from './helpers/fixtures.js';

/** Layout stub whose `setImages` returns the reflowed spread, as the core layout does. */
function reflowingLayout(): ChapterLayout {
  return {
    pageCount: 8,
    setImages: vi.fn(
      (spreadIndex: number, images: readonly BookImage[]) =>
        ({ spreadIndex, images }) as unknown as SpreadResult,
    ),
    clearImages: vi.fn(),
    getSpread: vi.fn((spreadIndex: number) => ({ spreadIndex }) as unknown as SpreadResult),
  } as unknown as ChapterLayout;
}

describe('useImageOverlay (Vue) — overlays per spread', () => {
  it('adds overlays on the spread named by the spreadIndex option and reflows through onReflow', () => {
    const layout = reflowingLayout();
    const spreadIndex = ref(1);
    const onReflow = vi.fn();
    const { result, unmount } = withSetup(() =>
      useImageOverlay(shallowRef(layout), { spreadIndex, onReflow, margin: 12 }),
    );

    const item = result.addOverlay({ x: 5, width: 40 });

    expect(item.rect).toEqual({ x: 5, y: 100, width: 40, height: 160 });
    expect(layout.setImages).toHaveBeenCalledWith(1, [
      { x: 5, y: 100, width: 40, height: 160, margin: 12 },
    ]);
    expect(onReflow).toHaveBeenCalledWith(vi.mocked(layout.setImages).mock.results[0].value);
    expect(result.hasOverlays.value).toBe(true);
    expect(result.currentImages.value).toEqual([item]);
    unmount();
  });

  it('updates, removes and clears overlays by id and by spread', () => {
    const layout = reflowingLayout();
    const spreadIndex = ref(0);
    const { result, unmount } = withSetup(() => useImageOverlay(() => layout, { spreadIndex }));
    const a = result.addOverlay();
    spreadIndex.value = 2;
    const b = result.addOverlay();

    result.updateOverlay(a.id, { height: 30 });
    expect(result.imagesBySpread.value.get(0)?.[0].rect.height).toBe(30);

    result.clearOverlays(0);
    expect(result.imagesBySpread.value.has(0)).toBe(false);
    expect(result.currentImages.value).toEqual([b]);

    result.removeOverlay(b.id);
    expect(result.hasOverlays.value).toBe(false);

    result.addOverlay();
    result.clearOverlays();
    expect(layout.clearImages).toHaveBeenCalledWith();
    expect(result.imagesBySpread.value.size).toBe(0);
    unmount();
  });

  it('gives a replacement layout every spread’s overlays', async () => {
    const first = reflowingLayout();
    const second = reflowingLayout();
    const source = shallowRef(first);
    const spreadIndex = ref(0);
    const onReflow = vi.fn();
    const { result, unmount } = withSetup(() => useImageOverlay(source, { spreadIndex, onReflow }));
    result.addOverlay();
    spreadIndex.value = 3;
    result.addOverlay();
    onReflow.mockClear();

    source.value = second;
    await nextTick();

    expect(vi.mocked(second.setImages).mock.calls.map((call) => call[0])).toEqual([0, 3]);
    expect(onReflow).toHaveBeenCalledTimes(2);
    unmount();
  });
});

describe('useImageOverlay (Vue) — public types', () => {
  it('takes the layout and one options object and drops the single-overlay names', () => {
    expectTypeErrors(
      `import type { ChapterLayout } from '@libraz/mejiro/book';
import { type ImageOverlayRect, type MultiImageItem, type UseImageOverlayOptions, useImageOverlay } from '@libraz/mejiro-vue';
import { ref, shallowRef } from 'vue';
const layout = shallowRef<ChapterLayout | null>(null);
const options: UseImageOverlayOptions = { spreadIndex: ref(0), onReflow: () => {}, defaultWidth: 10 };
const state = useImageOverlay(layout, options);
const item: MultiImageItem = state.addOverlay({ width: 5 });
const rect: ImageOverlayRect = item.rect;
void rect;
state.clearOverlays(1);
const any: boolean = state.hasOverlays.value;
void any;
useImageOverlay(layout, ref(0), () => {});
useImageOverlay(layout, { spreadIndex: 0, onUpdate: () => {} });
state.addImage();
state.toggleImage();
import type { ImageRect } from '@libraz/mejiro-vue';
import { useMultiImageOverlay } from '@libraz/mejiro-vue';`,
      {
        fails: [
          'useImageOverlay(layout, ref(0)',
          'onUpdate: ()',
          'state.addImage',
          'state.toggleImage',
          "import type { ImageRect } from '@libraz/mejiro-vue'",
          'import { useMultiImageOverlay }',
        ],
      },
    );
  });
});
