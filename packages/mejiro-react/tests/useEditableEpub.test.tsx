// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { EditableEpub } from '@libraz/mejiro/epub';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEditableEpub } from '../src/useEditableEpub.js';
import {
  deferred,
  type HistoryEditorStub,
  mockEditableBook,
  mockHistoryEditor,
} from './helpers/fixtures.js';

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  // Only the loader is faked; the module's pure helpers (the preview
  // projection, the selection clamp) stay real.
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();
  const { mockEditableBook: stub } = await import('./helpers/fixtures.js');
  return {
    ...actual,
    parseEditableEpub: vi.fn(async () => stub('Editable', 'editable', 'second')),
  };
});

/** The mocked loader. */
async function loader(): Promise<ReturnType<typeof vi.fn>> {
  const { parseEditableEpub } = await import('@libraz/mejiro/epub');
  return parseEditableEpub as unknown as ReturnType<typeof vi.fn>;
}

describe('useEditableEpub (React)', () => {
  it('invokes onError when editable parsing fails', async () => {
    const onError = vi.fn();
    (await loader()).mockRejectedValueOnce(new Error('bad epub'));
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
    const stub = mockHistoryEditor('first') as { history: unknown };
    (await loader()).mockResolvedValueOnce(stub);
    const { result } = renderHook(() => useEditableEpub({ onExport }));

    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    expect(result.current.history?.canUndo).toBe(false);
    stub.history = { canUndo: true, canRedo: false, depth: 1, redoDepth: 0 };
    act(() => {
      result.current.updateParagraph({ text: 'second' });
    });
    expect(result.current.history?.canUndo).toBe(true);
    expect(result.current.selectedParagraph?.text).toBe('second');

    stub.history = { canUndo: false, canRedo: true, depth: 0, redoDepth: 1 };
    act(() => {
      expect(result.current.undo()).toBe(true);
    });
    expect(result.current.history?.canRedo).toBe(true);

    const exportedBytes = new Uint8Array(4);
    let resolveExport!: (bytes: Uint8Array) => void;
    const exportSpy = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveExport = resolve;
        }),
    );
    (result.current.editor as unknown as { export: typeof exportSpy }).export = exportSpy;

    let buffer: Uint8Array | null = null;
    let exportPromise!: Promise<Uint8Array | null>;
    act(() => {
      exportPromise = result.current.exportEpub({ onProgress });
    });
    expect(result.current.exporting).toBe(true);

    await act(async () => {
      resolveExport(exportedBytes);
      buffer = await exportPromise;
    });
    expect(result.current.exporting).toBe(false);
    expect(buffer).toBe(exportedBytes);
    expect(onExport).toHaveBeenCalledWith(buffer);
    expect(exportSpy).toHaveBeenCalledWith({ onProgress });
  });

  it('forwards parse limits to the editable loader', async () => {
    const loadMock = await loader();
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
    expect(loose.result.current.epub?.title).toBe('Large');
    expect(loadMock).toHaveBeenCalledWith(buffer, {
      limits: { maxTotalBytes: 10_000 },
      signal: expect.any(AbortSignal),
    });

    if (previous) loadMock.mockImplementation(previous);
  });

  it('tracks the selected paragraph through edits, undo and redo', async () => {
    const stub = mockHistoryEditor('first');
    (await loader()).mockImplementationOnce(async () => stub);
    const { result } = renderHook(() => useEditableEpub());

    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    const live = () => (stub as HistoryEditorStub).epub.chapters[0].blocks[0];
    expect(result.current.selectedParagraph?.text).toBe('first');

    act(() => {
      result.current.updateParagraph({ text: 'edited' });
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
      result.current.setSelection({ chapterIndex: 99, blockId: 'b-2' });
    });
    expect(result.current.selection).toEqual({ chapterIndex: 0, blockId: 'b-2' });
    expect(result.current.selectedParagraph?.text).toBe('second');

    act(() => {
      result.current.setSelection({ chapterIndex: -1, blockId: 'missing' });
    });
    expect(result.current.selection).toEqual({ chapterIndex: 0, blockId: 'b-1' });
    expect(result.current.selectedParagraph?.text).toBe('editable');
  });

  it('keeps previewEpub isolated from the editable source graph', async () => {
    const { result } = renderHook(() => useEditableEpub());

    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });

    const preview = result.current.previewEpub;
    const epub = result.current.epub;
    if (!(preview && epub)) throw new Error('missing editable book');

    expect(preview.chapters[0].paragraphs.map((p) => p.text)).toEqual(['editable', 'second']);
    preview.chapters[0].paragraphs[0].text = 'preview paragraph mutation';

    const sourceBlock = epub.chapters[0].blocks[0];
    if (sourceBlock.kind !== 'paragraph') throw new Error('missing paragraph block');
    expect(sourceBlock.text).toBe('editable');
  });

  it('forwards the addImage input to the selected chapter', async () => {
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
    expect(result.current.epub?.title).toBe('Editable');
    fetchSpy.mockRestore();
  });

  it('ignores stale editable load results', async () => {
    const loadMock = await loader();
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
    expect(result.current.epub?.title).toBe('Fast');

    await act(async () => {
      slow.resolve(mockEditableBook('Slow', 'slow'));
      await slowLoad;
    });
    expect(result.current.epub?.title).toBe('Fast');
    expect(result.current.selectedParagraph?.text).toBe('fast');
  });
});

describe('useEditableEpub (React) — same-tick actions', () => {
  type EditorStub = {
    updateParagraph: ReturnType<typeof vi.fn>;
    addImage: ReturnType<typeof vi.fn>;
  };

  it('edits the paragraph selected earlier in the same tick', async () => {
    const { result } = renderHook(() => useEditableEpub());
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    const editor = result.current.editor as unknown as EditorStub;

    act(() => {
      result.current.setSelection({ chapterIndex: 0, blockId: 'b-2' });
      result.current.updateParagraph({ text: 'replaced' });
      result.current.setInlineAnnotations([]);
    });

    expect(editor.updateParagraph).toHaveBeenCalledWith(0, 'b-2', { text: 'replaced' });
    expect(
      (result.current.editor as unknown as { setInlineAnnotations: ReturnType<typeof vi.fn> })
        .setInlineAnnotations,
    ).toHaveBeenCalledWith(0, 'b-2', []);
  });

  it('edits the editor whose load completed earlier in the same task', async () => {
    const { result } = renderHook(() => useEditableEpub());
    let loaded: EditableEpub | null = null;

    await act(async () => {
      loaded = await result.current.loadBuffer(new ArrayBuffer(8));
      result.current.addImage({ filename: 'figure.png', data: new Uint8Array([1]) });
    });

    expect((loaded as unknown as EditorStub).addImage).toHaveBeenCalledTimes(1);
  });
});

describe('useEditableEpub (React) — assetResolver option', () => {
  it('forwards the hook-level resolver to export, letting a per-call one win', async () => {
    const assetResolver = vi.fn(() => new Uint8Array([1]));
    const perCall = vi.fn(() => new Uint8Array([2]));
    const { result } = renderHook(() => useEditableEpub({ assetResolver }));
    await act(async () => {
      await result.current.loadBuffer(new ArrayBuffer(8));
    });
    const exportSpy = (result.current.editor as unknown as { export: ReturnType<typeof vi.fn> })
      .export;

    await act(async () => {
      await result.current.exportEpub();
      await result.current.exportEpub({ assetResolver: perCall });
    });

    expect(exportSpy).toHaveBeenNthCalledWith(1, { assetResolver });
    expect(exportSpy).toHaveBeenNthCalledWith(2, { assetResolver: perCall });
  });
});
