/** @jsxImportSource react */

import type { EpubBook } from '@libraz/mejiro/epub';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MejiroReader } from '../src/MejiroReader.js';
import { useMejiroBook } from '../src/useMejiroBook.js';

/**
 * Globals a browser has and a server does not. They are the tripwire the
 * server-rendering tests rely on: because none of them is declared here, a hook
 * body that reads one — rather than guarding with `typeof` — throws a
 * `ReferenceError` out of `renderToString` instead of failing only in a real
 * deployment.
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

describe('mejiro hooks on the server', () => {
  it('runs where no DOM global is declared', () => {
    for (const name of DOM_GLOBALS) {
      expect(typeof (globalThis as Record<string, unknown>)[name], name).toBe('undefined');
    }
  });

  it('creates the book from useMejiroBook without touching the DOM', () => {
    function BookProbe() {
      const { book, options } = useMejiroBook({ fontFamily: 'serif', fontSize: 16 });
      return <p>{`${options.fontSize}px ${book.getOptions().fontFamily}`}</p>;
    }

    expect(renderToString(<BookProbe />)).toContain('16px serif');
  });
});

describe('MejiroReader server rendering', () => {
  it('renders the fallback without touching the DOM', () => {
    expect(typeof document).toBe('undefined');

    const html = renderToString(<MejiroReader fallback={<p>static preview</p>} />);

    expect(html).toContain('mejiro-reader-fallback');
    expect(html).toContain('static preview');
  });

  it('renders the fallback for a pre-parsed EPUB without touching the DOM', () => {
    const html = renderToString(
      <MejiroReader epub={fakeEpub()} fallback={<p>static preview</p>} />,
    );

    expect(html).toContain('static preview');
    // The client-only spread is not emitted before hydration.
    expect(html).not.toContain('mejiro-spread');
  });
});
