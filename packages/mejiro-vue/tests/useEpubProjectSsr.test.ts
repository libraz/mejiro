// @vitest-environment node

import { renderToString } from '@vue/server-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { useEpubProject } from '../src/useEpubProject.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useEpubProject during server-side rendering (Vue)', () => {
  it('schedules no preview build and resolves no asset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    const assetResolver = vi.fn(() => new Uint8Array([0xff, 0xd8]));
    const onPreview = vi.fn();
    const app = createSSRApp(
      defineComponent({
        setup() {
          useEpubProject({
            debounceMs: 4321,
            cover: { href: 'OPS/Images/cover.jpg', url: 'https://cdn.example.test/cover.jpg' },
            assetResolver,
            onPreview,
          });
          return () => h('div');
        },
      }),
    );

    await renderToString(app);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(timerSpy.mock.calls.some((call) => call[1] === 4321)).toBe(false);
    expect(assetResolver).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
