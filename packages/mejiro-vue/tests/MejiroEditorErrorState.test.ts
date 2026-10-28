// @vitest-environment happy-dom

import type { EditableEpub } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

const readerState = vi.hoisted(() => ({
  emitError: undefined as undefined | ((error: Error) => void),
}));

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: defineComponent({
    name: 'FakeReader',
    props: { chapter: { type: Number, default: undefined }, epub: { type: Object } },
    emits: ['error'],
    setup(_props, { expose, emit }) {
      readerState.emitError = (error) => emit('error', error);
      expose({ goToAnchor: async () => {} });
      return () => h('div', { class: 'fake-reader' });
    },
  }),
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
  const result = render(MejiroEditor, { props: { epubUrl: '/test.epub', ...props } });
  await waitFor(() =>
    expect(result.container.querySelector('.mejiro-editor-paragraphs')).not.toBeNull(),
  );
  const button = (label: string) =>
    Array.from(result.container.querySelectorAll('button')).find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement;
  const banner = () => result.container.querySelector('.mejiro-editor-error')?.textContent;
  const errors = () => result.emitted<[Error]>().error ?? [];
  return { ...result, stub, button, banner, errors };
}

afterEach(() => {
  vi.restoreAllMocks();
  readerState.emitError = undefined;
  exportMock.mockReset();
  exportMock.mockImplementation(async () => new ArrayBuffer(8));
  loadMock.mockReset();
});

describe('MejiroEditor (Vue) — error state', () => {
  it('routes a preview reader failure to the banner and the error event exactly once', async () => {
    const { banner, errors } = await renderEditor();

    readerState.emitError?.(new Error('layout failed'));
    await nextTick();

    expect(errors()).toHaveLength(1);
    expect(errors()[0][0].message).toBe('layout failed');
    expect(banner()).toBe('layout failed');
  });

  it('clears the banner when a later export succeeds', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportMock.mockRejectedValueOnce(new Error('packaging failed'));
    const { button, banner } = await renderEditor();

    await fireEvent.click(button('Export EPUB'));
    await waitFor(() => expect(banner()).toBe('packaging failed'));
    await fireEvent.click(button('Export EPUB'));

    await waitFor(() => expect(banner()).toBeUndefined());
  });
});

describe('MejiroEditor (Vue) — load lifecycle', () => {
  it('emits no load for a load still in flight at unmount', async () => {
    let finish: (value: EditableEpub) => void = () => {};
    loadMock.mockReturnValue(new Promise<EditableEpub>((resolve) => (finish = resolve)));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
    const { unmount, emitted } = render(MejiroEditor, { props: { epubUrl: '/test.epub' } });
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    unmount();
    finish(stubEditor());
    await flushPromises();

    expect(emitted().load).toBeUndefined();
  });

  it('emits no load once epubUrl is cleared mid-load', async () => {
    let finish: (value: EditableEpub) => void = () => {};
    loadMock.mockReturnValue(new Promise<EditableEpub>((resolve) => (finish = resolve)));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
    const { rerender, emitted, container } = render(MejiroEditor, {
      props: { epubUrl: '/test.epub' },
    });
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    await rerender({ epubUrl: undefined });
    finish(stubEditor());
    await flushPromises();

    expect(emitted().load).toBeUndefined();
    expect(container.querySelector('.mejiro-editor-loading')).toBeNull();
  });
});

describe('MejiroEditor (Vue) — ruby without proofread', () => {
  it('applies ruby to a selected range past the first character', async () => {
    const { container, stub, button } = await renderEditor({ enableProofread: false });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    // The paragraph text lands after the list renders; a selection set before it is clamped to 0.
    await waitFor(() => expect(textarea.value).toBe('abcdef'));

    textarea.setSelectionRange(2, 4);
    await fireEvent.select(textarea);
    await fireEvent.update(
      container.querySelector('.mejiro-editor-section input') as HTMLInputElement,
      'ru',
    );
    await fireEvent.click(button('Apply ruby'));

    const patch = vi.mocked(stub.updateParagraph).mock.calls.at(-1)?.[2] as {
      inlineAnnotations: Array<{ startIndex: number; endIndex: number; rubyText: string }>;
    };
    expect(patch.inlineAnnotations).toEqual([
      expect.objectContaining({ startIndex: 2, endIndex: 4, rubyText: 'ru' }),
    ]);
  });
});
