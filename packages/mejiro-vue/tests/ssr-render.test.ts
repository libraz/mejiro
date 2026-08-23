import type { EpubBook } from '@libraz/mejiro/epub';
import { renderToString } from '@vue/server-renderer';
import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { MejiroReader } from '../src/MejiroReader.js';
import { useMejiroBook } from '../src/useMejiroBook.js';

/**
 * Globals a browser has and a server does not. They are the tripwire the
 * server-rendering tests rely on: because none of them is declared here, a
 * composable that reads one during `setup` — rather than guarding with
 * `typeof` — throws a `ReferenceError` out of `renderToString` instead of
 * failing only in a real deployment.
 */
const DOM_GLOBALS = [
  'document',
  'window',
  'HTMLCanvasElement',
  'ResizeObserver',
  'localStorage',
] as const;

function fakeEpub(): EpubBook {
  return {
    title: 'Server Book',
    author: 'A',
    chapters: [
      {
        title: 'C1',
        paragraphs: [{ text: '吾輩は猫である。', inlineAnnotations: [] }],
      },
    ],
  } as unknown as EpubBook;
}

describe('mejiro composables on the server', () => {
  it('runs where no DOM global is declared', () => {
    for (const name of DOM_GLOBALS) {
      expect(typeof (globalThis as Record<string, unknown>)[name], name).toBe('undefined');
    }
  });

  it('creates the book from useMejiroBook without touching the DOM', async () => {
    const app = createSSRApp({
      setup() {
        const { book, options } = useMejiroBook({ fontFamily: 'serif', fontSize: 16 });
        return () => h('p', null, `${options.value.fontSize}px ${book.getOptions().fontFamily}`);
      },
    });

    await expect(renderToString(app)).resolves.toContain('16px serif');
  });
});

describe('MejiroReader server rendering', () => {
  it('renders the fallback slot without touching the DOM', async () => {
    expect(typeof document).toBe('undefined');

    const app = createSSRApp({
      render: () => h(MejiroReader, null, { fallback: () => h('p', null, 'static preview') }),
    });
    const html = await renderToString(app);

    expect(html).toContain('mejiro-reader-fallback');
    expect(html).toContain('static preview');
  });

  it('renders fallbackHtml for a pre-parsed EPUB without touching the DOM', async () => {
    const app = createSSRApp({
      render: () => h(MejiroReader, { epub: fakeEpub(), fallbackHtml: '<p>static preview</p>' }),
    });
    const html = await renderToString(app);

    expect(html).toContain('static preview');
    // The client-only spread is not emitted before hydration.
    expect(html).not.toContain('mejiro-spread');
  });
});
