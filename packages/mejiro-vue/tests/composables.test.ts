// @vitest-environment happy-dom

import type { ChapterLayout, InChapterAnchor, MejiroBook, SpreadResult } from '@libraz/mejiro/book';
import { MejiroBook as MejiroBookClass } from '@libraz/mejiro/book';
import type { EditableEpub, EpubBook } from '@libraz/mejiro/epub';
import { describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, nextTick, ref, shallowRef } from 'vue';

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  // Only the loaders are faked; the module's pure helpers (the book clone the
  // preview relies on, the selection clamp) stay real.
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();

  return {
    ...actual,
    // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
    EditableEpub: {
      load: vi.fn(async () => ({
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
      })),
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

/**
 * Mounts a one-shot component that runs `setup()` inside `setup()` so the
 * composable has a valid component instance. Returns the result plus an
 * unmount helper.
 */
function withSetup<T>(setup: () => T): { result: T; unmount: () => void; app: App } {
  let result!: T;
  const app = createApp(
    defineComponent({
      setup() {
        result = setup();
        return () => null;
      },
    }),
  );
  app.mount(document.createElement('div'));
  return { result, unmount: () => app.unmount(), app };
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

describe('useMejiroBook (Vue)', () => {
  it('creates a stable MejiroBook instance and reflects initial options', () => {
    const { result, unmount } = withSetup(() =>
      useMejiroBook({ fontFamily: 'serif', fontSize: 16 }),
    );
    expect(result.book).toBeTruthy();
    expect(result.options.value.fontFamily).toBe('serif');
    expect(result.options.value.fontSize).toBe(16);
    unmount();
  });

  it('setOptions updates both the reactive snapshot and the underlying book', async () => {
    const { result, unmount } = withSetup(() =>
      useMejiroBook({ fontFamily: 'serif', fontSize: 16 }),
    );
    const settled = result.setOptions({ fontSize: 24 });
    // The reactive snapshot is the caller's intent, so it updates right away.
    expect(result.options.value.fontSize).toBe(24);
    // Font-affecting options reach the book once the font preload settles.
    await settled;
    expect(result.book.getOptions().fontSize).toBe(24);
    unmount();
  });

  it('reacts to a source ref when one is provided', async () => {
    const source = ref({ fontSize: 18 });
    const { result, unmount } = withSetup(() =>
      useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, source),
    );
    source.value = { fontSize: 22 };
    await nextTick();
    expect(result.options.value.fontSize).toBe(22);
    unmount();
  });

  it('coalesces rapid changes into a single book application while updating the snapshot at once', async () => {
    const spy = vi.spyOn(MejiroBookClass.prototype, 'setOptions');
    try {
      const { result, unmount } = withSetup(() =>
        useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, undefined, { debounceMs: 20 }),
      );
      const settled = Promise.all([
        result.setOptions({ fontSize: 17 }),
        result.setOptions({ fontSize: 18 }),
        result.setOptions({ lineSpacing: 2 }),
      ]);
      // The snapshot is the caller's intent, so it is never debounced.
      expect(result.options.value.fontSize).toBe(18);
      await settled;

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ fontSize: 18, lineSpacing: 2 });
      expect(result.book.getOptions().fontSize).toBe(18);
      unmount();
    } finally {
      spy.mockRestore();
    }
  });

  it('reports a failed application through onError and resolves the promise', async () => {
    const failure = new Error('font unavailable');
    const spy = vi.spyOn(MejiroBookClass.prototype, 'setOptions').mockRejectedValue(failure);
    const onError = vi.fn();
    try {
      const { result, unmount } = withSetup(() =>
        useMejiroBook({ fontFamily: 'serif', fontSize: 16 }, undefined, { onError }),
      );
      await expect(result.setOptions({ fontFamily: 'missing' })).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalledWith(failure);
      unmount();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('useEpub (Vue)', () => {
  it('starts with epub=null, loading=false, error=null', () => {
    const { result, unmount } = withSetup(() => useEpub());
    expect(result.epub.value).toBeNull();
    expect(result.loading.value).toBe(false);
    expect(result.error.value).toBeNull();
    unmount();
  });

  it('loadBuffer populates epub and toggles loading', async () => {
    const { result, unmount } = withSetup(() => useEpub());
    const book = await result.loadBuffer(new ArrayBuffer(8));
    expect(book?.title).toBe('Mocked');
    expect(result.epub.value?.title).toBe('Mocked');
    expect(result.loading.value).toBe(false);
    expect(result.error.value).toBeNull();
    unmount();
  });

  it('captures parser errors and surfaces them via the error ref', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result, unmount } = withSetup(() => useEpub());
    const book = await result.loadBuffer(new ArrayBuffer(8));
    expect(book).toBeNull();
    expect(result.epub.value).toBeNull();
    expect(result.error.value?.message).toBe('boom');
    unmount();
  });

  it('invokes onError when parsing fails', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const onError = vi.fn();
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result, unmount } = withSetup(() => useEpub({ onError }));
    await result.loadBuffer(new ArrayBuffer(8));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('boom');
    unmount();
  });

  it('setEpub replaces the current EPUB without going through the parser and clears stale errors', async () => {
    const { parseEpub } = await import('@libraz/mejiro/epub');
    (parseEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { result, unmount } = withSetup(() => useEpub());
    await result.loadBuffer(new ArrayBuffer(8));
    expect(result.error.value?.message).toBe('boom');

    result.setEpub({ title: 'Direct', author: 'X', chapters: [] });
    expect(result.epub.value?.title).toBe('Direct');
    expect(result.error.value).toBeNull();
    unmount();
  });

  it('invokes the onLoad callback after a successful loadBuffer', async () => {
    const onLoad = vi.fn();
    const { result, unmount } = withSetup(() => useEpub({ onLoad }));
    await result.loadBuffer(new ArrayBuffer(8));
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0].title).toBe('Mocked');
    unmount();
  });

  it('loadUrl returns null on a non-OK response without setting an error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { result, unmount } = withSetup(() => useEpub());
    const book = await result.loadUrl('/missing.epub');
    expect(book).toBeNull();
    expect(result.error.value).toBeNull();
    expect(result.epub.value).toBeNull();
    fetchSpy.mockRestore();
    unmount();
  });

  it('loadUrl captures network errors via the error ref', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const { result, unmount } = withSetup(() => useEpub());
    const book = await result.loadUrl('/x.epub');
    expect(book).toBeNull();
    expect(result.error.value?.message).toBe('offline');
    fetchSpy.mockRestore();
    unmount();
  });

  it('invokes onError when URL loading rejects', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const onError = vi.fn();
    const { result, unmount } = withSetup(() => useEpub({ onError }));
    const book = await result.loadUrl('/x.epub');
    expect(book).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('offline');
    fetchSpy.mockRestore();
    unmount();
  });

  it('auto-loads via defaultUrl on mount', async () => {
    const buf = new ArrayBuffer(8);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(buf, { status: 200 }));
    const onLoad = vi.fn();
    const { result, unmount } = withSetup(() => useEpub({ defaultUrl: '/auto.epub', onLoad }));
    // onMounted runs synchronously inside mount; flush the chained microtasks.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).toHaveBeenCalledWith('/auto.epub');
    expect(result.epub.value?.title).toBe('Mocked');
    expect(onLoad).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
    unmount();
  });

  it('reloads when a reactive defaultUrl getter changes', async () => {
    const url = ref('/one.epub');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { unmount } = withSetup(() =>
      useEpub({
        get defaultUrl() {
          return url.value;
        },
      }),
    );
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/one.epub'));

    url.value = '/two.epub';
    await nextTick();

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/two.epub'));
    fetchSpy.mockRestore();
    unmount();
  });
});

describe('useEpub (Vue) — parse limits', () => {
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
    const { result, unmount } = withSetup(() => useEpub({ limits: { maxTotalBytes: 2048 } }));

    const book = await result.loadBuffer(new ArrayBuffer(8));

    expect(book).toBeNull();
    expect(result.error.value?.message).toBe('EPUB archive is too large');
    restore();
    unmount();
  });

  it('accepts the same archive under a looser limit', async () => {
    const restore = await withLimitAwareParser();
    const { parseEpub } = await import('@libraz/mejiro/epub');
    const buffer = new ArrayBuffer(8);
    const { result, unmount } = withSetup(() => useEpub({ limits: { maxTotalBytes: 10_000 } }));

    const book = await result.loadBuffer(buffer);

    expect(book?.title).toBe('Large');
    expect(result.error.value).toBeNull();
    expect(parseEpub).toHaveBeenCalledWith(buffer, { limits: { maxTotalBytes: 10_000 } });
    restore();
    unmount();
  });
});

describe('useEditableEpub (Vue)', () => {
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

    const strict = withSetup(() => useEditableEpub({ limits: { maxTotalBytes: 2048 } }));
    await strict.result.loadBuffer(new ArrayBuffer(8));
    expect(strict.result.error.value?.message).toBe('EPUB archive is too large');
    strict.unmount();

    const buffer = new ArrayBuffer(8);
    const loose = withSetup(() => useEditableEpub({ limits: { maxTotalBytes: 10_000 } }));
    await loose.result.loadBuffer(buffer);
    expect(loose.result.book.value?.title).toBe('Large');
    expect(loadMock).toHaveBeenCalledWith(buffer, { limits: { maxTotalBytes: 10_000 } });
    loose.unmount();

    if (previous) loadMock.mockImplementation(previous);
  });

  it('invokes onError when editable parsing fails', async () => {
    const { EditableEpub } = await import('@libraz/mejiro/epub');
    const onError = vi.fn();
    (EditableEpub.load as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad epub'));
    const { result, unmount } = withSetup(() => useEditableEpub({ onError }));

    const editor = await result.loadBuffer(new ArrayBuffer(8));

    expect(editor).toBeNull();
    expect(result.error.value?.message).toBe('bad epub');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('bad epub');
    unmount();
  });

  it('auto-loads via defaultUrl on mount', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(new ArrayBuffer(8), { status: 200 }));
    const onLoad = vi.fn();
    const { result, unmount } = withSetup(() =>
      useEditableEpub({ defaultUrl: '/editable.epub', onLoad }),
    );

    await vi.waitFor(() => {
      expect(result.editor.value?.book.title).toBe('Editable');
    });
    expect(fetchSpy).toHaveBeenCalledWith('/editable.epub');
    expect(onLoad).toHaveBeenCalledTimes(1);
    unmount();
    fetchSpy.mockRestore();
  });

  it('exposes undo/redo history and forwards export options', async () => {
    const onExport = vi.fn();
    const onProgress = vi.fn();
    const { result, unmount } = withSetup(() => useEditableEpub({ onExport }));

    await result.loadBuffer(new ArrayBuffer(8));
    expect(result.history.value?.canUndo).toBe(true);
    expect(result.selectedParagraph.value?.text).toBe('editable');

    result.setSelection({ chapter: 0, paragraph: 1 });
    expect(result.selectedParagraph.value?.text).toBe('second');

    expect(result.undo()).toBe(true);
    expect(result.history.value?.canRedo).toBe(true);

    const exportedBuffer = new ArrayBuffer(4);
    let resolveExport!: (buffer: ArrayBuffer) => void;
    const exportSpy = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveExport = resolve;
        }),
    );
    (result.editor.value as { export: typeof exportSpy }).export = exportSpy;

    const exportPromise = result.exportEpub({ onProgress });
    expect(result.exporting.value).toBe(true);

    resolveExport(exportedBuffer);
    const buffer = await exportPromise;
    await nextTick();
    expect(result.exporting.value).toBe(false);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(onExport).toHaveBeenCalledWith(buffer);
    expect(exportSpy).toHaveBeenCalledWith({ onProgress });
    unmount();
  });

  it('tracks the selected paragraph through edits, undo and redo', async () => {
    const { EditableEpub } = await import('@libraz/mejiro/epub');
    const stub = mockHistoryEditor('first');
    (EditableEpub.load as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => stub);
    const { result, unmount } = withSetup(() => useEditableEpub());

    await result.loadBuffer(new ArrayBuffer(8));
    const live = () => (stub as HistoryEditorStub).book.chapters[0].paragraphs[0];
    expect(result.selectedParagraph.value?.text).toBe('first');

    result.updateParagraph('edited');
    expect(result.selectedParagraph.value?.text).toBe('edited');
    expect(result.selectedParagraph.value).toBe(live());

    expect(result.undo()).toBe(true);
    expect(result.selectedParagraph.value?.text).toBe('first');
    expect(result.selectedParagraph.value).toBe(live());

    expect(result.redo()).toBe(true);
    expect(result.selectedParagraph.value?.text).toBe('edited');
    expect(result.selectedParagraph.value).toBe(live());
    unmount();
  });

  it('clamps public selection to the loaded editable book', async () => {
    const { result, unmount } = withSetup(() => useEditableEpub());

    await result.loadBuffer(new ArrayBuffer(8));

    result.setSelection({ chapter: 99, paragraph: 99 });
    expect(result.selection.value).toEqual({ chapter: 0, paragraph: 1 });
    expect(result.selectedParagraph.value?.text).toBe('second');

    result.setSelection({ chapter: -1, paragraph: 0.8 });
    expect(result.selection.value).toEqual({ chapter: 0, paragraph: 0 });
    expect(result.selectedParagraph.value?.text).toBe('editable');
    unmount();
  });

  it('keeps previewBook isolated from the editable source graph', async () => {
    const { result, unmount } = withSetup(() => useEditableEpub());

    await result.loadBuffer(new ArrayBuffer(8));

    const preview = result.previewBook.value;
    const book = result.book.value;
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
    unmount();
  });

  it('forwards the v0.5 addImage input shape', async () => {
    const { result, unmount } = withSetup(() => useEditableEpub());

    await result.loadBuffer(new ArrayBuffer(8));
    const image = {
      filename: 'inserted.png',
      data: new Uint8Array([1, 2, 3]),
      alt: 'Inserted',
      caption: 'Caption',
    };

    result.addImage(image);

    expect(result.editor.value?.addImage).toHaveBeenCalledWith(0, image);
    unmount();
  });

  it('keeps loading true while loadUrl fetches an editable EPUB', async () => {
    const response = deferred<Response>();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(response.promise);
    const { result, unmount } = withSetup(() => useEditableEpub());

    const loadPromise = result.loadUrl('/editable.epub');
    expect(result.loading.value).toBe(true);

    response.resolve(new Response(new ArrayBuffer(8), { status: 200 }));
    await loadPromise;
    expect(result.loading.value).toBe(false);
    expect(result.book.value?.title).toBe('Editable');
    fetchSpy.mockRestore();
    unmount();
  });

  it('ignores stale editable load results', async () => {
    const { EditableEpub } = await import('@libraz/mejiro/epub');
    const loadMock = EditableEpub.load as ReturnType<typeof vi.fn>;
    const slow = deferred<unknown>();
    loadMock
      .mockImplementationOnce(async () => slow.promise)
      .mockImplementationOnce(async () => mockEditableBook('Fast', 'fast'));
    const { result, unmount } = withSetup(() => useEditableEpub());

    const slowLoad: Promise<EditableEpub | null> = result.loadBuffer(new ArrayBuffer(8));
    const fastLoad: Promise<EditableEpub | null> = result.loadBuffer(new ArrayBuffer(8));

    await fastLoad;
    expect(result.book.value?.title).toBe('Fast');

    slow.resolve(mockEditableBook('Slow', 'slow'));
    await slowLoad;
    expect(result.book.value?.title).toBe('Fast');
    expect(result.selectedParagraph.value?.text).toBe('fast');
    unmount();
  });
});

describe('useSpread (Vue)', () => {
  it('returns idle state when layout is null', () => {
    const layoutRef = ref<ChapterLayout | null>(null);
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDuration: 0 }));
    expect(result.spread.value).toBeNull();
    expect(result.totalPages.value).toBe(0);
    expect(result.totalSpreads.value).toBe(1);
    unmount();
  });

  it('refreshes spread when layout becomes available', async () => {
    const layoutRef = ref<ChapterLayout | null>(null);
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDuration: 0 }));
    layoutRef.value = mockLayout(6);
    await nextTick();
    expect(result.spread.value).not.toBeNull();
    expect(result.totalPages.value).toBe(6);
    expect(result.totalSpreads.value).toBe(3);
    unmount();
  });

  it('exposes the spread immediately when mounted with a non-null layout', () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDuration: 0 }));

    // No tick awaited: the composable must be usable as soon as it returns.
    const layout = layoutRef.value as ChapterLayout & { getSpread: ReturnType<typeof vi.fn> };
    expect(result.spread.value).not.toBeNull();
    expect(result.spread.value).toEqual(layout.getSpread(result.spreadIdx.value));
    expect(result.totalPages.value).toBe(6);
    unmount();
  });

  it('next/prev/goTo move the spread index and call onChange', async () => {
    const onChange = vi.fn();
    const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
    const { result, unmount } = withSetup(() =>
      useSpread(layoutRef, { turnDuration: 0, onChange }),
    );
    await nextTick();

    result.next();
    await nextTick();
    expect(result.spreadIdx.value).toBe(1);

    result.next();
    await nextTick();
    expect(result.spreadIdx.value).toBe(2);

    result.prev();
    await nextTick();
    expect(result.spreadIdx.value).toBe(1);

    result.goTo(99);
    await nextTick();
    expect(result.spreadIdx.value).toBe(2);

    result.goTo(-5);
    await nextTick();
    expect(result.spreadIdx.value).toBe(0);

    expect(onChange).toHaveBeenCalled();
    unmount();
  });

  it('moves on ArrowLeft / ArrowRight when enableKeyboard is set', async () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
    const { result, unmount } = withSetup(() =>
      useSpread(layoutRef, { turnDuration: 0, enableKeyboard: true }),
    );
    await nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(result.spreadIdx.value).toBe(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await nextTick();
    expect(result.spreadIdx.value).toBe(0);

    unmount();
  });

  it('leaves arrow keys to editable fields, modifiers and handled events', async () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDuration: 0 }));
    await nextTick();

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    for (const el of [input, textarea, editable]) document.body.appendChild(el);
    const preventer = (e: Event) => e.preventDefault();

    try {
      for (const el of [input, textarea, editable]) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        await nextTick();
        expect(result.spreadIdx.value).toBe(0);
      }

      for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', [modifier]: true }));
        await nextTick();
        expect(result.spreadIdx.value).toBe(0);
      }

      document.body.addEventListener('keydown', preventer);
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
      );
      await nextTick();
      expect(result.spreadIdx.value).toBe(0);
      document.body.removeEventListener('keydown', preventer);

      // A plain arrow key on the page still turns the spread.
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
      await nextTick();
      expect(result.spreadIdx.value).toBe(1);
    } finally {
      document.body.removeEventListener('keydown', preventer);
      for (const el of [input, textarea, editable]) el.remove();
      unmount();
    }
  });

  it('follows enableKeyboard when it flips at runtime', async () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
    const enableKeyboard = ref(true);
    const { result, unmount } = withSetup(() =>
      useSpread(layoutRef, { turnDuration: 0, enableKeyboard }),
    );
    await nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(result.spreadIdx.value).toBe(1);

    enableKeyboard.value = false;
    await nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(result.spreadIdx.value).toBe(1);

    enableKeyboard.value = true;
    await nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await nextTick();
    expect(result.spreadIdx.value).toBe(2);

    unmount();
  });

  it('refresh() re-fetches the spread at the current index', async () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDuration: 0 }));
    await nextTick();
    const layout = layoutRef.value as ChapterLayout & { getSpread: ReturnType<typeof vi.fn> };
    const callsBefore = layout.getSpread.mock.calls.length;
    result.refresh();
    expect(layout.getSpread.mock.calls.length).toBe(callsBefore + 1);
    unmount();
  });

  it('flips `turning` true while the page-turn animation is in flight', async () => {
    vi.useFakeTimers();
    try {
      const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
      const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDuration: 180 }));
      await nextTick();
      result.next();
      // The setTimeout has not yet fired — `turning` is on.
      expect(result.turning.value).toBe(true);
      expect(result.spreadIdx.value).toBe(0);

      vi.advanceTimersByTime(180);
      await nextTick();
      expect(result.turning.value).toBe(false);
      expect(result.spreadIdx.value).toBe(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a pending page-turn timer when disposed without keyboard listeners', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
      const { result, unmount } = withSetup(() =>
        useSpread(layoutRef, { turnDuration: 180, enableKeyboard: false, onChange }),
      );
      await nextTick();
      result.next();
      unmount();
      vi.advanceTimersByTime(180);
      expect(onChange).not.toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('setSpread jumps immediately (no turn animation) and clamps to range', async () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
    const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDuration: 180 }));
    await nextTick();

    result.setSpread(2);
    await nextTick();
    expect(result.spreadIdx.value).toBe(2);
    expect(result.turning.value).toBe(false);

    result.setSpread(99);
    await nextTick();
    expect(result.spreadIdx.value).toBe(2); // clamped to totalSpreads − 1

    result.setSpread(-5);
    await nextTick();
    expect(result.spreadIdx.value).toBe(0);
    unmount();
  });

  it('setSpread cancels an in-flight page-turn animation', async () => {
    vi.useFakeTimers();
    try {
      const layoutRef = ref<ChapterLayout | null>(mockLayout(6));
      const { result, unmount } = withSetup(() => useSpread(layoutRef, { turnDuration: 180 }));
      await nextTick();
      result.goTo(2);
      expect(result.turning.value).toBe(true);

      // An immediate setSpread should win and clear the pending animation.
      result.setSpread(1);
      await nextTick();
      expect(result.turning.value).toBe(false);
      expect(result.spreadIdx.value).toBe(1);

      // The superseded goTo timer must not fire afterwards.
      vi.advanceTimersByTime(180);
      await nextTick();
      expect(result.spreadIdx.value).toBe(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useChapterLayout (Vue)', () => {
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
  // Flush the immediate (sync) layout watch plus the async `layoutChapter`.
  async function flush(): Promise<void> {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('captures the reading position before a reflow and restores it into the new layout', async () => {
    const l0 = mockLayout(6);
    const l1 = mockLayout(8);
    const book = makeBook([l0, l1]);
    const surface = ref<HTMLElement | null>(document.createElement('div'));
    const anchor: InChapterAnchor = { paragraph: 0, charIndex: 5 };
    const capturePosition = vi.fn(() => anchor);
    const restorePosition = vi.fn();

    const { result, unmount } = withSetup(() =>
      useChapterLayout(book, ref<EpubBook | null>(makeEpub()), ref(0), surface, {
        enableResize: false,
        capturePosition,
        restorePosition,
      }),
    );
    await flush();
    // Initial (blank) layout: position hooks are not invoked.
    expect(result.layout.value).toBe(l0);
    expect(capturePosition).not.toHaveBeenCalled();
    expect(restorePosition).not.toHaveBeenCalled();

    // A reflow captures from the outgoing layout and restores into the new one.
    await result.recompute({ blank: false });
    expect(capturePosition).toHaveBeenCalledTimes(1);
    expect(capturePosition).toHaveBeenCalledWith(l0);
    expect(restorePosition).toHaveBeenCalledTimes(1);
    expect(restorePosition).toHaveBeenCalledWith(l1, anchor);
    expect(result.layout.value).toBe(l1);
    unmount();
  });

  it('does not capture/restore on a blank (content-change) re-layout', async () => {
    const book = makeBook([mockLayout(6), mockLayout(6)]);
    const surface = ref<HTMLElement | null>(document.createElement('div'));
    const capturePosition = vi.fn(() => ({ paragraph: 0, charIndex: 0 }) as InChapterAnchor);
    const restorePosition = vi.fn();
    const { result, unmount } = withSetup(() =>
      useChapterLayout(book, ref<EpubBook | null>(makeEpub()), ref(0), surface, {
        enableResize: false,
        capturePosition,
        restorePosition,
      }),
    );
    await flush();
    await result.recompute({ blank: true });
    expect(capturePosition).not.toHaveBeenCalled();
    expect(restorePosition).not.toHaveBeenCalled();
    unmount();
  });

  it('forwards page-geometry overrides to computePageSize', async () => {
    const book = makeBook([mockLayout(6)]);
    const surface = ref<HTMLElement | null>(document.createElement('div'));
    const geometry = { gutterOffset: 0, headerOffset: 0 };
    const { unmount } = withSetup(() =>
      useChapterLayout(book, ref<EpubBook | null>(makeEpub()), ref(0), surface, {
        enableResize: false,
        pageGeometry: () => geometry,
      }),
    );
    await flush();
    expect(book.computePageSize).toHaveBeenCalledWith(surface.value, geometry);
    unmount();
  });

  it('re-lays out the chapter with the new instance when the book ref is swapped', async () => {
    const l0 = mockLayout(6);
    const l1 = mockLayout(8);
    const bookA = makeBook([l0]);
    const bookB = makeBook([l1]);
    const book = shallowRef(bookA);
    const surface = ref<HTMLElement | null>(document.createElement('div'));
    const { result, unmount } = withSetup(() =>
      useChapterLayout(book, ref<EpubBook | null>(makeEpub()), ref(0), surface, {
        enableResize: false,
      }),
    );
    await flush();
    expect(result.layout.value).toBe(l0);

    book.value = bookB;
    await flush();
    expect(bookB.layoutChapter).toHaveBeenCalledTimes(1);
    expect(result.layout.value).toBe(l1);
    unmount();
  });
});

describe('useMultiImageOverlay (Vue)', () => {
  it('starts empty and toggles hasImages once an image is added', () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIdx = ref(0);
    const { result, unmount } = withSetup(() => useMultiImageOverlay(layoutRef, spreadIdx));
    expect(result.imagesBySpread.value.size).toBe(0);
    expect(result.hasImages.value).toBe(false);

    const item = result.addImage();
    expect(result.hasImages.value).toBe(true);
    expect(result.currentImages.value).toHaveLength(1);
    expect(item.id).toMatch(/^mejiro-img-/);
    unmount();
  });

  it('calls layout.setImages with the per-spread image list after add', () => {
    const layout = mockLayout(4);
    const layoutRef = ref<ChapterLayout | null>(layout);
    const spreadIdx = ref(0);
    const { result, unmount } = withSetup(() => useMultiImageOverlay(layoutRef, spreadIdx));
    result.addImage({ x: 1, y: 2, w: 3, h: 4 });
    expect(layout.setImages).toHaveBeenCalledWith(0, [
      expect.objectContaining({ x: 1, y: 2, w: 3, h: 4 }),
    ]);
    unmount();
  });

  it('removeImage removes by id and updateImage merges rect changes', () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIdx = ref(0);
    const { result, unmount } = withSetup(() => useMultiImageOverlay(layoutRef, spreadIdx));
    const a = result.addImage({ x: 10, y: 10, w: 50, h: 50 });
    const b = result.addImage({ x: 20, y: 20, w: 60, h: 60 });

    result.updateImage(b.id, { x: 99 });
    expect(result.currentImages.value.find((i) => i.id === b.id)?.rect.x).toBe(99);

    result.removeImage(a.id);
    expect(result.currentImages.value).toHaveLength(1);
    expect(result.currentImages.value[0].id).toBe(b.id);
    unmount();
  });

  it('syncs the affected spread when updating or removing an image on a non-current spread', () => {
    const layout = mockLayout(4);
    const layoutRef = ref<ChapterLayout | null>(layout);
    const spreadIdx = ref(0);
    const { result, unmount } = withSetup(() => useMultiImageOverlay(layoutRef, spreadIdx));
    const onSpread0 = result.addImage({ x: 10 });
    spreadIdx.value = 1;
    const onSpread1 = result.addImage({ x: 20 });
    vi.mocked(layout.setImages).mockClear();

    result.updateImage(onSpread0.id, { x: 99 });
    expect(layout.setImages).toHaveBeenLastCalledWith(0, [expect.objectContaining({ x: 99 })]);

    result.removeImage(onSpread0.id);
    expect(layout.setImages).toHaveBeenLastCalledWith(0, []);
    expect(result.currentImages.value).toEqual([onSpread1]);
    unmount();
  });

  it('clearImages() without arg removes every image across spreads', () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIdx = ref(0);
    const { result, unmount } = withSetup(() => useMultiImageOverlay(layoutRef, spreadIdx));
    result.addImage();
    spreadIdx.value = 1;
    result.addImage();
    expect(result.imagesBySpread.value.size).toBe(2);
    result.clearImages();
    expect(result.imagesBySpread.value.size).toBe(0);
    expect(result.hasImages.value).toBe(false);
    unmount();
  });

  it('clearImages(idx) only removes images on the target spread', () => {
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIdx = ref(0);
    const { result, unmount } = withSetup(() => useMultiImageOverlay(layoutRef, spreadIdx));
    result.addImage();
    spreadIdx.value = 1;
    result.addImage();
    result.clearImages(0);
    expect(result.imagesBySpread.value.has(0)).toBe(false);
    expect(result.imagesBySpread.value.has(1)).toBe(true);
    unmount();
  });

  it('removes active drag listeners when disposed mid-drag', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIdx = ref(0);
    const { result, unmount } = withSetup(() => useMultiImageOverlay(layoutRef, spreadIdx));
    const item = result.addImage();
    const target = Object.assign(document.createElement('div'), { setPointerCapture: vi.fn() });

    result.onOverlayPointerDown(item.id, {
      preventDefault: vi.fn(),
      clientX: 0,
      clientY: 0,
      currentTarget: target,
      pointerId: 1,
    } as unknown as PointerEvent);
    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe('useImageOverlay (Vue, single)', () => {
  it('toggle adds then clears the rect and calls syncImages each time', () => {
    const layout = mockLayout(4);
    const layoutRef = ref<ChapterLayout | null>(layout);
    const spreadIdx = ref(0);
    const onUpdate = vi.fn();
    const { result, unmount } = withSetup(() =>
      useImageOverlay(layoutRef, spreadIdx, onUpdate, { defaultX: 5 }),
    );

    expect(result.hasImage.value).toBe(false);

    result.toggleImage();
    expect(result.hasImage.value).toBe(true);
    expect(result.imageRect.value?.x).toBe(5);
    expect(layout.syncImages).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    result.toggleImage();
    expect(result.hasImage.value).toBe(false);
    expect(result.imageRect.value).toBeNull();
    expect(layout.syncImages).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('re-applies the exclusion to the layout that replaces the current one', async () => {
    const first = mockLayout(4);
    const second = mockLayout(4);
    const layoutRef = shallowRef<ChapterLayout | null>(first);
    const spreadIdx = ref(0);
    const onUpdate = vi.fn();
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, spreadIdx, onUpdate));

    result.toggleImage();
    expect(first.syncImages).toHaveBeenCalledTimes(1);

    layoutRef.value = second;
    await nextTick();
    expect(second.syncImages).toHaveBeenCalledTimes(1);
    expect(second.syncImages).toHaveBeenCalledWith(0, [
      expect.objectContaining({ x: 80, y: 100, w: 120, h: 160 }),
    ]);
    unmount();
  });

  it('clears the outgoing spread and re-applies to the new one on a spread change', async () => {
    const layout = mockLayout(8);
    const layoutRef = shallowRef<ChapterLayout | null>(layout);
    const spreadIdx = ref(0);
    const onUpdate = vi.fn();
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, spreadIdx, onUpdate));

    result.toggleImage();
    const syncImages = layout.syncImages as ReturnType<typeof vi.fn>;
    syncImages.mockClear();
    onUpdate.mockClear();

    spreadIdx.value = 1;
    await nextTick();
    expect(syncImages.mock.calls[0]).toEqual([0, undefined]);
    expect(syncImages.mock.calls[1][0]).toBe(1);
    expect(syncImages.mock.calls[1][1]).toEqual([expect.objectContaining({ x: 80, y: 100 })]);
    // Only the spread now on screen is reported to the consumer.
    expect(onUpdate).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('removes active drag listeners when disposed mid-drag', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const layoutRef = ref<ChapterLayout | null>(mockLayout(4));
    const spreadIdx = ref(0);
    const { result, unmount } = withSetup(() => useImageOverlay(layoutRef, spreadIdx, vi.fn()));
    result.toggleImage();
    const target = Object.assign(document.createElement('div'), { setPointerCapture: vi.fn() });

    result.onOverlayPointerDown({
      preventDefault: vi.fn(),
      clientX: 0,
      clientY: 0,
      currentTarget: target,
      pointerId: 1,
    } as unknown as PointerEvent);
    expect(addSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
