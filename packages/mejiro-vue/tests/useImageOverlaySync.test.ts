// @vitest-environment happy-dom

import type { ChapterLayout } from '@libraz/mejiro/book';

import { describe, expect, it, vi } from 'vitest';
import { computed, ref, shallowRef } from 'vue';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { mockLayout, withSetup } from './helpers/fixtures.js';

describe('image overlays (Vue) — sync and gestures', () => {
  it('gives a replacement layout its overlays before views derived from it read it', () => {
    const first = mockLayout(4);
    const second = mockLayout(4);
    const layoutRef = shallowRef<ChapterLayout>(first);
    const { result, unmount } = withSetup(() =>
      useImageOverlay(layoutRef, { spreadIndex: ref(0) }),
    );
    result.addOverlay();
    // A view keyed on the layout and the overlays, as the readers derive theirs.
    const appliedWhenDerived = computed(() => {
      void result.currentImages.value;
      return vi.mocked(layoutRef.value.setImages).mock.calls.length;
    });

    layoutRef.value = second;
    expect(appliedWhenDerived.value).toBe(1);
    expect(second.setImages).toHaveBeenCalledWith(0, [expect.objectContaining({ x: 80 })]);
    unmount();
  });

  it.each(['overlay', 'resize'] as const)(
    'starts no %s drag from a secondary or auxiliary mouse button',
    (handle) => {
      const layout = shallowRef<ChapterLayout | null>(mockLayout(4));
      const overlays = withSetup(() => useImageOverlay(layout, { spreadIndex: ref(0) }));
      const { id } = overlays.result.addOverlay();
      const addSpy = vi.spyOn(document, 'addEventListener');
      try {
        for (const button of [1, 2]) {
          const target = Object.assign(document.createElement('div'), {
            setPointerCapture: vi.fn(),
          });
          const event = {
            pointerType: 'mouse',
            button,
            pointerId: 1,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            clientX: 0,
            clientY: 0,
            currentTarget: target,
          } as unknown as PointerEvent;
          if (handle === 'overlay') overlays.result.onOverlayPointerDown(id, event);
          else overlays.result.onResizePointerDown(id, event);
          expect(target.setPointerCapture).not.toHaveBeenCalled();
        }
        expect(addSpy).not.toHaveBeenCalledWith('pointermove', expect.any(Function));
      } finally {
        addSpy.mockRestore();
        overlays.unmount();
      }
    },
  );
});
