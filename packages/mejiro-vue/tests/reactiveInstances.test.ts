// @vitest-environment happy-dom

import { type ChapterLayout, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, isProxy, reactive, ref } from 'vue';
import { MejiroReader } from '../src/MejiroReader.js';
import { MejiroSpread } from '../src/MejiroSpread.js';
import { useChapterLayout } from '../src/useChapterLayout.js';
import { useMejiroBook } from '../src/useMejiroBook.js';
import { useSpread } from '../src/useSpread.js';
import { fakeEpub, giveElementsAClientBox, withSetup } from './helpers/fixtures.js';

giveElementsAClientBox();

/** A surface element with a measurable box, as a mounted reader has. */
function sizedSurface(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 480 });
  return el;
}

/** Lays out chapter 0 of `epub` with whatever `book` yields, reporting failures. */
function layOutWith(book: Parameters<typeof useChapterLayout>[0], epub: EpubBook) {
  const onError = vi.fn();
  const ctx = useChapterLayout(book, {
    epub,
    chapterIndex: 0,
    surface: sizedSurface(),
    enableResize: false,
    onError,
  });
  return { ctx, onError };
}

describe('Vue binding with core instances inside reactive state', () => {
  it('keeps the book useMejiroBook returns raw inside reactive state', async () => {
    const { result, unmount } = withSetup(() => {
      const { book } = useMejiroBook({ fontFamily: 'serif', fontSize: 16 });
      const state = reactive({ book });
      const held = ref(book);
      return { book, state, held, ...layOutWith(() => state.book, fakeEpub()) };
    });

    expect(isProxy(result.state.book)).toBe(false);
    expect(result.held.value).toBe(result.book);
    await vi.waitFor(() => expect(result.ctx.layout.value).not.toBeNull());
    expect(result.onError).not.toHaveBeenCalled();
    unmount();
  });

  it('lays out with a constructed book held in reactive()', async () => {
    const { result, unmount } = withSetup(() => {
      const state = reactive({ book: new MejiroBook({ fontFamily: 'serif', fontSize: 16 }) });
      return { state, ...layOutWith(() => state.book, fakeEpub()) };
    });

    expect(isProxy(result.state.book)).toBe(true);
    await vi.waitFor(() => expect(result.ctx.layout.value).not.toBeNull());
    expect(result.onError).not.toHaveBeenCalled();
    expect(isProxy(result.ctx.layout.value)).toBe(false);
    unmount();
  });

  it('lays out with a constructed book held in a deep ref()', async () => {
    const { result, unmount } = withSetup(() => {
      const book = ref(new MejiroBook({ fontFamily: 'serif', fontSize: 16 }));
      return { book, ...layOutWith(book, reactive(fakeEpub())) };
    });

    expect(isProxy(result.book.value)).toBe(true);
    await vi.waitFor(() => expect(result.ctx.layout.value).not.toBeNull());
    expect(result.onError).not.toHaveBeenCalled();
    unmount();
  });

  it('keeps the layouts it returns raw inside reactive state', async () => {
    const { result, unmount } = withSetup(() => {
      const ctx = layOutWith(new MejiroBook({ fontFamily: 'serif', fontSize: 16 }), fakeEpub());
      const state = reactive<{ layout: ChapterLayout | null }>({ layout: null });
      return { state, ...ctx };
    });

    await vi.waitFor(() => expect(result.ctx.layout.value).not.toBeNull());
    result.state.layout = result.ctx.layout.value;
    expect(result.state.layout).toBe(result.ctx.layout.value);
    unmount();
  });

  it('renders MejiroSpread from a core-built layout held in reactive state', async () => {
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    book.fitPageSize(sizedSurface());
    const built = await book.layoutChapter(fakeEpub().chapters[0]);
    const state = reactive({ layout: built });
    expect(isProxy(state.layout)).toBe(true);
    const Host = defineComponent({
      setup() {
        const { spread } = useSpread(() => state.layout, { enableKeyboard: false });
        return () =>
          spread.value ? h(MejiroSpread, { spread: spread.value, layout: state.layout }) : null;
      },
    });

    const { container } = render(Host);
    await vi.waitFor(() => expect(container.querySelectorAll('.mejiro-page').length).toBe(2));
  });

  it('lays out MejiroReader from an EPUB held in reactive state', async () => {
    const onError = vi.fn();
    const Host = defineComponent({
      setup() {
        const state = reactive({ epub: fakeEpub() });
        return () => h(MejiroReader, { epub: state.epub, onError });
      },
    });

    const { container } = render(Host);
    await vi.waitFor(() => expect(container.querySelector('.mejiro-reader-spread')).not.toBeNull());
    expect(onError).not.toHaveBeenCalled();
  });
});
