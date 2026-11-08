// @vitest-environment happy-dom

/*
 * Controlled detection of the MejiroReader position props — pairwise model
 * (strength 2, seed 1), 7 rows covering 60/60 tuples:
 *
 *   Model: chapterIndex, onChapterIndexChange, spreadIndex, onSpreadIndexChange,
 *          anchor, onAnchorChange — each absent | given.
 *   Expected per row: a pair is controlled iff its handler is given (Vue: the
 *   vnode carries onUpdate:xxx); when anchor and spreadIndex are both
 *   controlled/given, anchor wins.
 *
 *   | chapterIndex | onChapterIndexChange | spreadIndex | onSpreadIndexChange | anchor | onAnchorChange |
 *   |---|---|---|---|---|---|
 *   | absent | absent | absent | given  | absent | given  |
 *   | given  | given  | given  | given  | given  | absent |
 *   | given  | absent | given  | absent | absent | given  |
 *   | absent | absent | given  | absent | given  | absent |
 *   | absent | given  | absent | absent | absent | absent |
 *   | given  | absent | absent | absent | given  | given  |
 *   | given  | given  | given  | absent | given  | given  |
 *
 * A given anchor decides the position, so the chapter and spread pairs are not
 * read while it is set; the handlers in the rows decline every change.
 */

import type { ReadingAnchor } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { render } from '@testing-library/vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroReader, type MejiroReaderHandle } from '../src/index.js';
import { giveElementsAClientBox } from './helpers/fixtures.js';

giveElementsAClientBox();

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Two chapters, each long enough for several spreads at the minimum page size. */
function twoLongChapters(): EpubBook {
  const chapter = (title: string) => ({
    title,
    paragraphs: Array.from({ length: 60 }, (_, i) => ({
      text: `${title}段落${i}。`.repeat(40),
      inlineAnnotations: [],
    })),
  });
  return { title: 'Book', author: 'A', chapters: [chapter('一'), chapter('二')] };
}

const EPUB = twoLongChapters();

/** Paragraph of chapter 1 the given anchor points at; it sits several spreads in. */
const ANCHOR: ReadingAnchor = { chapterIndex: 1, paragraphIndex: 20, charIndex: 0 };

async function settle(step?: () => void): Promise<void> {
  step?.();
  for (let i = 0; i < 3; i++) {
    await vi.runAllTimersAsync();
    await nextTick();
  }
}

/** Mounts a reader with `props` and returns its handle. */
function renderReader(props: Record<string, unknown>): {
  handle: () => MejiroReaderHandle;
  container: Element;
  unmount: () => void;
} {
  const reader = ref<MejiroReaderHandle | null>(null);
  const { container, unmount } = render(
    defineComponent({ setup: () => () => h(MejiroReader, { ref: reader, ...props }) }),
  );
  return { handle: () => reader.value as MejiroReaderHandle, container, unmount };
}

/** Layout spread the anchor lands on, read from an uncontrolled reader. */
async function anchorSpread(): Promise<number> {
  const { handle, unmount } = renderReader({ epub: EPUB });
  await settle();
  await settle(() => void handle().goToAnchor(ANCHOR));
  const spread = handle().getSpreadPosition().spreadIndex;
  unmount();
  return spread;
}

type Presence = 'absent' | 'given';

/** One row of the pairwise model. */
interface ControlRow {
  chapterIndex: Presence;
  onChapterIndexChange: Presence;
  spreadIndex: Presence;
  onSpreadIndexChange: Presence;
  anchor: Presence;
  onAnchorChange: Presence;
}

const ROWS: ControlRow[] = (
  [
    ['absent', 'absent', 'absent', 'given', 'absent', 'given'],
    ['given', 'given', 'given', 'given', 'given', 'absent'],
    ['given', 'absent', 'given', 'absent', 'absent', 'given'],
    ['absent', 'absent', 'given', 'absent', 'given', 'absent'],
    ['absent', 'given', 'absent', 'absent', 'absent', 'absent'],
    ['given', 'absent', 'absent', 'absent', 'given', 'given'],
    ['given', 'given', 'given', 'absent', 'given', 'given'],
  ] as const
).map(
  ([
    chapterIndex,
    onChapterIndexChange,
    spreadIndex,
    onSpreadIndexChange,
    anchor,
    onAnchorChange,
  ]) => ({
    chapterIndex,
    onChapterIndexChange,
    spreadIndex,
    onSpreadIndexChange,
    anchor,
    onAnchorChange,
  }),
);

describe('MejiroReader (Vue) — controlled position props', () => {
  it.each(ROWS)(
    'follows the pairwise row %o: only pairs with a handler hold the position, the anchor winning',
    async (row) => {
      vi.useFakeTimers();
      const atAnchor = await anchorSpread();
      expect(atAnchor).toBeGreaterThan(1);

      const onChapterIndexChange = vi.fn();
      const onSpreadIndexChange = vi.fn();
      const onAnchorChange = vi.fn();
      const props: Record<string, unknown> = { epub: EPUB };
      if (row.chapterIndex === 'given') props.chapterIndex = 1;
      if (row.onChapterIndexChange === 'given')
        props['onUpdate:chapterIndex'] = onChapterIndexChange;
      if (row.spreadIndex === 'given') props.spreadIndex = 1;
      if (row.onSpreadIndexChange === 'given') props['onUpdate:spreadIndex'] = onSpreadIndexChange;
      if (row.anchor === 'given') props.anchor = ANCHOR;
      if (row.onAnchorChange === 'given') props['onUpdate:anchor'] = onAnchorChange;
      const { handle } = renderReader(props);
      await settle();

      const anchorGiven = row.anchor === 'given';
      const startChapter = anchorGiven ? 1 : row.chapterIndex === 'given' ? 1 : 0;
      const startSpread = anchorGiven ? atAnchor : row.spreadIndex === 'given' ? 1 : 0;
      expect(handle().getSpreadPosition()).toMatchObject({
        chapterIndex: startChapter,
        spreadIndex: startSpread,
      });

      // Page navigation is held by the anchor pair while an anchor is set, else by the spread pair.
      const spreadHeld = anchorGiven
        ? row.onAnchorChange === 'given'
        : row.onSpreadIndexChange === 'given';
      await settle(() => handle().next());
      expect(handle().getSpreadPosition().spreadIndex).toBe(
        spreadHeld ? startSpread : startSpread + 1,
      );
      if (spreadHeld && !anchorGiven) expect(onSpreadIndexChange).toHaveBeenCalledWith(1);
      if (spreadHeld && anchorGiven) {
        expect(onAnchorChange).toHaveBeenCalledWith(
          expect.objectContaining({ chapterIndex: startChapter }),
        );
      }

      // Chapter navigation is held by the anchor pair while an anchor is set, else by the chapter pair.
      const chapterHeld = anchorGiven
        ? row.onAnchorChange === 'given'
        : row.onChapterIndexChange === 'given';
      const otherChapter = 1 - startChapter;
      await settle(() => handle().goToChapter(otherChapter));
      expect(handle().getSpreadPosition().chapterIndex).toBe(
        chapterHeld ? startChapter : otherChapter,
      );
      if (row.onChapterIndexChange === 'given') {
        expect(onChapterIndexChange).toHaveBeenCalledWith(otherChapter);
      }
      if (chapterHeld && anchorGiven) {
        expect(onAnchorChange).toHaveBeenLastCalledWith({
          chapterIndex: otherChapter,
          paragraphIndex: 0,
          charIndex: 0,
        });
      }
    },
  );

  it('binds v-model:chapter-index and v-model:spread-index to a host that mirrors them', async () => {
    vi.useFakeTimers();
    const chapterIndex = ref(0);
    const spreadIndex = ref(0);
    const reader = ref<MejiroReaderHandle | null>(null);
    render(
      defineComponent({
        setup: () => () =>
          h(MejiroReader, {
            ref: reader,
            epub: EPUB,
            chapterIndex: chapterIndex.value,
            'onUpdate:chapterIndex': (next: number) => {
              chapterIndex.value = next;
            },
            spreadIndex: spreadIndex.value,
            'onUpdate:spreadIndex': (next: number) => {
              spreadIndex.value = next;
            },
          }),
      }),
    );
    await settle();

    await settle(() => reader.value?.next());
    expect(spreadIndex.value).toBe(1);
    expect(reader.value?.getSpreadPosition().spreadIndex).toBe(1);

    await settle(() => reader.value?.goToChapter(1));
    expect(chapterIndex.value).toBe(1);
    expect(spreadIndex.value).toBe(0);
    expect(reader.value?.getSpreadPosition()).toMatchObject({ chapterIndex: 1, spreadIndex: 0 });

    await settle(() => {
      spreadIndex.value = 2;
    });
    expect(reader.value?.getSpreadPosition().spreadIndex).toBe(2);
  });

  it('declares update events for the position and no notification duplicates', () => {
    const emits = Object.keys(MejiroReader.emits ?? {});
    expect(emits).toEqual(
      expect.arrayContaining(['update:chapterIndex', 'update:spreadIndex', 'update:anchor']),
    );
    for (const removed of [
      'chapter-change',
      'spread-change',
      'spread-idx-change',
      'chapter-completed',
    ]) {
      expect(emits).not.toContain(removed);
    }
  });
});

describe('MejiroReader (Vue) — anchor binding', () => {
  it('starts at an anchor given without a listener and turns pages on its own', async () => {
    vi.useFakeTimers();
    const atAnchor = await anchorSpread();
    const { handle } = renderReader({ epub: EPUB, anchor: ANCHOR });
    await settle();
    expect(handle().getSpreadPosition()).toMatchObject({ chapterIndex: 1, spreadIndex: atAnchor });
    await settle(() => handle().next());
    expect(handle().getSpreadPosition().spreadIndex).toBe(atAnchor + 1);
  });

  it('reports the first page now shown through v-model:anchor and follows the host', async () => {
    vi.useFakeTimers();
    const atAnchor = await anchorSpread();
    const anchor = ref<ReadingAnchor | null>(ANCHOR);
    const reports: ReadingAnchor[] = [];
    const reader = ref<MejiroReaderHandle | null>(null);
    render(
      defineComponent({
        setup: () => () =>
          h(MejiroReader, {
            ref: reader,
            epub: EPUB,
            anchor: anchor.value,
            'onUpdate:anchor': (next: ReadingAnchor) => {
              reports.push(next);
              anchor.value = next;
            },
          }),
      }),
    );
    await settle();
    expect(reports).toEqual([]);

    await settle(() => reader.value?.next());
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(reader.value?.getAnchor());
    expect(reader.value?.getSpreadPosition().spreadIndex).toBe(atAnchor + 1);

    await settle(() => {
      anchor.value = { chapterIndex: 0, paragraphIndex: 0, charIndex: 0 };
    });
    expect(reader.value?.getSpreadPosition()).toMatchObject({ chapterIndex: 0, spreadIndex: 0 });
  });
});

describe('MejiroReader (Vue) — position prop values', () => {
  it('shows the right page of the spread a spread index names in single-page mode', async () => {
    vi.useFakeTimers();
    const onSpreadIndexChange = vi.fn();
    const spreadIndex = ref(1);
    const { container, handle } = renderReader({
      epub: EPUB,
      spreadMode: 'single',
      get spreadIndex() {
        return spreadIndex.value;
      },
      'onUpdate:spreadIndex': (next: number) => {
        onSpreadIndexChange(next);
        spreadIndex.value = next;
      },
    });
    await settle();
    expect(container.querySelector('.mejiro-reader-page--right')).not.toBeNull();
    expect(container.querySelector('.mejiro-reader-page--left')).toBeNull();

    // Turning to the left page stays inside spread 1, so nothing is reported.
    await settle(() => handle().next());
    expect(container.querySelector('.mejiro-reader-page--left')).not.toBeNull();
    expect(handle().getSpreadPosition().spreadIndex).toBe(1);
    expect(onSpreadIndexChange).not.toHaveBeenCalled();

    await settle(() => handle().next());
    expect(onSpreadIndexChange).toHaveBeenCalledWith(2);
  });

  it.each([
    [-3, 0],
    [1.7, 1],
    [Number.NaN, 0],
    [10_000, 'last'],
  ] as const)('reads a spread index of %s as %s', async (value, expected) => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handle } = renderReader({ epub: EPUB, spreadIndex: value });
    await settle();
    const position = handle().getSpreadPosition();
    expect(position.spreadIndex).toBe(expected === 'last' ? position.spreadCount - 1 : expected);
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects a spread index that is not an integer in goToSpread', async () => {
    vi.useFakeTimers();
    const { handle } = renderReader({ epub: EPUB });
    await settle();
    expect(() => handle().goToSpread(1.5)).toThrow(RangeError);
    expect(() => handle().goToSpread(Number.NaN)).toThrow(RangeError);
  });
});

describe('MejiroReader (Vue) — position and lifecycle names', () => {
  it('reports SpreadPosition through getSpreadPosition', async () => {
    vi.useFakeTimers();
    const { handle } = renderReader({ epub: EPUB, spreadMode: 'single' });
    await settle();
    const position = handle().getSpreadPosition();
    expect(Object.keys(position).sort()).toEqual([
      'chapterIndex',
      'pageCount',
      'spreadCount',
      'spreadIndex',
    ]);
    expect(position.spreadCount).toBe(Math.ceil(position.pageCount / 2));
    expectTypeErrors(
      `import type { MejiroReaderHandle, SpreadPosition } from '@libraz/mejiro-vue';
declare const handle: MejiroReaderHandle;
const position: SpreadPosition = handle.getSpreadPosition();
void position;
handle.getReadingPosition();`,
      { fails: ['handle.getReadingPosition'] },
    );
  });

  it('names the chapter-end event chapter-finished and the bus payloads with indices', async () => {
    vi.useFakeTimers();
    const finished = vi.fn();
    const { handle } = renderReader({ epub: EPUB, 'onChapter-finished': finished });
    await settle();
    const bus: string[] = [];
    handle().subscribe('spreadIndexChange', (p) =>
      bus.push(`spread:${p.chapterIndex}:${p.spreadIndex}`),
    );
    handle().subscribe('chapterFinished', (p) => bus.push(`finished:${p.chapterIndex}`));
    const last = handle().getSpreadPosition().spreadCount - 1;

    await settle(() => handle().goToSpread(last));

    expect(bus).toEqual([`spread:0:${last}`, 'finished:0']);
    expect(finished).toHaveBeenCalledWith(0);
  });

  it('types the payload of every reader event', () => {
    expectTypeErrors(
      `import type { ReadingAnchor } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import type { MejiroReaderProps } from '@libraz/mejiro-vue';
const ok: MejiroReaderProps = {
  onLoad: (epub: EpubBook) => void epub,
  onError: (error: Error) => void error,
  'onUpdate:chapterIndex': (chapterIndex: number) => void chapterIndex,
  'onUpdate:spreadIndex': (spreadIndex: number) => void spreadIndex,
  'onUpdate:anchor': (anchor: ReadingAnchor) => void anchor,
  'onPage-read': (anchor: ReadingAnchor, dwellMs: number) => void [anchor, dwellMs],
  'onChapter-finished': (chapterIndex: number) => void chapterIndex,
};
void ok;
const p1: MejiroReaderProps = { onLoad: (epub: string) => void epub };
const p2: MejiroReaderProps = { 'onUpdate:spreadIndex': (index: string) => void index };
const p3: MejiroReaderProps = { 'onPage-read': (anchor: number) => void anchor };`,
      { fails: ['const p1', 'const p2', 'const p3'] },
    );
  });
});

describe('MejiroReader (Vue) — default chrome and keyboard', () => {
  it('shows only the book, the settings panel and the page indicator for the shortest call', async () => {
    vi.useFakeTimers();
    const { container } = renderReader({ epub: EPUB });
    await settle();
    expect(container.querySelector('.mejiro-reader-header')).toBeNull();
    expect(container.querySelector('.mejiro-reader-stats')).toBeNull();
    expect(container.querySelector('.mejiro-reader-page-indicator')).not.toBeNull();
    expect(container.querySelector('.mejiro-reader-settings-panel')).not.toBeNull();
    expect(container.querySelector('.mejiro-reader-spread')).not.toBeNull();
  });

  it('turns pages only from keys pressed on its own root, so two readers do not collide', async () => {
    vi.useFakeTimers();
    const first = renderReader({ epub: EPUB });
    const second = renderReader({ epub: EPUB });
    await settle();
    const roots = document.querySelectorAll<HTMLElement>('.mejiro-reader');
    const firstRoot = roots[roots.length - 2];
    expect(firstRoot.tabIndex).toBe(0);

    firstRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await settle();
    expect(first.handle().getSpreadPosition().spreadIndex).toBe(1);
    expect(second.handle().getSpreadPosition().spreadIndex).toBe(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await settle();
    expect(first.handle().getSpreadPosition().spreadIndex).toBe(1);
    expect(second.handle().getSpreadPosition().spreadIndex).toBe(0);
  });

  it("removes the chapter navigation with chapterNavMode='none'", () => {
    const { container } = renderReader({ epub: EPUB, title: 'T', chapterNavMode: 'none' });
    expect(container.querySelector('.mejiro-reader-chapter-nav')).toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-panel')).toBeNull();
  });

  it('takes show* chrome props and drops the enable* and bare ones', () => {
    expectTypeErrors(
      `import type { MejiroReaderProps } from '@libraz/mejiro-vue';
const ok: MejiroReaderProps = {
  showSettings: false,
  showStats: true,
  showPageIndicator: false,
  showImageOverlayButton: true,
  chapterNavMode: 'none',
  enableKeyboard: false,
  enableDropZone: true,
  enableSurfaceTap: false,
};
void ok;
const p1: MejiroReaderProps = { bare: true };
const p2: MejiroReaderProps = { enableHeader: false };
const p3: MejiroReaderProps = { enableStats: false };
const p4: MejiroReaderProps = { enableSettings: false };
const p5: MejiroReaderProps = { enablePageIndicator: false };
const p6: MejiroReaderProps = { enableImageOverlay: true };
const p7: MejiroReaderProps = { enableChapterNav: false };`,
      {
        fails: ['const p1', 'const p2', 'const p3', 'const p4', 'const p5', 'const p6', 'const p7'],
      },
    );
  });
});

describe('MejiroReader (Vue) — props types', () => {
  it('exports one props type per book source, with the sources exclusive', () => {
    expectTypeErrors(
      `import type { ManuscriptChapter } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import type {
  MejiroReaderCommonProps,
  MejiroReaderManuscriptProps,
  MejiroReaderParsedProps,
  MejiroReaderPickerProps,
  MejiroReaderUrlProps,
} from '@libraz/mejiro-vue';
declare const epub: EpubBook;
declare const chapters: readonly ManuscriptChapter[];
const parsed: MejiroReaderParsedProps = { epub };
const url: MejiroReaderUrlProps = { epubUrl: '/book.epub' };
const picker: MejiroReaderPickerProps = { enableDropZone: true };
const manuscript: MejiroReaderManuscriptProps = { manuscript: chapters, dialect: 'narou' };
const common: MejiroReaderCommonProps = { chapterIndex: 1, spreadIndex: 2, anchor: null };
void [parsed, url, picker, manuscript, common];
const p1: MejiroReaderParsedProps = { epub, epubUrl: '/book.epub' };
const p2: MejiroReaderUrlProps = { epubUrl: '/book.epub', manuscript: chapters };
const p3: MejiroReaderManuscriptProps = { manuscript: chapters, epub };
const p4: MejiroReaderCommonProps = { chapter: 1 };
const p5: MejiroReaderCommonProps = { spreadIdx: 1 };
const p6: MejiroReaderCommonProps = { fallbackHtml: '<p></p>' };`,
      { fails: ['const p1', 'const p2', 'const p3', 'const p4', 'const p5', 'const p6'] },
    );
  });

  it('shows the epub without logging when epub and epubUrl are both given', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onLoad = vi.fn();
    renderReader({ epub: EPUB, epubUrl: '/other.epub', onLoad });
    await settle();
    expect(warn).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onLoad).toHaveBeenCalledWith(EPUB);
  });

  it('takes partial BookOptions, readonly lists and the shared annotation type', () => {
    expectTypeErrors(
      `import type { FontChoice } from '@libraz/mejiro';
import type { MejiroReaderProps, ReaderAnnotation } from '@libraz/mejiro-vue';
const fonts: readonly FontChoice[] = [{ value: 'serif', label: 'Serif' }] as const;
const annotations: readonly ReaderAnnotation[] = [
  { chapterIndex: 0, start: { paragraphIndex: 0, charIndex: 0 }, end: { paragraphIndex: 0, charIndex: 2 } },
];
const ok: MejiroReaderProps = { options: { kinsoku: 'loose', fontSize: 18 }, fonts, annotations };
void ok;
const p1: MejiroReaderProps = { options: { mode: 'loose' } };
const p2: MejiroReaderProps = { annotations: [{ chapter: 0, start: { paragraphIndex: 0, charIndex: 0 }, end: { paragraphIndex: 0, charIndex: 1 } }] };`,
      { fails: ['const p1', 'const p2'] },
    );
  });

  it('resolves the auto spread mode itself and hands the spread a resolved one', async () => {
    vi.useFakeTimers();
    const { container } = renderReader({ epub: EPUB, spreadMode: 'single' });
    await settle();
    expect(container.querySelector('.mejiro-reader-spread--single')).not.toBeNull();
    expectTypeErrors(
      `import type { MejiroReaderProps, MejiroSpreadMode, ResolvedSpreadMode } from '@libraz/mejiro-vue';
const mode: MejiroSpreadMode = 'auto';
const ok: MejiroReaderProps = { spreadMode: mode };
void ok;
const resolved: ResolvedSpreadMode = 'auto';`,
      { fails: ['const resolved'] },
    );
  });
});

describe('MejiroReader (Vue) — fetchEpub', () => {
  it('hands fetchEpub the URL and a signal, takes Uint8Array bytes, and aborts it on a new URL', async () => {
    const signals: AbortSignal[] = [];
    const fetchEpub = vi.fn((_url: string, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return new Promise<Uint8Array>(() => {});
    });
    const url = ref('/a.epub');
    render(
      defineComponent({
        setup: () => () => h(MejiroReader, { epubUrl: url.value, fetchEpub }),
      }),
    );
    await flushPromises();
    expect(fetchEpub).toHaveBeenCalledWith('/a.epub', { signal: expect.any(AbortSignal) });

    url.value = '/b.epub';
    await flushPromises();
    expect(fetchEpub).toHaveBeenLastCalledWith('/b.epub', { signal: expect.any(AbortSignal) });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expectTypeErrors(
      `import type { MejiroReaderProps } from '@libraz/mejiro-vue';
const ok: MejiroReaderProps = {
  fetchEpub: async (url: string, { signal }: { signal: AbortSignal }) =>
    new Uint8Array(await (await fetch(url, { signal })).arrayBuffer()),
};
void ok;
const p1: MejiroReaderProps = { fetchEpub: async (url: string) => url };`,
      { fails: ['const p1'] },
    );
  });

  it('aborts the fetch in flight when the reader unmounts', async () => {
    let signal: AbortSignal | undefined;
    const wrapper = mount(MejiroReader, {
      props: {
        epubUrl: '/a.epub',
        fetchEpub: (_url: string, options: { signal: AbortSignal }) => {
          signal = options.signal;
          return new Promise<Uint8Array>(() => {});
        },
      },
    });
    await flushPromises();
    expect(signal?.aborted).toBe(false);
    wrapper.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
