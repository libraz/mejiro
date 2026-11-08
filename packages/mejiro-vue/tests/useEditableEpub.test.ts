// @vitest-environment happy-dom

import type { EditableEpub } from '@libraz/mejiro/epub';
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useEditableEpub } from '../src/useEditableEpub.js';
import {
  deferred,
  type HistoryEditorStub,
  mockEditableBook,
  mockHistoryEditor,
  withSetup,
} from './helpers/fixtures.js';

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  // Only the loader is faked; the module's pure helpers (the preview projection,
  // the selection clamp) stay real.
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();
  const { mockEditableBook } = await import('./helpers/fixtures.js');

  return {
    ...actual,
    parseEditableEpub: vi.fn(async () => {
      const editor = mockEditableBook('Editable', 'editable', 'second') as {
        history: unknown;
        subscribe: ReturnType<typeof vi.fn>;
        undo: ReturnType<typeof vi.fn>;
        redo: ReturnType<typeof vi.fn>;
      };
      // Undo and redo notify subscribers, as the core editor does.
      const notify = () => {
        for (const [listener] of editor.subscribe.mock.calls) listener();
      };
      editor.history = { canUndo: true, canRedo: false, depth: 1, redoDepth: 0 };
      editor.undo.mockImplementation(() => {
        editor.history = { canUndo: false, canRedo: true, depth: 0, redoDepth: 1 };
        notify();
        return true;
      });
      editor.redo.mockImplementation(() => {
        editor.history = { canUndo: true, canRedo: false, depth: 1, redoDepth: 0 };
        notify();
        return true;
      });
      return editor;
    }),
  };
});

describe('useEditableEpub (Vue)', () => {
  it('forwards parse limits to the editable loader', async () => {
    const { parseEditableEpub } = await import('@libraz/mejiro/epub');
    const loadMock = parseEditableEpub as ReturnType<typeof vi.fn>;
    const previous = loadMock.getMockImplementation();
    loadMock.mockImplementation(
      async (_bytes: ArrayBuffer, options?: { limits?: { maxTotalBytes?: number } }) => {
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
    expect(loose.result.epub.value?.title).toBe('Large');
    expect(loadMock).toHaveBeenCalledWith(buffer, {
      limits: { maxTotalBytes: 10_000 },
      signal: expect.any(AbortSignal),
    });
    loose.unmount();

    if (previous) loadMock.mockImplementation(previous);
  });

  it('invokes onError when editable parsing fails', async () => {
    const { parseEditableEpub } = await import('@libraz/mejiro/epub');
    const onError = vi.fn();
    (parseEditableEpub as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad epub'));
    const { result, unmount } = withSetup(() => useEditableEpub({ onError }));

    const editor = await result.loadBuffer(new ArrayBuffer(8));

    expect(editor).toBeNull();
    expect(result.error.value?.message).toBe('bad epub');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('bad epub');
    unmount();
  });

  it('auto-loads via url on mount', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(new ArrayBuffer(8), { status: 200 }));
    const onLoad = vi.fn();
    const { result, unmount } = withSetup(() => useEditableEpub({ url: '/editable.epub', onLoad }));

    await vi.waitFor(() => {
      expect(result.editor.value?.epub.title).toBe('Editable');
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/editable.epub',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
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

    result.setSelection({ chapterIndex: 0, blockId: 'b-2' });
    expect(result.selectedParagraph.value?.text).toBe('second');

    expect(result.undo()).toBe(true);
    expect(result.history.value?.canRedo).toBe(true);

    const exportedBytes = new Uint8Array(4);
    let resolveExport!: (bytes: Uint8Array) => void;
    const exportSpy = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveExport = resolve;
        }),
    );
    (result.editor.value as { export: typeof exportSpy }).export = exportSpy;

    const exportPromise = result.exportEpub({ onProgress });
    expect(result.exporting.value).toBe(true);

    resolveExport(exportedBytes);
    const bytes = await exportPromise;
    await nextTick();
    expect(result.exporting.value).toBe(false);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(onExport).toHaveBeenCalledWith(bytes);
    expect(exportSpy).toHaveBeenCalledWith({ onProgress });
    unmount();
  });

  it('tracks the selected paragraph through edits, undo and redo', async () => {
    const { parseEditableEpub } = await import('@libraz/mejiro/epub');
    const stub = mockHistoryEditor('first');
    (parseEditableEpub as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => stub);
    const { result, unmount } = withSetup(() => useEditableEpub());

    await result.loadBuffer(new ArrayBuffer(8));
    const live = () => (stub as HistoryEditorStub).epub.chapters[0].blocks[0];
    expect(result.selectedParagraph.value?.text).toBe('first');

    result.updateParagraph({ text: 'edited' });
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

    result.setSelection({ chapterIndex: -1, blockId: 'b-2' });
    expect(result.selection.value).toEqual({ chapterIndex: 0, blockId: 'b-2' });
    expect(result.selectedParagraph.value?.text).toBe('second');

    result.setSelection({ chapterIndex: 99, blockId: 'missing' });
    expect(result.selection.value).toEqual({ chapterIndex: 0, blockId: 'b-1' });
    expect(result.selectedParagraph.value?.text).toBe('editable');
    unmount();
  });

  it('keeps previewEpub isolated from the editable source graph', async () => {
    const { result, unmount } = withSetup(() => useEditableEpub());

    await result.loadBuffer(new ArrayBuffer(8));

    const preview = result.previewEpub.value;
    const epub = result.epub.value;
    if (!(preview && epub)) throw new Error('missing editable book');

    expect(preview.chapters[0].paragraphs.map((p) => p.text)).toEqual(['editable', 'second']);
    const sourceBlock = epub.chapters[0].blocks[0];
    if (sourceBlock.kind !== 'paragraph') throw new Error('missing paragraph block');

    (preview.chapters[0].paragraphs[0] as { text: string }).text = 'preview paragraph mutation';

    expect(sourceBlock.text).toBe('editable');
    unmount();
  });

  it('inserts an image into the selected chapter and returns the created block', async () => {
    const { result, unmount } = withSetup(() => useEditableEpub());

    await result.loadBuffer(new ArrayBuffer(8));
    const image = {
      filename: 'inserted.png',
      data: new Uint8Array([1, 2, 3]),
      alt: 'Inserted',
      caption: 'Caption',
    };

    const block = result.addImage(image);

    expect(result.editor.value?.addImage).toHaveBeenCalledWith(0, image);
    expect(block).toMatchObject({ kind: 'image', assetKey: 'inserted.png' });
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
    expect(result.epub.value?.title).toBe('Editable');
    fetchSpy.mockRestore();
    unmount();
  });

  it('ignores stale editable load results', async () => {
    const { parseEditableEpub } = await import('@libraz/mejiro/epub');
    const loadMock = parseEditableEpub as ReturnType<typeof vi.fn>;
    const slow = deferred<unknown>();
    loadMock
      .mockImplementationOnce(async () => slow.promise)
      .mockImplementationOnce(async () => mockEditableBook('Fast', 'fast'));
    const { result, unmount } = withSetup(() => useEditableEpub());

    const slowLoad: Promise<EditableEpub | null> = result.loadBuffer(new ArrayBuffer(8));
    const fastLoad: Promise<EditableEpub | null> = result.loadBuffer(new ArrayBuffer(8));

    await fastLoad;
    expect(result.epub.value?.title).toBe('Fast');

    slow.resolve(mockEditableBook('Slow', 'slow'));
    await slowLoad;
    expect(result.epub.value?.title).toBe('Fast');
    expect(result.selectedParagraph.value?.text).toBe('fast');
    unmount();
  });
});

describe('useEditableEpub (Vue) — same-tick actions', () => {
  it('edits the paragraph selected earlier in the same tick', async () => {
    const { result, unmount } = withSetup(() => useEditableEpub());
    await result.loadBuffer(new ArrayBuffer(8));
    const editor = result.editor.value as unknown as {
      updateParagraph: ReturnType<typeof vi.fn>;
      setInlineAnnotations: ReturnType<typeof vi.fn>;
    };

    result.setSelection({ chapterIndex: 0, blockId: 'b-2' });
    result.updateParagraph({ text: 'replaced' });
    result.setInlineAnnotations([]);

    expect(editor.updateParagraph).toHaveBeenCalledWith(0, 'b-2', { text: 'replaced' });
    expect(editor.setInlineAnnotations).toHaveBeenCalledWith(0, 'b-2', []);
    unmount();
  });
});

describe('useEditableEpub (Vue) — assetResolver option', () => {
  it('forwards the composable-level resolver to export, letting a per-call one win', async () => {
    const assetResolver = vi.fn(() => new Uint8Array([1]));
    const perCall = vi.fn(() => new Uint8Array([2]));
    const { result, unmount } = withSetup(() => useEditableEpub({ assetResolver }));
    await result.loadBuffer(new ArrayBuffer(8));
    const exportSpy = (result.editor.value as unknown as { export: ReturnType<typeof vi.fn> })
      .export;

    await result.exportEpub();
    await result.exportEpub({ assetResolver: perCall });

    expect(exportSpy).toHaveBeenNthCalledWith(1, { assetResolver });
    expect(exportSpy).toHaveBeenNthCalledWith(2, { assetResolver: perCall });
    unmount();
  });
});
