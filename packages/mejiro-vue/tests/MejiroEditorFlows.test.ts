// @vitest-environment happy-dom

import type { EditableEpub } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const readerState = vi.hoisted(() => ({
  props: [] as Array<{ chapterIndex?: number }>,
  goToAnchor: vi.fn(async (_anchor: unknown) => {}),
}));

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: defineComponent({
    name: 'FakeReader',
    props: { chapterIndex: { type: Number, default: undefined }, epub: { type: Object } },
    setup(props, { expose }) {
      expose({ goToAnchor: readerState.goToAnchor });
      return () => {
        readerState.props.push({ chapterIndex: props.chapterIndex });
        return h('div', { class: 'fake-reader' });
      };
    },
  }),
}));

const exportMock = vi.hoisted(() => vi.fn(async () => new Uint8Array(8)));
const loadMock = vi.hoisted(() => vi.fn());

/** Two chapters with two paragraphs each; every command replaces the block it edits. */
function twoChapterEditor(): EditableEpub {
  const chapter = (n: number) => ({
    title: `Ch${n}`,
    href: `OPS/Text/ch${n}.xhtml`,
    originalXhtml: '',
    blocks: [
      { kind: 'paragraph', id: `c${n}-1`, text: `c${n}p1`, inlineAnnotations: [] },
      { kind: 'paragraph', id: `c${n}-2`, text: `c${n}p2`, inlineAnnotations: [] },
    ],
    imageAssets: new Map(),
  });
  const epub = {
    title: 'Two',
    author: 'A',
    chapters: [chapter(1), chapter(2)],
  };
  return {
    epub,
    title: epub.title,
    author: epub.author,
    subscribe: () => () => {},
    updateParagraph: vi.fn((ci: number, blockId: string, patch: { text: string }) => {
      epub.chapters[ci].blocks = epub.chapters[ci].blocks.map((block) =>
        block.id === blockId ? { ...block, text: patch.text } : block,
      );
    }),
    setInlineAnnotations: vi.fn(),
    transaction: (fn: () => void) => fn(),
    addImage: vi.fn(),
    export: exportMock,
  } as unknown as EditableEpub;
}

vi.mock('@libraz/mejiro/epub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@libraz/mejiro/epub')>()),
  parseEditableEpub: loadMock,
}));

import { MejiroEditor } from '../src/MejiroEditor.js';

async function renderEditor(props: Record<string, unknown> = {}) {
  const stub = twoChapterEditor();
  loadMock.mockResolvedValue(stub);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
  const result = render(MejiroEditor, { props: { epubUrl: '/test.epub', ...props } });
  await waitFor(() =>
    expect(result.container.querySelector('.mejiro-editor-paragraphs')).not.toBeNull(),
  );
  const buttons = () =>
    Array.from(result.container.querySelectorAll('.mejiro-editor-paragraphs button'));
  const textarea = () => result.container.querySelector('textarea') as HTMLTextAreaElement;
  const button = (label: string) =>
    Array.from(result.container.querySelectorAll('button')).find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement;
  const imageInput = () => result.container.querySelector('input[type="file"]') as HTMLInputElement;
  const errors = () => result.emitted<[Error]>().error ?? [];
  return { ...result, stub, buttons, textarea, button, imageInput, errors };
}

async function insertImage(input: HTMLInputElement, file: File): Promise<void> {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await fireEvent.change(input);
}

afterEach(() => {
  vi.restoreAllMocks();
  readerState.props.length = 0;
  readerState.goToAnchor.mockClear();
  exportMock.mockReset();
  exportMock.mockImplementation(async () => new Uint8Array(8));
});

describe('MejiroEditor (Vue) — preview follows the selection', () => {
  it('keeps the preview on the edited chapter and paragraph across every edit', async () => {
    const { buttons, textarea, button, imageInput } = await renderEditor();
    await fireEvent.click(buttons()[3] as HTMLButtonElement);
    await waitFor(() => expect(textarea().value).toBe('c2p2'));

    await fireEvent.update(textarea(), 'edited');
    await fireEvent.click(button('Apply text'));
    await insertImage(
      imageInput(),
      new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(readerState.goToAnchor.mock.calls.length).toBeGreaterThan(2));

    expect(readerState.props.at(-1)?.chapterIndex).toBe(1);
    expect(readerState.goToAnchor).toHaveBeenLastCalledWith({
      chapterIndex: 1,
      paragraphIndex: 1,
      charIndex: 0,
    });
  });
});

describe('MejiroEditor (Vue) — unapplied proofread text', () => {
  it('survives an image insert into the same paragraph', async () => {
    const { stub, textarea, imageInput } = await renderEditor();
    await waitFor(() => expect(textarea().value).toBe('c1p1'));
    await fireEvent.update(textarea(), 'unsaved');

    await insertImage(
      imageInput(),
      new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(stub.addImage).toHaveBeenCalled());

    expect(textarea().value).toBe('unsaved');
  });
});

describe('MejiroEditor (Vue) — export and image-insert failures', () => {
  it('reports an export failure through the error event and the error slot', async () => {
    exportMock.mockRejectedValueOnce(new Error('packaging failed'));
    const { container, button, errors } = await renderEditor();
    await fireEvent.click(button('Export EPUB'));
    await waitFor(() => expect(errors()).toHaveLength(1));
    expect(errors()[0][0].message).toBe('packaging failed');
    expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe('packaging failed');
  });

  it('reports a failing transform step', async () => {
    const { button, errors } = await renderEditor({
      exportPolicy: { transform: () => Promise.reject(new Error('drm down')) },
    });
    await fireEvent.click(button('Export EPUB'));
    await waitFor(() => expect(errors()).toHaveLength(1));
    expect(errors()[0][0].message).toBe('drm down');
  });

  it('reports an image insert whose file cannot be read', async () => {
    const { container, stub, imageInput, errors } = await renderEditor();
    const file = new File([], 'broken.png', { type: 'image/png' });
    file.arrayBuffer = () => Promise.reject(new Error('unreadable'));
    await insertImage(imageInput(), file);
    await waitFor(() => expect(errors()).toHaveLength(1));
    expect(errors()[0][0].message).toBe('unreadable');
    expect(stub.addImage).not.toHaveBeenCalled();
    expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe('unreadable');
  });

  it('emits and downloads the bytes exportPolicy.transform returns', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const wrapped = new Uint8Array([7, 7, 7]);
    const transform = vi.fn(async (_bytes: Uint8Array) => wrapped);
    const { button, emitted } = await renderEditor({ exportPolicy: { transform } });
    await fireEvent.click(button('Export EPUB'));
    await waitFor(() => expect(emitted().export).toHaveLength(1));
    expect(transform.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(emitted().export[0]).toEqual([wrapped]);
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('MejiroEditor (Vue) — image picker', () => {
  it('inserts the same file again when it is picked a second time', async () => {
    const { stub, imageInput } = await renderEditor();
    const input = imageInput();
    // A browser fires no `change` while the selection equals the input's value.
    let value = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => value,
      set: (next: string) => {
        value = next;
      },
    });
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    const pick = async () => {
      if (value === 'C:\\fakepath\\a.png') return;
      value = 'C:\\fakepath\\a.png';
      await insertImage(input, file);
    };

    await pick();
    await waitFor(() => expect(stub.addImage).toHaveBeenCalledTimes(1));
    await pick();
    await waitFor(() => expect(stub.addImage).toHaveBeenCalledTimes(2));
  });
});
