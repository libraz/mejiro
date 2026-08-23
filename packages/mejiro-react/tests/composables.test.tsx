// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, InChapterAnchor, MejiroBook, SpreadResult } from '@libraz/mejiro/book';
import { MejiroBook as MejiroBookClass } from '@libraz/mejiro/book';
import type { EditableEpub, EpubBook } from '@libraz/mejiro/epub';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  // Only the loaders are faked; the module's pure helpers (the book clone the
  // preview relies on, the selection clamp) stay real.
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();

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
    ...actual,
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

import { useChapterLayout } from '../src/useChapterLayout.js';
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

interface HistoryEditorStub {
  book: {
    chapters: { paragraphs: { text: string; inlineAnnotations: never[] }[] }[];
  };
}

/**
 * Editable-EPUB stub whose edits, undo and redo replace the paragraph mirror
 * with a fresh array, the way the core editor re-syncs it after each command.
 */
function mockHistoryEditor(initialText: string): unknown {
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let current = initialText;
  const book = {
    title: 'History',
    chapters: [
      {
        href: 'OPS/Text/chapter.xhtml',
        title: 'C1',
        paragraphs: [{ text: current, inlineAnnotations: [] }],
        blocks: [{ kind: 'paragraph', id: 'b-1', text: current, inlineAnnotations: [] }],
        imageAssets: new Map(),
      },
    ],
    packageData: {
      rootfilePath: 'OPS/package.opf',
      opfDir: 'OPS/',
      opfXml: '',
      files: new Map(),
    },
  };
  function sync(next: string): void {
    current = next;
    book.chapters[0].paragraphs = [{ text: next, inlineAnnotations: [] }];
    book.chapters[0].blocks = [{ kind: 'paragraph', id: 'b-1', text: next, inlineAnnotations: [] }];
  }
  return {
    book,
    history: { canUndo: false, canRedo: false, depth: 0, redoDepth: 0 },
    updateParagraph: vi.fn((_chapter: number, _paragraph: number, patch: { text: string }) => {
      undoStack.push(current);
      redoStack.length = 0;
      sync(patch.text);
    }),
    setInlineAnnotations: vi.fn(),
    addImage: vi.fn(),
    undo: vi.fn(() => {
      const previous = undoStack.pop();
      if (previous === undefined) return false;
      redoStack.push(current);
      sync(previous);
      return true;
    }),
    redo: vi.fn(() => {
      const next = redoStack.pop();
      if (next === undefined) return false;
      undoStack.push(current);
      sync(next);
      return true;
    }),
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

  it('coalesces rapid changes into a single book application while updating the snapshot at once', async () => {
    const spy = vi.spyOn(MejiroBookClass.prototype, 'setOptions');
    try {
      const { result } = renderHook(() =>
        useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, { debounceMs: 20 }),
      );
      await act(async () => {
        const settled = Promise.all([
          result.current.setOptions({ fontSize: 17 }),
          result.current.setOptions({ fontSize: 18 }),
          result.current.setOptions({ lineSpacing: 2 }),
        ]);
        await settled;
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ fontSize: 18, lineSpacing: 2 });
      expect(result.current.options.fontSize).toBe(18);
      expect(result.current.book.getOptions().fontSize).toBe(18);
    } finally {
      spy.mockRestore();
    }
  });

  it('reports a failed application through onError and resolves the promise', async () => {
    const failure = new Error('font unavailable');
    const spy = vi.spyOn(MejiroBookClass.prototype, 'setOptions').mockRejectedValue(failure);
    const onError = vi.fn();
    try {
      const { result } = renderHook(() =>
        useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, { onError }),
      );
      let settled: unknown = 'not-settled';
      await act(async () => {
        settled = await result.current.setOptions({ fontFamily: 'missing' });
      });
      expect(settled).toBeUndefined();
      expect(onError).toHaveBeenCalledWith(failure);
    } finally {
      spy.mockRestore();
    }
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

describe('useEpub (React) — parse limits', () => {
  /** Stand-in expanded size of the archive the mocked parser "opens". */
  const archiveBytes = 5000;

  /** Installs a parser that enforces `maxTotalBytes` and returns a restorer. */
  async function withLimitAwareParser(): Promise<() => void> {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const parseMock = parseEpub as ReturnType<typeof vi.fn>;
    const previous = parseMock.getMockImplementation();
    parseMock.mockImplementation(
      async (_buffer: ArrayBuffer, options?: { limits?: { maxTotalBytes?: number } }) => {
        const maxTotalBytes = options?.limits?.maxTotalBytes ?? 1024;
        if (archiveBytes > maxTotalBytes) throw new Error('EPUB archive is too large');
        return { title: 'Large', author: 'A', chapters: [] };
      },
    );
    return () => {
      if (previous) parseMock.mockImplementation(previous);
    };
  }

  it('rejects an archive that exceeds the configured limit', async () => {
    const restore = await withLimitAwareParser();
    const { result } = renderHook(() => useEpub({ limits: { maxTotalBytes: 2048 } }));

    let book: unknown;
    await act(async () => {
      book = await result.current.loadBuffer(new ArrayBuffer(8));
    });

    expect(book).toBeNull();
    expect(result.current.error?.message).toBe('EPUB archive is too large');
    restore();
  });

  it('accepts the same archive under a looser limit', async () => {
    const restore = await withLimitAwareParser();
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const buffer = new ArrayBuffer(8);
    const { result } = renderHook(() => useEpub({ limits: { maxTotalBytes: 10_000 } }));

    let book: unknown;
    await act(async () => {
      book = await result.current.loadBuffer(buffer);
    });

    expect((book as { title: string }).title).toBe('Large');
    expect(result.current.error).toBeNull();
    expect(parseEpub).toHaveBeenCalledWith(buffer, { limits: { maxTotalBytes: 10_000 } });
    restore();
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

  it('forwards parse limits to the editable loader', async () => {
    const { EditableEpub } = await import('@libraz/mejiro/epub');
    const loadMock = EditableEpub.load as ReturnType<typeof vi.fn>;
    const previous = loadMock.getMockImplementation();
    loadMock.mockImplementation(
      async (_buffer: ArrayBuffer, options?: { limits?: { maxTotalBytes?: number } }) => {
        const maxTotalBytes = options?.limits?.maxTotalBytes ?? 1024;
        if (maxTotalBytes < 5000) throw new Error('EPUB archive is too large');
        return mockEditableBook('Large', 'large');
      },
    );

    const strict = renderHook(() => useEditableEpub({ limits: { maxTotalBytes: 2048 } }));
    await act(async () => {
      await strict.result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(strict.result.current.error?.message).toBe('EPUB archive is too large');

    const buffer = new ArrayBuffer(8);
    const loose = renderHook(() => useEditableEpub({ limits: { maxTotalBytes: 10_000 } }));
    await act(async () => {
      await loose.result.current.loadBuffer(buffer);
    });
    expect(loose.result.current.book?.title).toBe('Large');
    expect(loadMock).toHaveBeenCalledWith(buffer, { limits: { maxTotalBytes: 10_000 } });

    if (previous) loadMock.mockImplementation(previous);
  });

  it('tracks the selected paragraph through edits, undo and redo', async () => {
    const { EditableEpub } = await import('@libraz/mejiro/epub');
    const stub = mockHistoryEditor('first');
    (EditableEpub.load as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => stub);
    const { result } = renderHook(() => useEditableEpub());

    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    const live = () => (stub as HistoryEditorStub).book.chapters[0].paragraphs[0];
    expect(result.current.selectedParagraph?.text).toBe('first');

    act(() => {
      result.current.updateParagraph('edited');
    });
    expect(result.current.selectedParagraph?.text).toBe('edited');
    expect(result.current.selectedParagraph).toBe(live());

    act(() => {
      expect(result.current.undo()).toBe(true);
    });
    expect(result.current.selectedParagraph?.text).toBe('first');
    expect(result.current.selectedParagraph).toBe(live());

    act(() => {
      expect(result.current.redo()).toBe(true);
    });
    expect(result.current.selectedParagraph?.text).toBe('edited');
    expect(result.current.selectedParagraph).toBe(live());
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

  it('leaves arrow keys to editable fields, modifiers and handled events', () => {
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDuration: 0 }));

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    for (const el of [input, textarea, editable]) document.body.appendChild(el);
    const preventer = (e: Event) => e.preventDefault();

    try {
      for (const el of [input, textarea, editable]) {
        act(() => {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        });
        expect(result.current.spreadIdx).toBe(0);
      }

      for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
        act(() => {
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowLeft', [modifier]: true }),
          );
        });
        expect(result.current.spreadIdx).toBe(0);
      }

      document.body.addEventListener('keydown', preventer);
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
        );
      });
      expect(result.current.spreadIdx).toBe(0);
      document.body.removeEventListener('keydown', preventer);

      // A plain arrow key on the page still turns the spread.
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
        );
      });
      expect(result.current.spreadIdx).toBe(1);
    } finally {
      document.body.removeEventListener('keydown', preventer);
      for (const el of [input, textarea, editable]) el.remove();
    }
  });

  it('follows enableKeyboard when it flips at runtime', () => {
    const layout = mockLayout(6);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useSpread(layout, { turnDuration: 0, enableKeyboard: enabled }),
      { initialProps: { enabled: true } },
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(result.current.spreadIdx).toBe(1);

    rerender({ enabled: false });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(result.current.spreadIdx).toBe(1);

    rerender({ enabled: true });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    });
    expect(result.current.spreadIdx).toBe(2);
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

  it('setSpread jumps immediately (no turn animation) and clamps to range', () => {
    const layout = mockLayout(6);
    const { result } = renderHook(() => useSpread(layout, { turnDuration: 180 }));

    act(() => result.current.setSpread(2));
    expect(result.current.spreadIdx).toBe(2);
    expect(result.current.turning).toBe(false);

    act(() => result.current.setSpread(99));
    expect(result.current.spreadIdx).toBe(2); // clamped to totalSpreads − 1

    act(() => result.current.setSpread(-5));
    expect(result.current.spreadIdx).toBe(0);
  });

  it('setSpread cancels an in-flight page-turn animation', () => {
    vi.useFakeTimers();
    try {
      const layout = mockLayout(6);
      const { result } = renderHook(() => useSpread(layout, { turnDuration: 180 }));
      act(() => result.current.goTo(2));
      expect(result.current.turning).toBe(true);

      act(() => result.current.setSpread(1));
      expect(result.current.turning).toBe(false);
      expect(result.current.spreadIdx).toBe(1);

      // The superseded goTo timer must not fire afterwards.
      act(() => {
        vi.advanceTimersByTime(180);
      });
      expect(result.current.spreadIdx).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useChapterLayout (React)', () => {
  function makeEpub(): EpubBook {
    return { chapters: [{ text: 'x', paragraphs: [] }] } as unknown as EpubBook;
  }
  function makeBook(layouts: ChapterLayout[]): MejiroBook {
    let i = 0;
    return {
      computePageSize: vi.fn(() => ({ pageWidth: 120, pageHeight: 174, contentHeight: 150 })),
      layoutChapter: vi.fn(async () => layouts[Math.min(i++, layouts.length - 1)]),
    } as unknown as MejiroBook;
  }

  it('captures the position before a reflow and exposes it via pendingRestore', async () => {
    const l0 = mockLayout(6);
    const l1 = mockLayout(8);
    const book = makeBook([l0, l1]);
    const epub = makeEpub();
    const surface = { current: document.createElement('div') };
    const anchor: InChapterAnchor = { paragraph: 0, charIndex: 5 };
    const capturePosition = vi.fn(() => anchor);

    const { result } = renderHook(() =>
      useChapterLayout(book, epub, 0, surface, {
        enableResize: false,
        capturePosition,
      }),
    );
    await waitFor(() => expect(result.current.layout).toBe(l0));
    // Initial (blank) layout: nothing captured.
    expect(capturePosition).not.toHaveBeenCalled();
    expect(result.current.pendingRestore.current).toBeNull();

    await act(async () => {
      await result.current.recompute({ blank: false });
    });
    expect(capturePosition).toHaveBeenCalledTimes(1);
    expect(capturePosition).toHaveBeenCalledWith(l0);
    expect(result.current.layout).toBe(l1);
    expect(result.current.pendingRestore.current).toEqual(anchor);
  });

  it('does not capture on a blank (content-change) re-layout', async () => {
    const book = makeBook([mockLayout(6), mockLayout(6)]);
    const epub = makeEpub();
    const surface = { current: document.createElement('div') };
    const capturePosition = vi.fn(() => ({ paragraph: 0, charIndex: 0 }) as InChapterAnchor);
    const { result } = renderHook(() =>
      useChapterLayout(book, epub, 0, surface, {
        enableResize: false,
        capturePosition,
      }),
    );
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    await act(async () => {
      await result.current.recompute({ blank: true });
    });
    expect(capturePosition).not.toHaveBeenCalled();
    expect(result.current.pendingRestore.current).toBeNull();
  });

  it('forwards page-geometry overrides to computePageSize', async () => {
    const book = makeBook([mockLayout(6)]);
    const epub = makeEpub();
    const surface = { current: document.createElement('div') };
    const geometry = { gutterOffset: 0, headerOffset: 0 };
    renderHook(() =>
      useChapterLayout(book, epub, 0, surface, {
        enableResize: false,
        pageGeometry: () => geometry,
      }),
    );
    await waitFor(() =>
      expect(book.computePageSize).toHaveBeenCalledWith(surface.current, geometry),
    );
  });

  it('re-lays out the chapter with the new instance when the book is swapped', async () => {
    const l0 = mockLayout(6);
    const l1 = mockLayout(8);
    const bookA = makeBook([l0]);
    const bookB = makeBook([l1]);
    const epub = makeEpub();
    const surface = { current: document.createElement('div') };
    const { result, rerender } = renderHook(
      ({ book }: { book: MejiroBook }) =>
        useChapterLayout(book, epub, 0, surface, { enableResize: false }),
      { initialProps: { book: bookA } },
    );
    await waitFor(() => expect(result.current.layout).toBe(l0));

    rerender({ book: bookB });
    await waitFor(() => expect(result.current.layout).toBe(l1));
    expect(bookB.layoutChapter).toHaveBeenCalledTimes(1);
  });

  it('exposes pendingRestore as a writable ref', async () => {
    // `@types/react@18` models `RefObject.current` as read-only, so the hook's
    // own recipe — assign the consumed anchor back to `null` — must be typed
    // through a mutable ref to compile across the whole supported peer range.
    expectTypeOf<ReturnType<typeof useChapterLayout>['pendingRestore']>().toEqualTypeOf<
      MutableRefObject<InChapterAnchor | null>
    >();

    const book = makeBook([mockLayout(6)]);
    const epub = makeEpub();
    const surface = { current: document.createElement('div') };
    const { result } = renderHook(() =>
      useChapterLayout(book, epub, 0, surface, { enableResize: false }),
    );
    await waitFor(() => expect(result.current.layout).not.toBeNull());

    const anchor: InChapterAnchor = { paragraph: 1, charIndex: 2 };
    result.current.pendingRestore.current = anchor;
    expect(result.current.pendingRestore.current).toBe(anchor);
    result.current.pendingRestore.current = null;
    expect(result.current.pendingRestore.current).toBeNull();
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

  it('re-applies the exclusion to the layout that replaces the current one', () => {
    const first = mockLayout(4);
    const second = mockLayout(4);
    const onUpdate = vi.fn();
    const { result, rerender } = renderHook(
      ({ layout }: { layout: ChapterLayout }) => useImageOverlay(layout, 0, onUpdate),
      { initialProps: { layout: first } },
    );
    act(() => result.current.toggleImage());
    expect(first.syncImages).toHaveBeenCalledTimes(1);

    rerender({ layout: second });
    expect(second.syncImages).toHaveBeenCalledTimes(1);
    expect(second.syncImages).toHaveBeenCalledWith(0, [
      expect.objectContaining({ x: 80, y: 100, w: 120, h: 160 }),
    ]);
  });

  it('clears the outgoing spread and re-applies to the new one on a spread change', () => {
    const layout = mockLayout(8);
    const onUpdate = vi.fn();
    const { result, rerender } = renderHook(
      ({ spreadIdx }: { spreadIdx: number }) => useImageOverlay(layout, spreadIdx, onUpdate),
      { initialProps: { spreadIdx: 0 } },
    );
    act(() => result.current.toggleImage());
    const syncImages = layout.syncImages as ReturnType<typeof vi.fn>;
    syncImages.mockClear();
    onUpdate.mockClear();

    rerender({ spreadIdx: 1 });
    expect(syncImages.mock.calls[0]).toEqual([0, undefined]);
    expect(syncImages.mock.calls[1][0]).toBe(1);
    expect(syncImages.mock.calls[1][1]).toEqual([expect.objectContaining({ x: 80, y: 100 })]);
    // Only the spread now on screen is reported to the consumer.
    expect(onUpdate).toHaveBeenCalledTimes(1);
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
