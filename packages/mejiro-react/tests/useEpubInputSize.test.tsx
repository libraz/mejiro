// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEditableEpub } from '../src/useEditableEpub.js';
import { useEpub } from '../src/useEpub.js';
import { spiedEpubFile } from './helpers/fixtures.js';

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

describe('EPUB file loaders (React) — input size', () => {
  it('useEpub rejects a file over maxInputBytes without reading it', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useEpub({ limits: { maxInputBytes: 4 }, onError }));
    const { file, read } = spiedEpubFile(8);

    await act(async () => {
      expect(await result.current.loadFile(file)).toBeNull();
    });

    expect(read).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe('EPUB exceeds the compressed input limit (4 bytes)');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('useEditableEpub rejects a file over maxInputBytes without reading it', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useEditableEpub({ limits: { maxInputBytes: 4 }, onError }));
    const { file, read } = spiedEpubFile(8);

    await act(async () => {
      expect(await result.current.loadFile(file)).toBeNull();
    });

    expect(read).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe('EPUB exceeds the compressed input limit (4 bytes)');
    expect(result.current.loading).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reads a file within the limit', async () => {
    const { result } = renderHook(() => useEpub({ limits: { maxInputBytes: 8 } }));
    const { file, read } = spiedEpubFile(8);

    await act(async () => {
      await result.current.loadFile(file);
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});
