// @vitest-environment node

import { renderToString } from '@vue/server-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { MejiroEditor } from '../src/MejiroEditor.js';
import { useEditableEpub } from '../src/useEditableEpub.js';
import { useEpub } from '../src/useEpub.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('URL loading during server-side rendering', () => {
  it('MejiroEditor does not fetch epubUrl during SSR', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = createSSRApp({ render: () => h(MejiroEditor, { epubUrl: '/book.epub' }) });
    await renderToString(app);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['useEditableEpub', () => useEditableEpub({ defaultUrl: '/book.epub' })],
    ['useEpub', () => useEpub({ defaultUrl: '/book.epub' })],
  ])('%s does not fetch defaultUrl during SSR', async (_name, use) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = createSSRApp(
      defineComponent({
        setup() {
          use();
          return () => h('div');
        },
      }),
    );
    await renderToString(app);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
