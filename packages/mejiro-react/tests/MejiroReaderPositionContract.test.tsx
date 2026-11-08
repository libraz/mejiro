// @vitest-environment happy-dom
/** @jsxImportSource react */

/*
 * Combinatorial model — MejiroReader controlled detection (pairwise, strength 2,
 * seed 1): 7 rows covering 60/60 tuples.
 *
 * Model: chapterIndex, onChapterIndexChange, spreadIndex, onSpreadIndexChange,
 * anchor, onAnchorChange — each absent|given.
 * Expected per row: a pair is controlled iff its handler is given; when anchor
 * and spreadIndex are both controlled/given, anchor wins.
 *
 * | chapterIndex | onChapterIndexChange | spreadIndex | onSpreadIndexChange | anchor | onAnchorChange |
 * |---|---|---|---|---|---|
 * | absent | absent | absent | given | absent | given |
 * | given | given | given | given | given | absent |
 * | given | absent | given | absent | absent | given |
 * | absent | absent | given | absent | given | absent |
 * | absent | given | absent | absent | absent | absent |
 * | given | absent | absent | absent | given | given |
 * | given | given | given | absent | given | given |
 *
 * A given anchor is the position the reader opens at and the one a controlled
 * pair holds, so with an anchor and any handler both the chapter and the
 * spread stay where the anchor puts them.
 */

import type { EpubBook } from '@libraz/mejiro/epub';
import { EpubProject } from '@libraz/mejiro/epub';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MejiroReader,
  type MejiroReaderHandle,
  type MejiroReaderProps,
  type ReadingAnchor,
} from '../src/index.js';
import { measurableReaderSurface } from './helpers/fixtures.js';

let restoreSurface: () => void = () => {};
beforeEach(() => {
  restoreSurface = measurableReaderSurface();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  restoreSurface();
});

/** Two chapters of many spreads each. */
function longBook(): EpubBook {
  const chapter = (title: string) => ({
    title,
    paragraphs: Array.from({ length: 80 }, (_, i) => ({
      text: `段落${i}。`.repeat(80),
      inlineAnnotations: [],
    })),
  });
  return { title: 'Long', author: 'A', chapters: [chapter('一'), chapter('二')] };
}

/** One chapter of `pages` paragraphs, each filling exactly one page. */
function pagedBook(pages: number): EpubBook {
  return {
    title: 'Paged',
    chapters: [
      {
        title: 'Paged',
        paragraphs: Array.from({ length: pages }, (_, i) => ({
          text: `段落${i}。`.repeat(40),
          inlineAnnotations: [],
        })),
      },
    ],
  };
}

async function settle(step?: () => void): Promise<void> {
  await act(async () => {
    step?.();
    await vi.runAllTimersAsync();
  });
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  }
}

/** Whether `anchor` lies in the visible range of the reader. */
function visible(handle: MejiroReaderHandle, anchor: ReadingAnchor): boolean {
  const range = handle.getVisibleRange();
  if (!range || range.start.chapterIndex !== anchor.chapterIndex) return false;
  const cmp = (a: ReadingAnchor, b: ReadingAnchor) =>
    a.paragraphIndex - b.paragraphIndex || a.charIndex - b.charIndex;
  return cmp(range.start, anchor) <= 0 && cmp(anchor, range.end) < 0;
}

/** Page numbers printed on the pages shown, right page first. */
function shownPageNumbers(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('.mejiro-reader-page .mejiro-reader-page-header-num'),
    (el) => el.textContent ?? '',
  );
}

type Presence = 'absent' | 'given';
interface ModelRow {
  chapterIndex: Presence;
  onChapterIndexChange: Presence;
  spreadIndex: Presence;
  onSpreadIndexChange: Presence;
  anchor: Presence;
  onAnchorChange: Presence;
}

const g = 'given' as const;
const a = 'absent' as const;
const ROWS: readonly ModelRow[] = [
  {
    chapterIndex: a,
    onChapterIndexChange: a,
    spreadIndex: a,
    onSpreadIndexChange: g,
    anchor: a,
    onAnchorChange: g,
  },
  {
    chapterIndex: g,
    onChapterIndexChange: g,
    spreadIndex: g,
    onSpreadIndexChange: g,
    anchor: g,
    onAnchorChange: a,
  },
  {
    chapterIndex: g,
    onChapterIndexChange: a,
    spreadIndex: g,
    onSpreadIndexChange: a,
    anchor: a,
    onAnchorChange: g,
  },
  {
    chapterIndex: a,
    onChapterIndexChange: a,
    spreadIndex: g,
    onSpreadIndexChange: a,
    anchor: g,
    onAnchorChange: a,
  },
  {
    chapterIndex: a,
    onChapterIndexChange: g,
    spreadIndex: a,
    onSpreadIndexChange: a,
    anchor: a,
    onAnchorChange: a,
  },
  {
    chapterIndex: g,
    onChapterIndexChange: a,
    spreadIndex: a,
    onSpreadIndexChange: a,
    anchor: g,
    onAnchorChange: g,
  },
  {
    chapterIndex: g,
    onChapterIndexChange: g,
    spreadIndex: g,
    onSpreadIndexChange: a,
    anchor: g,
    onAnchorChange: g,
  },
];

/** A position deep in chapter 1, on a spread other than SPREAD_VALUE. */
const ANCHOR: ReadingAnchor = { chapterIndex: 1, paragraphIndex: 40, charIndex: 0 };
const CHAPTER_VALUE = 1;
const SPREAD_VALUE = 2;

describe('MejiroReader position props', () => {
  it.each(ROWS.map((row, i) => [i + 1, row] as const))(
    'model row %i: a pair follows the host only when its handler is given, and the anchor wins',
    async (_n, row) => {
      const handlers = {
        onChapterIndexChange: row.onChapterIndexChange === 'given' ? vi.fn() : undefined,
        onSpreadIndexChange: row.onSpreadIndexChange === 'given' ? vi.fn() : undefined,
        onAnchorChange: row.onAnchorChange === 'given' ? vi.fn() : undefined,
      };
      const props: Partial<MejiroReaderProps> = {
        ...(row.chapterIndex === 'given' ? { chapterIndex: CHAPTER_VALUE } : {}),
        ...(row.spreadIndex === 'given' ? { spreadIndex: SPREAD_VALUE } : {}),
        ...(row.anchor === 'given' ? { anchor: ANCHOR } : {}),
        ...handlers,
      };
      const ref = createRef<MejiroReaderHandle>();
      render(<MejiroReader ref={ref} epub={longBook()} {...props} />);
      await settle();
      const handle = () => ref.current as MejiroReaderHandle;

      const anchorGiven = row.anchor === 'given';
      const anyHandler = Object.values(handlers).some(Boolean);
      const anchorHolds = anchorGiven && anyHandler;
      const chapterHeld = Boolean(handlers.onChapterIndexChange) || anchorHolds;
      const spreadHeld = Boolean(handlers.onSpreadIndexChange) || anchorHolds;

      // Opening position: the anchor wins over the index values.
      const opened = handle().getSpreadPosition();
      if (anchorGiven) {
        expect(visible(handle(), ANCHOR)).toBe(true);
        expect(opened.spreadIndex).not.toBe(SPREAD_VALUE);
      } else {
        expect(opened.chapterIndex).toBe(row.chapterIndex === 'given' ? CHAPTER_VALUE : 0);
        expect(opened.spreadIndex).toBe(row.spreadIndex === 'given' ? SPREAD_VALUE : 0);
      }

      // A page turn the host does not follow.
      await settle(() => handle().next());
      const turned = handle().getSpreadPosition();
      expect(turned.spreadIndex).toBe(opened.spreadIndex + (spreadHeld ? 0 : 1));
      if (handlers.onSpreadIndexChange) {
        expect(handlers.onSpreadIndexChange).toHaveBeenCalledWith(opened.spreadIndex + 1);
      }
      if (handlers.onAnchorChange) expect(handlers.onAnchorChange).toHaveBeenCalled();

      // A chapter switch the host does not follow.
      const other = opened.chapterIndex === 1 ? 0 : 1;
      await settle(() => handle().goToChapter(other));
      expect(handle().getSpreadPosition().chapterIndex).toBe(
        chapterHeld ? opened.chapterIndex : other,
      );
      if (handlers.onChapterIndexChange) {
        expect(handlers.onChapterIndexChange).toHaveBeenCalledWith(other);
      }
    },
  );

  it('follows a host that mirrors onAnchorChange into anchor', async () => {
    const reports: ReadingAnchor[] = [];
    const ref = createRef<MejiroReaderHandle>();
    function Host() {
      const [anchor, setAnchor] = useState<ReadingAnchor>(ANCHOR);
      return (
        <MejiroReader
          ref={ref}
          epub={longBook()}
          anchor={anchor}
          onAnchorChange={(next) => {
            reports.push(next);
            setAnchor(next);
          }}
        />
      );
    }
    render(<Host />);
    await settle();
    const opened = ref.current?.getSpreadPosition().spreadIndex ?? -1;

    await settle(() => ref.current?.next());

    expect(reports).toHaveLength(1);
    expect(ref.current?.getSpreadPosition()).toMatchObject({
      chapterIndex: 1,
      spreadIndex: opened + 1,
    });
    expect(visible(ref.current as MejiroReaderHandle, reports[0])).toBe(true);
  });

  it('opens a single-page reader on the right page of spreadIndex and keeps the spread across its pages', async () => {
    const onSpreadIndexChange = vi.fn();
    const ref = createRef<MejiroReaderHandle>();
    const { container } = render(
      <MejiroReader
        ref={ref}
        epub={pagedBook(7)}
        spreadMode="single"
        spreadIndex={1}
        onSpreadIndexChange={onSpreadIndexChange}
      />,
    );
    await settle();
    expect(shownPageNumbers(container)).toEqual(['3']);

    await settle(() => ref.current?.next());

    expect(shownPageNumbers(container)).toEqual(['4']);
    expect(ref.current?.getSpreadPosition().spreadIndex).toBe(1);
    expect(onSpreadIndexChange).not.toHaveBeenCalled();
  });
});

describe('MejiroReader lifecycle events', () => {
  it('passes the chapter index to onChapterFinished and a context object to the bus', async () => {
    const onChapterFinished = vi.fn();
    const ref = createRef<MejiroReaderHandle>();
    render(<MejiroReader ref={ref} epub={pagedBook(4)} onChapterFinished={onChapterFinished} />);
    await settle();
    const bus: unknown[] = [];
    ref.current?.subscribe('spreadIndexChange', (event) => bus.push(event));
    ref.current?.subscribe('chapterFinished', (event) => bus.push(event));

    await settle(() => ref.current?.goToSpread(1));

    expect(onChapterFinished).toHaveBeenCalledWith(0);
    expect(bus).toEqual([{ chapterIndex: 0, spreadIndex: 1 }, { chapterIndex: 0 }]);
  });

  it('reports the spread position by layout spread, chapter, and counts', async () => {
    const ref = createRef<MejiroReaderHandle>();
    render(<MejiroReader ref={ref} epub={pagedBook(5)} spreadMode="single" />);
    await settle();
    await settle(() => ref.current?.goToSpread(2));

    expect(ref.current?.getSpreadPosition()).toEqual({
      chapterIndex: 0,
      spreadIndex: 2,
      spreadCount: 3,
      pageCount: 5,
    });
  });
});

describe('MejiroReader defaults', () => {
  it('shows only the pages, the settings panel and the page indicator by default', async () => {
    const { container } = render(<MejiroReader epub={longBook()} />);
    await settle();

    expect(container.querySelector('.mejiro-reader-header')).toBeNull();
    expect(container.querySelector('.mejiro-reader-stats')).toBeNull();
    expect(container.querySelector('.mejiro-reader-page-indicator')).not.toBeNull();
    expect(container.querySelector('.mejiro-reader-spread')).not.toBeNull();
  });

  it('turns pages on arrow keys pressed inside the reader only', async () => {
    const ref = createRef<MejiroReaderHandle>();
    const { container } = render(<MejiroReader ref={ref} epub={longBook()} />);
    await settle();
    const root = container.querySelector('.mejiro-reader') as HTMLElement;
    expect(root.tabIndex).toBe(0);

    await settle(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(ref.current?.getSpreadPosition().spreadIndex).toBe(0);

    await settle(() => {
      fireEvent.keyDown(root, { key: 'ArrowLeft' });
    });
    expect(ref.current?.getSpreadPosition().spreadIndex).toBe(1);
  });
});

describe('MejiroReader URL loading', () => {
  it('reads a Uint8Array view from fetchEpub and aborts its signal on unmount', async () => {
    vi.useRealTimers();
    const exported = await new EpubProject({
      metadata: { title: '甲' },
      chapters: [{ title: '一', body: '本文。' }],
      includeTitlePage: false,
    }).export();
    const padded = new Uint8Array(exported.byteLength + 3);
    padded.set(exported, 3);
    const signals: AbortSignal[] = [];
    const onLoad = vi.fn();
    const { unmount } = render(
      <MejiroReader
        epubUrl="/a.epub"
        onLoad={onLoad}
        fetchEpub={async (_url, options) => {
          signals.push(options.signal);
          return padded.subarray(3);
        }}
      />,
    );
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect(onLoad.mock.calls[0][0].title).toBe('甲');

    const pending: AbortSignal[] = [];
    const second = render(
      <MejiroReader
        epubUrl="/b.epub"
        fetchEpub={(_url, options) => {
          pending.push(options.signal);
          return new Promise<Uint8Array>(() => {});
        }}
      />,
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    second.unmount();
    unmount();

    expect(signals[0].aborted).toBe(false);
    expect(pending[0].aborted).toBe(true);
  });
});
