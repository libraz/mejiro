// @vitest-environment happy-dom

import { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { render, waitFor } from '@testing-library/vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroReader, type MejiroReaderHandle } from '../src/MejiroReader.js';
import { MejiroScrollView } from '../src/MejiroScrollView.js';

function fakeEpub(): EpubBook {
  return {
    title: 'Test Book',
    author: 'Author',
    chapters: [
      {
        title: 'Chapter 1',
        paragraphs: [{ text: 'a', inlineAnnotations: [] }],
      },
      {
        title: 'Chapter 2',
        paragraphs: [{ text: 'b', inlineAnnotations: [] }],
      },
    ],
  };
}

function longEpub(): EpubBook {
  return {
    title: 'Long Book',
    author: 'Author',
    chapters: [
      {
        title: 'Long Chapter',
        paragraphs: Array.from({ length: 80 }, (_, i) => ({
          text: `段落${i}。`.repeat(80),
          inlineAnnotations: [],
        })),
      },
    ],
  };
}

describe('MejiroReader (Vue) — default props', () => {
  it('does not render the drop zone by default (SaaS-safe default)', () => {
    const { container } = render(MejiroReader);
    expect(container.querySelector('.mejiro-reader-drop-zone')).toBeNull();
  });

  it('does not render the Image overlay button by default', () => {
    const { container } = render(MejiroReader, { props: { epub: fakeEpub() } });
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
        b.textContent?.includes('Image'),
      ),
    ).toBe(false);
  });

  it('renders the default header logo with title and subtitle', () => {
    const { container } = render(MejiroReader);
    expect(container.querySelector('.mejiro-reader-logo-mark')?.textContent).toBe('mejiro');
    expect(container.querySelector('.mejiro-reader-logo-sub')?.textContent).toBe('Vertical Reader');
  });

  it('reflects custom title and subtitle props', () => {
    const { container } = render(MejiroReader, {
      props: { title: 'My Lib', subtitle: 'Reader' },
    });
    expect(container.querySelector('.mejiro-reader-logo-mark')?.textContent).toBe('My Lib');
    expect(container.querySelector('.mejiro-reader-logo-sub')?.textContent).toBe('Reader');
  });

  it('uses the i18n provider catalog when locale props are omitted', () => {
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { locale: 'ja' }, () => h(MejiroReader, { enableDropZone: true }));
      },
    });

    const { container } = render(Wrapped);
    expect(container.querySelector('.mejiro-reader-logo-sub')?.textContent).toBe(
      jaMessages.logoSubtitle,
    );
    expect(container.textContent).toContain(jaMessages.openButton);
    expect(container.textContent).toContain(jaMessages.dropZoneTitle);
  });
});

describe('MejiroReader (Vue) — enable* toggles', () => {
  it('enableHeader=false hides the header bar', () => {
    const { container } = render(MejiroReader, { props: { enableHeader: false } });
    expect(container.querySelector('.mejiro-reader-header')).toBeNull();
  });

  it('enableDropZone=true exposes the drop zone when no EPUB is loaded', () => {
    const { container } = render(MejiroReader, { props: { enableDropZone: true } });
    expect(container.querySelector('.mejiro-reader-drop-zone')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some(
        (b) => b.textContent?.trim() === 'Open',
      ),
    ).toBe(true);
  });

  it('enableDropZone=true hides the drop zone once an EPUB is supplied', () => {
    const { container } = render(MejiroReader, {
      props: { enableDropZone: true, epub: fakeEpub() },
    });
    expect(container.querySelector('.mejiro-reader-drop-zone')).toBeNull();
  });

  it('enableChapterNav=false hides the chapter selector', () => {
    const { container } = render(MejiroReader, {
      props: { enableChapterNav: false, epub: fakeEpub() },
    });
    expect(container.querySelector('.mejiro-reader-chapter-nav')).toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-panel')).toBeNull();
  });

  it('enableChapterNav=true (default) renders the chapter select', () => {
    const { container } = render(MejiroReader, { props: { epub: fakeEpub() } });
    expect(container.querySelector('.mejiro-reader-chapter-nav')).not.toBeNull();
  });

  it('enableSettings=false hides the settings panel and toggle', () => {
    const { container } = render(MejiroReader, { props: { enableSettings: false } });
    expect(container.querySelector('.mejiro-reader-settings-panel')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
        b.textContent?.includes('Settings'),
      ),
    ).toBe(false);
  });

  it('enableSettings=true (default) renders the settings panel', () => {
    const { container } = render(MejiroReader);
    expect(container.querySelector('.mejiro-reader-settings-panel')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
        b.textContent?.includes('Settings'),
      ),
    ).toBe(true);
  });

  it('settings slot replaces the controls while keeping the panel chrome', () => {
    const { container } = render(MejiroReader, {
      props: { epub: fakeEpub() },
      slots: { settings: () => h('div', { class: 'custom-settings' }, 'Custom') },
    });
    const panel = container.querySelector('.mejiro-reader-settings-panel');
    expect(panel).not.toBeNull();
    expect(
      panel?.querySelector(
        '.mejiro-reader-settings-inner > .mejiro-reader-settings-content > .custom-settings',
      )?.textContent,
    ).toBe('Custom');
    // Built-in controls are gone.
    expect(container.querySelector('#mejiro-reader-font-size')).toBeNull();
  });

  it('settings slot receives a live slot (settings, update, open, toggle)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: capturing the runtime slot payload
    let captured: any = null;
    render(MejiroReader, {
      props: { epub: fakeEpub() },
      slots: {
        settings: (slotProps: unknown) => {
          captured = slotProps;
          return h('div');
        },
      },
    });
    expect(captured).not.toBeNull();
    expect(typeof captured.settings.fontSize).toBe('number');
    expect(typeof captured.update).toBe('function');
    expect(typeof captured.toggle).toBe('function');
    expect(captured.open).toBe(false);
  });

  it('keeps runtime option changes when the parent re-renders with an equal options literal', async () => {
    const setOptionsSpy = vi.spyOn(MejiroBook.prototype, 'setOptions');
    const wrapper = mount(MejiroReader, {
      props: {
        epub: fakeEpub(),
        options: { fontFamily: 'serif', fontSize: 16 },
        enableStats: true,
      },
    });
    const reader = wrapper.vm as unknown as MejiroReaderHandle;

    await reader.setOptions({ fontSize: 20 });
    await nextTick();
    expect(wrapper.find('.mejiro-reader-stats').text()).toContain('serif 20px');
    const callsBeforeRerender = setOptionsSpy.mock.calls.length;

    // A new object with the same values — the shape a parent re-render produces.
    await wrapper.setProps({ options: { fontFamily: 'serif', fontSize: 16 } });

    expect(setOptionsSpy.mock.calls.length).toBe(callsBeforeRerender);
    expect(wrapper.find('.mejiro-reader-stats').text()).toContain('serif 20px');
    const book = setOptionsSpy.mock.contexts[0] as MejiroBook;
    expect(book.getOptions().fontSize).toBe(20);
    setOptionsSpy.mockRestore();
    wrapper.unmount();
  });

  it('reacts to options prop changes', async () => {
    const options = ref({ fontFamily: 'serif', fontSize: 16 });
    const book = fakeEpub();
    const Wrapper = defineComponent({
      setup: () => () =>
        h(MejiroReader, {
          epub: book,
          options: options.value,
          enableStats: true,
        }),
    });
    const { container } = render(Wrapper);

    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('serif 16px');

    options.value = { fontFamily: 'serif', fontSize: 22 };
    await nextTick();

    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('serif 22px');
  });

  it('attaches and detaches the auto spread ResizeObserver when spreadMode changes', async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class MockResizeObserver {
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    try {
      const epub = fakeEpub();
      const { rerender, unmount } = render(MejiroReader, {
        props: { epub, spreadMode: 'double' },
      });
      observe.mockClear();
      disconnect.mockClear();

      await rerender({ epub, spreadMode: 'auto' });
      expect(observe).toHaveBeenCalled();
      disconnect.mockClear();

      await rerender({ epub, spreadMode: 'single' });
      expect(disconnect).toHaveBeenCalled();
      unmount();
    } finally {
      vi.stubGlobal('ResizeObserver', originalResizeObserver);
    }
  });

  it('enableImageOverlay=true with an EPUB exposes the Image button', () => {
    const { container } = render(MejiroReader, {
      props: { enableImageOverlay: true, epub: fakeEpub() },
    });
    expect(
      Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
        b.textContent?.includes('Image'),
      ),
    ).toBe(true);
  });

  it('enableStats=false removes the stats element', () => {
    const { container } = render(MejiroReader, { props: { enableStats: false } });
    expect(container.querySelector('.mejiro-reader-stats')).toBeNull();
  });

  it('enableStats=true (default) renders the stats element', () => {
    const { container } = render(MejiroReader);
    expect(container.querySelector('.mejiro-reader-stats')).not.toBeNull();
  });

  it('enableSurfaceTap=true toggles chrome visibility from the spread surface', async () => {
    const { container } = render(MejiroReader, { props: { epub: fakeEpub() } });
    await waitFor(() => expect(container.querySelector('.mejiro-reader-spread')).not.toBeNull());
    const root = container.querySelector('.mejiro-reader') as HTMLElement;
    const spread = container.querySelector('.mejiro-reader-spread') as HTMLElement;

    const down = new Event('pointerdown', { bubbles: true }) as PointerEvent;
    Object.defineProperties(down, {
      button: { value: 0 },
      clientX: { value: 100 },
      clientY: { value: 100 },
      pointerType: { value: 'touch' },
    });
    spread.dispatchEvent(down);

    const up = new Event('pointerup', { bubbles: true }) as PointerEvent;
    Object.defineProperties(up, {
      clientX: { value: 100 },
      clientY: { value: 100 },
      pointerType: { value: 'touch' },
    });
    spread.dispatchEvent(up);

    await nextTick();
    expect(root.classList.contains('mejiro-reader--chrome-hidden')).toBe(true);
  });
});

describe('MejiroReader (Vue) — chapterNavMode', () => {
  it("'panel' renders the side panel, not the select", () => {
    const { container } = render(MejiroReader, {
      props: { epub: fakeEpub(), chapterNavMode: 'panel' },
    });
    expect(container.querySelector('.mejiro-reader-chapter-panel')).not.toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-nav')).toBeNull();
    expect(
      container.querySelector('.mejiro-reader-body')?.classList.contains('has-chapter-panel'),
    ).toBe(true);
  });

  it("'both' renders the select and the side panel", () => {
    const { container } = render(MejiroReader, {
      props: { epub: fakeEpub(), chapterNavMode: 'both' },
    });
    expect(container.querySelector('.mejiro-reader-chapter-panel')).not.toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-nav')).not.toBeNull();
  });

  it("'none' renders neither chapter affordance", () => {
    const { container } = render(MejiroReader, {
      props: { epub: fakeEpub(), chapterNavMode: 'none' },
    });
    expect(container.querySelector('.mejiro-reader-chapter-panel')).toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-nav')).toBeNull();
  });
});

describe('MejiroReader (Vue) — events', () => {
  it("emits 'load' on initial mount when an epub prop is supplied", () => {
    const onLoad = vi.fn();
    render(MejiroReader, {
      props: { epub: fakeEpub() },
      attrs: { onLoad },
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].title).toBe('Test Book');
  });

  it("emits 'load' again when the epub prop changes", async () => {
    const onLoad = vi.fn();
    const { rerender } = render(MejiroReader, {
      props: { epub: null },
      attrs: { onLoad },
    });
    expect(onLoad).not.toHaveBeenCalled();
    await rerender({ epub: fakeEpub() });
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].title).toBe('Test Book');
  });

  it("emits 'chapter-change' when a chapter is selected via the panel", () => {
    const onChange = vi.fn();
    const { container } = render(MejiroReader, {
      props: { epub: fakeEpub(), chapterNavMode: 'panel' },
      attrs: { 'onChapter-change': onChange },
    });
    const cards = container.querySelectorAll('.mejiro-reader-chapter-card');
    (cards[1] as HTMLButtonElement).click();
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("emits 'error' when URL loading fails", async () => {
    const onError = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    render(MejiroReader, {
      props: { epubUrl: '/missing.epub' },
      attrs: { onError },
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('offline');
    fetchSpy.mockRestore();
  });
});

describe('MejiroReader (Vue) — controlled spreadIdx', () => {
  it('applies the initial controlled spreadIdx after the layout is ready', async () => {
    vi.useFakeTimers();
    const reader = ref<MejiroReaderHandle | null>(null);
    const Wrapped = defineComponent({
      setup: () => () => h(MejiroReader, { ref: reader, epub: longEpub(), spreadIdx: 1 }),
    });

    render(Wrapped);
    await nextTick();
    await vi.runAllTimersAsync();
    await nextTick();

    expect(reader.value?.getReadingPosition().spreadIdx).toBe(1);
    vi.useRealTimers();
  });

  it('returns to the prop value when the host ignores spread-idx-change', async () => {
    vi.useFakeTimers();
    try {
      const reader = ref<MejiroReaderHandle | null>(null);
      // The host records the request but leaves the prop where it was.
      const onSpreadIdxChange = vi.fn();
      const Wrapped = defineComponent({
        setup: () => () =>
          h(MejiroReader, {
            ref: reader,
            epub: longEpub(),
            spreadIdx: 0,
            'onSpread-idx-change': onSpreadIdxChange,
          }),
      });

      render(Wrapped);
      await nextTick();
      await vi.runAllTimersAsync();
      await nextTick();
      expect(reader.value?.getReadingPosition().totalSpreads).toBeGreaterThan(1);

      reader.value?.next();
      await vi.runAllTimersAsync();
      await nextTick();

      expect(onSpreadIdxChange).toHaveBeenCalled();
      expect(reader.value?.getReadingPosition().spreadIdx).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MejiroReader (Vue) — scroll mode', () => {
  it('ignores the scroll it triggered itself and follows user scrolls', async () => {
    const wrapper = mount(MejiroReader, { props: { epub: longEpub(), mode: 'scroll' } });
    await waitFor(() => expect(wrapper.find('.mejiro-reader-scroll').exists()).toBe(true));
    const reader = wrapper.vm as unknown as MejiroReaderHandle;
    const turnStart = vi.fn();
    reader.subscribe('turnStart', turnStart);
    const scrollView = wrapper.findComponent(MejiroScrollView);

    scrollView.vm.$emit('visiblePageChange', 2, 'programmatic');
    await nextTick();

    expect(reader.getReadingPosition().spreadIdx).toBe(0);
    expect(turnStart).not.toHaveBeenCalled();

    scrollView.vm.$emit('visiblePageChange', 2, 'user');
    await nextTick();

    expect(reader.getReadingPosition().spreadIdx).toBe(1);
    expect(turnStart).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe('MejiroReader (Vue) — bare shorthand', () => {
  it('bare hides header, settings, stats, page indicator, chapter nav', () => {
    const { container } = render(MejiroReader, { props: { bare: true, epub: fakeEpub() } });
    expect(container.querySelector('.mejiro-reader-header')).toBeNull();
    expect(container.querySelector('.mejiro-reader-settings-panel')).toBeNull();
    expect(container.querySelector('.mejiro-reader-stats')).toBeNull();
    expect(container.querySelector('.mejiro-reader-chapter-nav')).toBeNull();
    expect(container.querySelector('.mejiro-reader-page-indicator')).toBeNull();
  });

  it('explicit enable* props override bare', () => {
    const { container } = render(MejiroReader, {
      props: { bare: true, enableHeader: true, epub: fakeEpub() },
    });
    expect(container.querySelector('.mejiro-reader-header')).not.toBeNull();
  });
});

describe('MejiroReader (Vue) — epub precedence over epubUrl', () => {
  it('skips the URL fetch when an epub prop is supplied', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    render(MejiroReader, {
      props: { epub: fakeEpub(), epubUrl: '/should-not-fetch.epub' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('falls back to epubUrl fetch when epub is not supplied', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    render(MejiroReader, { props: { epubUrl: '/test.epub' } });
    expect(fetchSpy).toHaveBeenCalledWith('/test.epub');
    fetchSpy.mockRestore();
  });

  it('renders manuscript chapters without an EPUB round-trip (manuscript source)', () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { container } = render(MejiroReader, {
      props: {
        manuscript: [
          { id: 'c1', title: '第一話', body: '本文一。' },
          { id: 'c2', title: '第二話', body: '本文二。' },
        ],
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    const options = container.querySelectorAll('.mejiro-reader-chapter-nav option');
    expect(options.length).toBe(2);
    expect(options[0]?.textContent).toContain('第一話');
    fetchSpy.mockRestore();
  });

  it('takes the EPUB bytes from fetchEpub instead of the global fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const fetchEpub = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const onError = vi.fn();

    render(MejiroReader, {
      props: { epubUrl: '/private.epub', fetchEpub },
      attrs: { onError },
    });

    await waitFor(() => {
      expect(fetchEpub).toHaveBeenCalledWith('/private.epub');
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    // The 8 zero bytes are not a ZIP, so the loader must surface the failure
    // rather than fall back to the global fetch.
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    fetchSpy.mockRestore();
  });

  it('passes fetchOptions through to the global fetch on first load', () => {
    const fetchOptions = { headers: { authorization: 'Bearer token' }, credentials: 'include' };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    render(MejiroReader, { props: { epubUrl: '/private.epub', fetchOptions } });

    expect(fetchSpy).toHaveBeenCalledWith('/private.epub', fetchOptions);
    fetchSpy.mockRestore();
  });

  it('honors the dialect prop when synthesizing the manuscript book', async () => {
    // Both dialects read ｜base《ruby》, but only 'mejiro' reads 《《...》》 as
    // emphasis — under 'narou' those characters stay literal body text.
    const body = '｜漢字《かんじ》と《《傍点》》です';
    const pageOf = async (dialect: 'mejiro' | 'narou'): Promise<HTMLElement> => {
      const { container } = render(MejiroReader, {
        props: { manuscript: [{ id: 'c1', title: 'タイトル', body }], dialect },
      });
      return waitFor(() => {
        const page = container.querySelector<HTMLElement>('.mejiro-reader-page-content');
        if (!page?.textContent) throw new Error('page not laid out yet');
        return page;
      });
    };

    const narou = await pageOf('narou');
    expect(narou.querySelector('ruby rt')?.textContent).toBe('かんじ');
    expect(narou.querySelector('.mejiro-emphasis')).toBeNull();
    expect(narou.textContent).toContain('《《傍点》》');

    const mejiro = await pageOf('mejiro');
    expect(mejiro.querySelector('ruby rt')?.textContent).toBe('かんじ');
    expect(mejiro.querySelector('.mejiro-emphasis')?.textContent).toBe('傍点');
    expect(mejiro.textContent).not.toContain('《《');
  });

  it('loads epubUrl after switching from controlled epub back to URL source', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { rerender } = render(MejiroReader, {
      props: { epub: fakeEpub(), epubUrl: '/initial.epub' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await rerender({ epub: undefined, epubUrl: '/after.epub' });
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledWith('/after.epub');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('reloads when epubUrl changes in uncontrolled URL mode', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { rerender } = render(MejiroReader, { props: { epubUrl: '/one.epub' } });
    expect(fetchSpy).toHaveBeenCalledWith('/one.epub');

    await rerender({ epubUrl: '/two.epub' });
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledWith('/two.epub');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it('uses the latest fetchOptions when epubUrl changes', async () => {
    const firstOptions = { headers: { authorization: 'Bearer one' } };
    const secondOptions = { headers: { authorization: 'Bearer two' } };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { rerender } = render(MejiroReader, {
      props: { epubUrl: '/one.epub', fetchOptions: firstOptions },
    });
    expect(fetchSpy).toHaveBeenCalledWith('/one.epub', firstOptions);

    await rerender({ epubUrl: '/two.epub', fetchOptions: secondOptions });
    await nextTick();

    expect(fetchSpy).toHaveBeenCalledWith('/two.epub', secondOptions);
    fetchSpy.mockRestore();
  });
});

describe('MejiroReader (Vue) — uncontrolled spreadIdx', () => {
  it('does not emit a synthetic spread-idx-change on initial mount', async () => {
    const onSpreadIdxChange = vi.fn();
    render(MejiroReader, {
      props: { epub: fakeEpub() },
      attrs: { 'onSpread-idx-change': onSpreadIdxChange },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    expect(onSpreadIdxChange).not.toHaveBeenCalled();
  });
});

describe('MejiroReader (Vue) — imperative handle', () => {
  it('exposes goToSpread / next / prev / goToChapter / getReadingPosition via ref', () => {
    let handle: MejiroReaderHandle | null = null;
    const Wrapper = defineComponent({
      setup() {
        const reader = ref<MejiroReaderHandle | null>(null);
        return () =>
          h(MejiroReader, {
            ref: (instance: unknown) => {
              const resolved = instance as MejiroReaderHandle | null;
              reader.value = resolved;
              handle = resolved;
            },
            epub: fakeEpub(),
          });
      },
    });
    render(Wrapper);
    expect(handle).not.toBeNull();
    const h0 = handle as unknown as MejiroReaderHandle;
    expect(typeof h0.goToSpread).toBe('function');
    expect(typeof h0.next).toBe('function');
    expect(typeof h0.prev).toBe('function');
    expect(typeof h0.goToChapter).toBe('function');
    const pos = h0.getReadingPosition();
    expect(pos.chapter).toBe(0);
    expect(pos.spreadIdx).toBe(0);
    expect(typeof pos.totalPages).toBe('number');
    expect(typeof pos.totalSpreads).toBe('number');
  });

  function mountHandle(): { handle: MejiroReaderHandle; unmount: () => void } {
    let handle: MejiroReaderHandle | null = null;
    const Wrapper = defineComponent({
      setup() {
        return () =>
          h(MejiroReader, {
            ref: (instance: unknown) => {
              handle = instance as MejiroReaderHandle | null;
            },
            epub: fakeEpub(),
          });
      },
    });
    const { unmount } = render(Wrapper);
    expect(handle).not.toBeNull();
    return { handle: handle as unknown as MejiroReaderHandle, unmount };
  }

  it('goToAnchor returns a Promise', () => {
    const { handle, unmount } = mountHandle();
    const result = handle.goToAnchor({ chapter: 0, paragraph: 0, charIndex: 0 });
    expect(result).toBeInstanceOf(Promise);
    void result.catch(() => {});
    unmount();
  });

  it('goToAnchor supersedes the previous in-flight call (prior promise resolves)', async () => {
    const { handle, unmount } = mountHandle();
    const firstPromise = handle.goToAnchor({ chapter: 99, paragraph: 0, charIndex: 0 });
    void handle.goToAnchor({ chapter: 99, paragraph: 1, charIndex: 0 });
    await expect(firstPromise).resolves.toBeUndefined();
    unmount();
  });

  it('goToAnchor resolves on unmount even if the layout never settles', async () => {
    const { handle, unmount } = mountHandle();
    const promise = handle.goToAnchor({ chapter: 99, paragraph: 0, charIndex: 0 });
    unmount();
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('MejiroReader (Vue) — annotations', () => {
  it('paints annotation highlights in the color the annotation asked for', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(MejiroReader, {
        props: {
          epub: longEpub(),
          annotations: [
            {
              chapter: 0,
              start: { paragraph: 0, charIndex: 0 },
              end: { paragraph: 0, charIndex: 8 },
              color: 'rgb(255, 235, 59)',
            },
          ],
        },
      });
      await vi.runAllTimersAsync();
      await nextTick();

      const rects = Array.from(container.querySelectorAll<HTMLElement>('.mejiro-selection-rect'));
      expect(rects.length).toBeGreaterThan(0);
      for (const rect of rects) {
        expect(rect.style.backgroundColor).toBe('rgb(255, 235, 59)');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('paints annotation highlights only on the spread they belong to', async () => {
    vi.useFakeTimers();
    try {
      const epub = longEpub();
      const annotations = [
        {
          chapter: 0,
          start: { paragraph: 0, charIndex: 0 },
          end: { paragraph: 0, charIndex: 8 },
        },
      ];
      let instance: unknown = null;
      const Wrapper = defineComponent({
        setup() {
          return () =>
            h(MejiroReader, {
              ref: (el: unknown) => {
                instance = el;
              },
              epub,
              annotations,
            });
        },
      });
      const { container } = render(Wrapper);
      await vi.runAllTimersAsync();
      await nextTick();
      const handle = instance as MejiroReaderHandle;

      expect(handle.getReadingPosition().totalSpreads).toBeGreaterThan(3);
      expect(container.querySelectorAll('.mejiro-selection-rect').length).toBeGreaterThan(0);

      handle.goToSpread(3);
      await vi.runAllTimersAsync();
      await nextTick();
      expect(handle.getReadingPosition().spreadIdx).toBe(3);
      expect(container.querySelectorAll('.mejiro-selection-rect').length).toBe(0);

      handle.goToSpread(0);
      await vi.runAllTimersAsync();
      await nextTick();
      expect(container.querySelectorAll('.mejiro-selection-rect').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MejiroReader (Vue) — runtime option changes', () => {
  it('binds and releases the arrow keys when enableKeyboard changes at runtime', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    try {
      const wrapper = mount(MejiroReader, {
        props: { epub: fakeEpub(), enableKeyboard: false },
      });
      await nextTick();
      const keydownAdds = () => addSpy.mock.calls.filter(([type]) => type === 'keydown').length;
      const keydownRemoves = () =>
        removeSpy.mock.calls.filter(([type]) => type === 'keydown').length;
      const addsBefore = keydownAdds();

      await wrapper.setProps({ enableKeyboard: true });
      expect(keydownAdds()).toBeGreaterThan(addsBefore);

      const removesBefore = keydownRemoves();
      await wrapper.setProps({ enableKeyboard: false });
      expect(keydownRemoves()).toBeGreaterThan(removesBefore);
      wrapper.unmount();
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it('emits error for a failed option application instead of rejecting', async () => {
    const failure = new Error('font unavailable');
    const spy = vi.spyOn(MejiroBook.prototype, 'setOptions').mockRejectedValue(failure);
    try {
      const wrapper = mount(MejiroReader, { props: { epub: fakeEpub() } });
      const reader = wrapper.vm as unknown as MejiroReaderHandle;

      await expect(reader.setOptions({ fontFamily: '"Missing Font"' })).resolves.toBeUndefined();
      expect(wrapper.emitted('error')?.[0]).toEqual([failure]);
      wrapper.unmount();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('MejiroReader (Vue) — slots', () => {
  it('#logo slot replaces the default logo block', () => {
    const { container } = render(MejiroReader, {
      slots: { logo: '<div class="custom-logo">Custom</div>' },
    });
    expect(container.querySelector('.custom-logo')?.textContent).toBe('Custom');
    expect(container.querySelector('.mejiro-reader-logo')).toBeNull();
  });
});
