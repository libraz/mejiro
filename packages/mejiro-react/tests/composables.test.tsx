// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import type { EditableEpub } from '@libraz/mejiro/epub';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@libraz/mejiro/epub', () => {
  function makeEditable(): unknown {
    return {
      book: {
        title: 'Editable',
        chapters: [
          {
            href: 'OPS/Text/chapter.xhtml',
            title: 'C1',
            paragraphs: [
              { text: 'editable', inlineAnnotations: [] },
              { text: 'second', inlineAnnotations: [] },
            ],
            blocks: [
              { kind: 'paragraph', id: 'b-1', text: 'editable', inlineAnnotations: [] },
              { kind: 'paragraph', id: 'b-2', text: 'second', inlineAnnotations: [] },
            ],
            imageAssets: new Map(),
          },
        ],
        packageData: {
          rootfilePath: 'OPS/package.opf',
          opfDir: 'OPS/',
          opfXml: '',
          files: new Map(),
        },
      },
      history: { canUndo: true, canRedo: false, depth: 1, redoDepth: 0 },
      updateParagraph: vi.fn(),
      setInlineAnnotations: vi.fn(),
      addImage: vi.fn(),
      undo: vi.fn(function (this: { history: unknown }) {
        this.history = { canUndo: false, canRedo: true, depth: 0, redoDepth: 1 };
        return true;
      }),
      redo: vi.fn(function (this: { history: unknown }) {
        this.history = { canUndo: true, canRedo: false, depth: 1, redoDepth: 0 };
        return true;
      }),
      export: vi.fn(async () => new ArrayBuffer(4)),
    };
  }
  return {
    // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
    EditableEpub: {
      load: vi.fn(async () => makeEditable()),
    },
    parseEpub: vi.fn(async () => ({
      title: 'Mocked',
      author: 'A',
      chapters: [{ title: 'C1', paragraphs: [{ text: 'a', inlineAnnotations: [] }] }],
    })),
  };
});

import { useEditableEpub } from '../src/useEditableEpub.js';
import { useEpub } from '../src/useEpub.js';
import { useImageOverlay } from '../src/useImageOverlay.js';
import { useMejiroBook } from '../src/useMejiroBook.js';
import { useMultiImageOverlay } from '../src/useMultiImageOverlay.js';
import { useSpread } from '../src/useSpread.js';

function mockEditableBook(title: string, text: string): unknown {
  return {
    book: {
      title,
      chapters: [
        {
          href: 'OPS/Text/chapter.xhtml',
          title: 'C1',
          paragraphs: [{ text, inlineAnnotations: [] }],
          blocks: [{ kind: 'paragraph', id: 'b-1', text, inlineAnnotations: [] }],
          imageAssets: new Map(),
        },
      ],
      packageData: {
        rootfilePath: 'OPS/package.opf',
        opfDir: 'OPS/',
        opfXml: '',
        files: new Map(),
      },
    },
    history: { canUndo: false, canRedo: false, depth: 0, redoDepth: 0 },
    updateParagraph: vi.fn(),
    setInlineAnnotations: vi.fn(),
    addImage: vi.fn(),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
    export: vi.fn(async () => new ArrayBuffer(4)),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mockLayout(totalPages = 6): ChapterLayout {
  const spread = (i: number): SpreadResult =>
    ({
      spreadIdx: i,
      totalPages,
      totalSpreads: Math.ceil(totalPages / 2),
    }) as unknown as SpreadResult;
  return {
    totalPages,
    getSpread: vi.fn(spread),
    setImages: vi.fn(),
    clearImages: vi.fn(),
    syncImages: vi.fn(() => spread(0)),
    resize: vi.fn(),
  } as unknown as ChapterLayout;
}

describe('useMejiroBook (React)', () => {
  it('creates a stable MejiroBook instance and reflects initial options', () => {
    const { result } = renderHook(() => useMejiroBook({ fontFamily: 'serif', fontSize: 16 }));
    expect(result.current.book).toBeTruthy();
    expect(result.current.options.fontFamily).toBe('serif');
    expect(result.current.options.fontSize).toBe(16);
  });

  it('setOptions updates both the React snapshot and the underlying book', async () => {
    const { result } = renderHook(() => useMejiroBook({ fontFamily: 'serif', fontSize: 16 }));
    await act(async () => {
      await result.current.setOptions({ fontSize: 24 });
    });
    expect(result.current.options.fontSize).toBe(24);
    expect(result.current.book.getOptions().fontSize).toBe(24);
  });

  it('keeps the book instance stable across rerenders with new initial options', () => {
    const { result, rerender } = renderHook(({ options }) => useMejiroBook(options), {
      initialProps: { options: { fontFamily: 'serif', fontSize: 16 } },
    });
    const book = result.current.book;

    // Changing the `initial` prop after mount is intentionally ignored;
    // runtime updates must go through `setOptions`. The book instance is reused.
    rerender({ options: { fontFamily: 'serif', fontSize: 20 } });
    expect(result.current.book).toBe(book);
    expect(result.current.options.fontSize).toBe(16);
  });
});

describe('useEpub (React)', () => {
  it('starts with epub=null, loading=false, error=null', () => {
    const { result } = renderHook(() => useEpub());
    expect(result.current.epub).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('loadBuffer populates epub', async () => {
    const { result } = renderHook(() => useEpub());
    let book: unknown;
    await act(async () => {
      book = await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect((book as { title: string }).title).toBe('Mocked');
    expect(result.current.epub?.title).toBe('Mocked');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('captures parser errors via the error state', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useEpub());
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(result.current.epub).toBeNull();
    expect(result.current.error?.message).toBe('boom');
  });

  it('invokes onError when parsing fails', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const onError = vi.fn();
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useEpub({ onError }));
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('boom');
  });

  it('setEpub replaces the current EPUB without going through the parser and clears stale errors', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useEpub());
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(result.current.error?.message).toBe('boom');

    act(() => result.current.setEpub({ title: 'Direct', author: 'X', chapters: [] }));
    expect(result.current.epub?.title).toBe('Direct');
    expect(result.current.error).toBeNull();
  });

  it('invokes the onLoad callback after a successful loadBuffer', async () => {
    const onLoad = vi.fn();
    const { result } = renderHook(() => useEpub({ onLoad }));
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].title).toBe('Mocked');
  });

  it('loadUrl returns null on a non-OK response without setting an error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { result } = renderHook(() => useEpub());
    let book: unknown;
    await act(async () => {
      book = await result.current.loadUrl('/missing.epub');
    });
    expect(book).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.epub).toBeNull();
    fetchSpy.mockRestore();
  });

  it('loadUrl captures network errors via the error state', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useEpub());
    await act(async () => {
      await result.current.loadUrl('/x.epub');
    });
    expect(result.current.error?.message).toBe('offline');
    fetchSpy.mockRestore();
  });

  it('uses the latest onError callback without reloading the defaultUrl', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const firstOnError = vi.fn();
    const secondOnError = vi.fn();
    const { rerender } = renderHook(
      ({ onError }) => useEpub({ defaultUrl: '/auto.epub', onError }),
      {
        initialProps: { onError: firstOnError },
      },
    );

    rerender({ onError: secondOnError });

    await waitFor(() => expect(secondOnError).toHaveBeenCalledTimes(1));
    expect(firstOnError).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('auto-loads via defaultUrl on mount', async () => {
    const buf = new ArrayBuffer(8);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(buf, { status: 200 }));
    const onLoad = vi.fn();
    const { result } = renderHook(() => useEpub({ defaultUrl: '/auto.epub', onLoad }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchSpy).toHaveBeenCalledWith('/auto.epub');
    expect(result.current.epub?.title).toBe('Mocked');
    expect(onLoad).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

describe('useEditableEpub (React)', () => {
  it('invokes onError when editable parsing fails', async () => {
    const { EditableEpub } = await import('@libraz/mejiro/epub');
    const onError = vi.fn();
    (EditableEpub.load as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad epub'));
    const { result } = renderHook(() => useEditableEpub({ onError }));

    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });

    expect(result.current.editor).toBeNull();
    expect(result.current.error?.message).toBe('bad epub');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('bad epub');
  });

  it('exposes undo/redo history and forwards export options', async () => {
    const onExport = vi.fn();
    const onProgress = vi.fn();
    const { result } = renderHook(() => useEditableEpub({ onExport }));

    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(result.current.history?.canUndo).toBe(true);
    expect(result.current.selectedParagraph?.text).toBe('editable');

    act(() => {
      result.current.setSelection({ chapter: 0, paragraph: 1 });
    });
    expect(result.current.selectedParagraph?.text).toBe('second');

    act(() => {
      expect(result.current.undo()).toBe(true);
    });
    expect(result.current.history?.canRedo).toBe(true);

    const exportedBuffer = new ArrayBuffer(4);
    let resolveExport!: (buffer: ArrayBuffer) => void;
    const exportSpy = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveExport = resolve;
        }),
    );
    (result.current.editor as { export: typeof exportSpy }).export = exportSpy;

    let buffer: ArrayBuffer | null = null;
    let exportPromise!: Promise<ArrayBuffer | null>;
    act(() => {
      exportPromise = result.current.exportEpub({ onProgress });
    });
    expect(result.current.exporting).toBe(true);

    await act(async () => {
      resolveExport(exportedBuffer);
      buffer = await exportPromise;
    });
    expect(result.current.exporting).toBe(false);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(onExport).toHaveBeenCalledWith(buffer);
    expect(exportSpy).toHaveBeenCalledWith({ onProgress });
  });

  it('clamps public selection to the loaded editable book', async () => {
    const { result } = renderHook(() => useEditableEpub());

    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });

    act(() => {
      result.current.setSelection({ chapter: 99, paragraph: 99 });
    });
    expect(result.current.selection).toEqual({ chapter: 0, paragraph: 1 });
    expect(result.current.selectedParagraph?.text).toBe('second');

    act(() => {
      result.current.setSelection({ chapter: -1, paragraph: 0.8 });
    });
    expect(result.current.selection).toEqual({ chapter: 0, paragraph: 0 });
    expect(result.current.selectedParagraph?.text).toBe('editable');
  });

  it('keeps previewBook isolated from the editable source graph', async () => {
    const { result } = renderHook(() => useEditableEpub());

    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });

    const preview = result.current.previewBook;
    const book = result.current.book;
    if (!(preview && book)) throw new Error('missing editable book');

    expect(preview).not.toBe(book);
    expect(preview.chapters[0]).not.toBe(book.chapters[0]);
    expect(preview.chapters[0].blocks[0]).not.toBe(book.chapters[0].blocks[0]);
    expect(preview.chapters[0].paragraphs[0]).not.toBe(book.chapters[0].paragraphs[0]);

    const previewBlock = preview.chapters[0].blocks[0];
    const sourceBlock = book.chapters[0].blocks[0];
    if (previewBlock.kind !== 'paragraph' || sourceBlock.kind !== 'paragraph') {
      throw new Error('missing paragraph block');
    }

    previewBlock.text = 'preview block mutation';
    preview.chapters[0].paragraphs[0].text = 'preview paragraph mutation';

    expect(sourceBlock.text).toBe('editable');
    expect(book.chapters[0].paragraphs[0].text).toBe('editable');
  });

  it('forwards the v0.5 addImage input shape', async () => {
    const { result } = renderHook(() => useEditableEpub());

    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });

    const image = {
      filename: 'inserted.png',
      data: new Uint8Array([1, 2, 3]),
      alt: 'Inserted',
      caption: 'Caption',
    };

    act(() => {
      result.current.addImage(image);
    });

    expect(result.current.editor?.addImage).toHaveBeenCalledWith(0, image);
  });

  it('keeps loading true while loadUrl fetches an editable EPUB', async () => {
    const response = deferred<Response>();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => useEditableEpub());

    let loadPromise!: Promise<EditableEpub | null>;
    act(() => {
      loadPromise = result.current.loadUrl('/editable.epub');
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      response.resolve(new Response(new ArrayBuffer(8), { status: 200 }));
      await loadPromise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.book?.title).toBe('Editable');
    fetchSpy.mockRestore();
  });

  it('ignores stale editable load results', async () => {
    const { EditableEpub } = await import('@libraz/mejiro/epub');
    const loadMock = EditableEpub.load as ReturnType<typeof vi.fn>;
    const slow = deferred<unknown>();
    loadMock
      .mockImplementationOnce(async () => slow.promise)
      .mockImplementationOnce(async () => mockEditableBook('Fast', 'fast'));
    const { result } = renderHook(() => useEditableEpub());

    let slowLoad!: Promise<EditableEpub | null>;
    let fastLoad!: Promise<EditableEpub | null>;
    act(() => {
      slowLoad = result.current.loadBuffer(new ArrayBuffer(8));
      fastLoad = result.current.loadBuffer(new ArrayBuffer(8));
    });

    await act(async () => {
      await fastLoad;
    });
    expect(result.current.book?.title).toBe('Fast');

    await act(async () => {
      slow.resolve(mockEditableBook('Slow', 'slow'));
      await slowLoad;
    });
    expect(result.current.book?.title).toBe('Fast');
    expect(result.current.selectedParagraph?.text).toBe('fast');
  });
});

describe('useSpread (React)', () => {
  it('returns idle state when layout is null', () => {
    const { result } = renderHook(() => useSpread(null, { turnDuration: 0 }));
    expect(result.current.spread).toBeNull();
    expect(result.current.totalPages).toBe(0);
    expect(result.current.totalSpreads).toBe(1);
  });

  it('refreshes spread when layout becomes available', () => {
    const layout = mockLayout(6);
    const { result, rerender } = renderHook(
      ({ l }: { l: ChapterLayout | null }) => useSpread(l, { turnDuration: 0 }),
      { initialProps: { l: null as ChapterLayout | null } },
    );
    expect(result.current.spread).toBeNull();
    rerender({ l: layout });
    expect(result.current.spread).not.toBeNull();
    expect(result.current.totalPages).toBe(6);
    expect(result.current.totalSpreads).toBe(3);
  });

  it('next/prev/goTo move the spread index and call onChange', () => {
    const onChange = vi.fn();
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDuration: 0, onChange }));

    act(() => result.current.next());
    expect(result.current.spreadIdx).toBe(1);

    act(() => result.current.next());
    expect(result.current.spreadIdx).toBe(2);

    act(() => result.current.prev());
    expect(result.current.spreadIdx).toBe(1);

    act(() => result.current.goTo(99));
    expect(result.current.spreadIdx).toBe(2);

    act(() => result.current.goTo(-5));
    expect(result.current.spreadIdx).toBe(0);

    expect(onChange).toHaveBeenCalled();
  });

  it('moves on ArrowLeft / ArrowRight when enableKeyboard is set', () => {
    const layout = mockLayout(6);
    const { result } = renderHook(() =>
      useSpread(layout, { turnDuration: 0, enableKeyboard: true }),
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(result.current.spreadIdx).toBe(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(result.current.spreadIdx).toBe(0);
  });

  it('refresh() re-fetches the spread at the current index', () => {
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDuration: 0 }));
    const callsBefore = (layout.getSpread as ReturnType<typeof vi.fn>).mock.calls.length;
    act(() => result.current.refresh());
    expect((layout.getSpread as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore + 1);
  });

  it('flips `turning` true while the page-turn animation is in flight', () => {
    vi.useFakeTimers();
    try {
      const layout = mockLayout(6);
      const { result } = renderHook(() => useSpread(layout, { turnDuration: 180 }));
      act(() => result.current.next());
      // setTimeout has not yet fired — `turning` is on, index unchanged.
      expect(result.current.turning).toBe(true);
      expect(result.current.spreadIdx).toBe(0);

      act(() => {
        vi.advanceTimersByTime(180);
      });
      expect(result.current.turning).toBe(false);
      expect(result.current.spreadIdx).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useMultiImageOverlay (React)', () => {
  it('starts empty and toggles hasImages once an image is added', () => {
    const layout = mockLayout(4);
    const { result } = renderHook(() => useMultiImageOverlay(layout, 0));
    expect(result.current.imagesBySpread.size).toBe(0);
    expect(result.current.hasImages).toBe(false);

    let added: { id: string } | undefined;
    act(() => {
      added = result.current.addImage();
    });
    expect(result.current.hasImages).toBe(true);
    expect(result.current.currentImages).toHaveLength(1);
    expect(added?.id).toMatch(/^mejiro-img-/);
  });

  it('calls layout.setImages with the per-spread image list after add', () => {
    const layout = mockLayout(4);
    const { result } = renderHook(() => useMultiImageOverlay(layout, 0));
    act(() => {
      result.current.addImage({ x: 1, y: 2, w: 3, h: 4 });
    });
    expect(layout.setImages).toHaveBeenCalledWith(0, [
      expect.objectContaining({ x: 1, y: 2, w: 3, h: 4 }),
    ]);
  });

  it('removeImage removes by id and updateImage merges rect changes', () => {
    const layout = mockLayout(4);
    const { result } = renderHook(() => useMultiImageOverlay(layout, 0));
    let a: { id: string } | undefined;
    let b: { id: string } | undefined;
    act(() => {
      a = result.current.addImage({ x: 10, y: 10, w: 50, h: 50 });
    });
    act(() => {
      b = result.current.addImage({ x: 20, y: 20, w: 60, h: 60 });
    });

    act(() => result.current.updateImage(b?.id ?? '', { x: 99 }));
    expect(result.current.currentImages.find((i) => i.id === b?.id)?.rect.x).toBe(99);

    act(() => result.current.removeImage(a?.id ?? ''));
    expect(result.current.currentImages).toHaveLength(1);
    expect(result.current.currentImages[0].id).toBe(b?.id);
  });

  it('clearImages() without arg removes every image across spreads', () => {
    const layout = mockLayout(4);
    const { result, rerender } = renderHook(
      ({ s }: { s: number }) => useMultiImageOverlay(layout, s),
      { initialProps: { s: 0 } },
    );
    act(() => {
      result.current.addImage();
    });
    rerender({ s: 1 });
    act(() => {
      result.current.addImage();
    });
    expect(result.current.imagesBySpread.size).toBe(2);
    act(() => result.current.clearImages());
    expect(result.current.imagesBySpread.size).toBe(0);
    expect(result.current.hasImages).toBe(false);
  });

  it('clearImages(idx) only removes images on the target spread', () => {
    const layout = mockLayout(4);
    const { result, rerender } = renderHook(
      ({ s }: { s: number }) => useMultiImageOverlay(layout, s),
      { initialProps: { s: 0 } },
    );
    act(() => {
      result.current.addImage();
    });
    rerender({ s: 1 });
    act(() => {
      result.current.addImage();
    });
    act(() => result.current.clearImages(0));
    expect(result.current.imagesBySpread.has(0)).toBe(false);
    expect(result.current.imagesBySpread.has(1)).toBe(true);
  });

  it('removes active drag listeners when unmounted mid-drag', () => {
    const layout = mockLayout(4);
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => useMultiImageOverlay(layout, 0));
    let item: { id: string } | undefined;
    act(() => {
      item = result.current.addImage();
    });
    const target = Object.assign(document.createElement('div'), { setPointerCapture: vi.fn() });

    act(() => {
      result.current.onOverlayPointerDown(item?.id ?? '', {
        preventDefault: vi.fn(),
        clientX: 0,
        clientY: 0,
        currentTarget: target,
        nativeEvent: { pointerId: 1 },
      } as never);
    });
    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe('useImageOverlay (React, single)', () => {
  it('toggle adds then clears the rect and calls syncImages each time', () => {
    const layout = mockLayout(4);
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useImageOverlay(layout, 0, onUpdate, { defaultX: 5 }));

    expect(result.current.hasImage).toBe(false);

    act(() => result.current.toggleImage());
    expect(result.current.hasImage).toBe(true);
    expect(result.current.imageRect?.x).toBe(5);
    expect(layout.syncImages).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    act(() => result.current.toggleImage());
    expect(result.current.hasImage).toBe(false);
    expect(result.current.imageRect).toBeNull();
    expect(layout.syncImages).toHaveBeenCalledTimes(2);
  });

  it('removes active drag listeners when unmounted mid-drag', () => {
    const layout = mockLayout(4);
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => useImageOverlay(layout, 0, vi.fn()));
    act(() => result.current.toggleImage());
    const target = Object.assign(document.createElement('div'), { setPointerCapture: vi.fn() });

    act(() => {
      result.current.onOverlayPointerDown({
        preventDefault: vi.fn(),
        clientX: 0,
        clientY: 0,
        currentTarget: target,
        nativeEvent: { pointerId: 1 },
      } as never);
    });
    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
