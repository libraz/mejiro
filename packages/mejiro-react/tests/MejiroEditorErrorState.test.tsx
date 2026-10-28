// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { EditableEpub } from '@libraz/mejiro/epub';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const readerState = vi.hoisted(() => ({
  props: [] as Array<{ onError?: (error: Error) => void }>,
}));

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: forwardRef<unknown, { onError?: (error: Error) => void }>(
    function FakeReader(props, ref) {
      readerState.props.push(props);
      useImperativeHandle(ref, () => ({ goToAnchor: async () => {} }), []);
      return <div className="fake-reader" />;
    },
  ),
}));

const exportMock = vi.hoisted(() => vi.fn(async () => new ArrayBuffer(8)));
const loadMock = vi.hoisted(() => vi.fn());

vi.mock('@libraz/mejiro/epub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@libraz/mejiro/epub')>()),
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
  EditableEpub: { load: loadMock },
  exportEditableEpub: exportMock,
}));

import { MejiroEditor } from '../src/MejiroEditor.js';

function stubEditor(): EditableEpub {
  const book = {
    title: 'Book',
    author: 'A',
    chapters: [
      {
        title: 'Ch1',
        href: 'OPS/Text/ch1.xhtml',
        paragraphs: [{ text: 'abcdef', inlineAnnotations: [] }],
        blocks: [{ kind: 'paragraph', id: 'b-1', text: 'abcdef', inlineAnnotations: [] }],
        imageAssets: new Map(),
      },
    ],
    packageData: { rootfilePath: 'OPS/package.opf', opfDir: 'OPS/', opfXml: '', files: new Map() },
  };
  return {
    book,
    title: book.title,
    author: book.author,
    updateParagraph: vi.fn(),
    transaction: (fn: () => void) => fn(),
    addImage: vi.fn(),
  } as unknown as EditableEpub;
}

async function renderEditor(props: Record<string, unknown> = {}) {
  const stub = stubEditor();
  loadMock.mockResolvedValue(stub);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
  const result = render(<MejiroEditor epubUrl="/test.epub" {...props} />);
  await waitFor(() =>
    expect(result.container.querySelector('.mejiro-editor-paragraphs')).not.toBeNull(),
  );
  const button = (label: string) =>
    Array.from(result.container.querySelectorAll('button')).find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement;
  const banner = () => result.container.querySelector('.mejiro-editor-error')?.textContent;
  return { ...result, stub, button, banner };
}

afterEach(() => {
  vi.restoreAllMocks();
  readerState.props.length = 0;
  exportMock.mockReset();
  exportMock.mockImplementation(async () => new ArrayBuffer(8));
  loadMock.mockReset();
});

describe('MejiroEditor (React) — error state', () => {
  it('routes a preview reader failure to the banner and onError exactly once', async () => {
    const onError = vi.fn();
    const { banner } = await renderEditor({ onError });

    act(() => readerState.props.at(-1)?.onError?.(new Error('layout failed')));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('layout failed');
    expect(banner()).toBe('layout failed');
  });

  it('clears the banner when a later export succeeds', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportMock.mockRejectedValueOnce(new Error('packaging failed'));
    const { button, banner } = await renderEditor();

    fireEvent.click(button('Export EPUB'));
    await waitFor(() => expect(banner()).toBe('packaging failed'));
    fireEvent.click(button('Export EPUB'));

    await waitFor(() => expect(banner()).toBeUndefined());
  });
});

describe('MejiroEditor (React) — load lifecycle', () => {
  it('delivers no onLoad for a load still in flight at unmount', async () => {
    let finish: (value: EditableEpub) => void = () => {};
    loadMock.mockReturnValue(new Promise<EditableEpub>((resolve) => (finish = resolve)));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
    const onLoad = vi.fn();
    const { unmount } = render(<MejiroEditor epubUrl="/test.epub" onLoad={onLoad} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    unmount();
    await act(async () => finish(stubEditor()));

    expect(onLoad).not.toHaveBeenCalled();
  });

  it('delivers no onLoad once epubUrl is cleared mid-load', async () => {
    let finish: (value: EditableEpub) => void = () => {};
    loadMock.mockReturnValue(new Promise<EditableEpub>((resolve) => (finish = resolve)));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
    const onLoad = vi.fn();
    const { rerender, container } = render(<MejiroEditor epubUrl="/test.epub" onLoad={onLoad} />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    rerender(<MejiroEditor onLoad={onLoad} />);
    await act(async () => finish(stubEditor()));

    expect(onLoad).not.toHaveBeenCalled();
    expect(container.querySelector('.mejiro-editor-loading')).toBeNull();
  });
});

describe('MejiroEditor (React) — ruby without proofread', () => {
  it('applies ruby to a selected range past the first character', async () => {
    const { container, stub, button } = await renderEditor({ enableProofread: false });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);

    textarea.setSelectionRange(2, 4);
    fireEvent.select(textarea);
    fireEvent.change(container.querySelector('.mejiro-editor-section input') as HTMLInputElement, {
      target: { value: 'ru' },
    });
    fireEvent.click(button('Apply ruby'));

    const patch = vi.mocked(stub.updateParagraph).mock.calls.at(-1)?.[2] as {
      inlineAnnotations: Array<{ startIndex: number; endIndex: number; rubyText: string }>;
    };
    expect(patch.inlineAnnotations).toEqual([
      expect.objectContaining({ startIndex: 2, endIndex: 4, rubyText: 'ru' }),
    ]);
  });
});
