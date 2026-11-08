// @vitest-environment happy-dom

import type { EditableEpub, EditableEpubBook } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { h, isReactive } from 'vue';

function fakeEditableBook(title = 'Editable'): EditableEpubBook {
  return {
    title,
    author: 'A',
    chapters: [
      {
        title: 'Ch1',
        href: 'OPS/Text/ch1.xhtml',
        originalXhtml: '',
        blocks: [{ kind: 'paragraph', id: 'b-1', text: 'one', inlineAnnotations: [] }],
        imageAssets: new Map(),
      },
    ],
  } as unknown as EditableEpubBook;
}

/** Editable stub over `epub` whose commands are spies. */
function stubEditor(epub: EditableEpubBook): EditableEpub {
  return {
    epub,
    title: epub.title,
    author: epub.author,
    subscribe: () => () => {},
    updateParagraph: vi.fn(),
    setInlineAnnotations: vi.fn(),
    transaction: (fn: () => void) => fn(),
    addImage: vi.fn(),
    export: vi.fn(async () => new Uint8Array(8)),
  } as unknown as EditableEpub;
}

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  // Only the load entry point is faked; the module's pure helpers (the book
  // projection the preview relies on) stay real.
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();
  return {
    ...actual,
    parseEditableEpub: vi.fn(async (bytes: ArrayBuffer | Uint8Array) => {
      const marker = (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))[0];
      const title = marker === 1 ? 'First' : marker === 2 ? 'Second' : 'Editable';
      return stubEditor(fakeEditableBook(title));
    }),
  };
});

import { parseEditableEpub as runtimeParseEditableEpub } from '@libraz/mejiro/epub';
import { enMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroEditor } from '../src/MejiroEditor.js';

/**
 * Editable stub with two paragraphs whose `updateParagraph` writes through to
 * the block it names, the way the core editor applies a patch.
 */
function twoParagraphEditor(): EditableEpub {
  const epub = {
    title: 'Two',
    author: 'A',
    chapters: [
      {
        title: 'Ch1',
        href: 'OPS/Text/ch1.xhtml',
        originalXhtml: '',
        blocks: [
          { kind: 'paragraph', id: 'b-1', text: 'one', inlineAnnotations: [] },
          { kind: 'paragraph', id: 'b-2', text: 'two', inlineAnnotations: [] },
        ],
        imageAssets: new Map(),
      },
    ],
  };
  const stub = stubEditor(epub as unknown as EditableEpubBook);
  vi.mocked(stub.updateParagraph).mockImplementation((chapter, blockId, patch) => {
    const target = epub.chapters[chapter];
    target.blocks = target.blocks.map((block) =>
      block.id === blockId && 'text' in patch
        ? { ...block, text: patch.text ?? block.text }
        : block,
    );
  });
  return stub;
}

async function renderLoaded(props: Record<string, unknown> = {}) {
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
  const result = render(MejiroEditor, { props: { epubUrl: '/test.epub', ...props } });
  await waitFor(() =>
    expect(result.container.querySelector('.mejiro-editor-paragraphs')).not.toBeNull(),
  );
  return { ...result, fetchSpy };
}

/** Renders the editor against a specific editable stub instead of the default fake. */
async function renderWithEditor(stub: EditableEpub, props: Record<string, unknown> = {}) {
  const loadMock = vi.mocked(runtimeParseEditableEpub);
  const previousLoad = loadMock.getMockImplementation();
  loadMock.mockImplementation(async () => stub);
  const rendered = await renderLoaded(props);
  return {
    ...rendered,
    restore: () => {
      if (previousLoad) loadMock.mockImplementation(previousLoad);
      rendered.fetchSpy.mockRestore();
    },
  };
}

describe('MejiroEditor (Vue) — section toggles', () => {
  it('defaults: shows Proofread, Ruby, Images, Export sections', async () => {
    const { container, fetchSpy } = await renderLoaded();
    const labels = Array.from(container.querySelectorAll('.mejiro-editor-label')).map(
      (el) => el.textContent ?? '',
    );
    expect(labels).toContain('Proofread');
    expect(labels).toContain('Ruby');
    expect(labels).toContain('Images');
    expect(container.querySelector('.mejiro-editor-export')).not.toBeNull();
    fetchSpy.mockRestore();
  });

  it('enableProofread={false} hides Proofread section', async () => {
    const { container, fetchSpy } = await renderLoaded({ enableProofread: false });
    const labels = Array.from(container.querySelectorAll('.mejiro-editor-label')).map(
      (el) => el.textContent ?? '',
    );
    expect(labels).not.toContain('Proofread');
    fetchSpy.mockRestore();
  });

  it('enableRuby={false} hides Ruby section', async () => {
    const { container, fetchSpy } = await renderLoaded({ enableRuby: false });
    const labels = Array.from(container.querySelectorAll('.mejiro-editor-label')).map(
      (el) => el.textContent ?? '',
    );
    expect(labels).not.toContain('Ruby');
    fetchSpy.mockRestore();
  });

  it('enableImages={false} hides Images section', async () => {
    const { container, fetchSpy } = await renderLoaded({ enableImages: false });
    const labels = Array.from(container.querySelectorAll('.mejiro-editor-label')).map(
      (el) => el.textContent ?? '',
    );
    expect(labels).not.toContain('Images');
    fetchSpy.mockRestore();
  });

  it('showExportButton={false} hides Export button', async () => {
    const { container, fetchSpy } = await renderLoaded({ showExportButton: false });
    expect(container.querySelector('.mejiro-editor-export')).toBeNull();
    fetchSpy.mockRestore();
  });

  it('uses i18n messages for editor labels', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { container } = render(MejiroI18nProvider, {
      props: { messages: { ...enMessages, editorProofread: '校正', editorExportEpub: '書き出し' } },
      slots: { default: () => h(MejiroEditor, { epubUrl: '/test.epub' }) },
    });
    await waitFor(() =>
      expect(container.querySelector('.mejiro-editor-paragraphs')).not.toBeNull(),
    );
    const labels = Array.from(container.querySelectorAll('.mejiro-editor-label')).map(
      (el) => el.textContent ?? '',
    );
    expect(labels).toContain('校正');
    expect(container.querySelector('.mejiro-editor-export')?.textContent).toBe('書き出し');
    fetchSpy.mockRestore();
  });

  it('commits pending proofread text before switching paragraphs', async () => {
    const stub = twoParagraphEditor();
    const { container, restore } = await renderWithEditor(stub);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe('one'));

    await fireEvent.update(textarea, 'one edited');
    const paragraphButtons = Array.from(
      container.querySelectorAll('.mejiro-editor-paragraphs button'),
    );
    await fireEvent.click(paragraphButtons[1] as HTMLButtonElement);

    expect(stub.updateParagraph).toHaveBeenCalledWith(0, 'b-1', { text: 'one edited' });
    expect(stub.epub.chapters[0].blocks[0]).toMatchObject({ text: 'one edited' });
    await waitFor(() =>
      expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('two'),
    );
    restore();
  });

  it('does not commit when the proofread buffer is unchanged', async () => {
    const stub = twoParagraphEditor();
    const { container, restore } = await renderWithEditor(stub);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe('one'));
    const paragraphButtons = Array.from(
      container.querySelectorAll('.mejiro-editor-paragraphs button'),
    );

    await fireEvent.click(paragraphButtons[1] as HTMLButtonElement);

    expect(stub.updateParagraph).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('two'),
    );
    restore();
  });

  it('forwards the limits prop to the EPUB loader', async () => {
    const { fetchSpy } = await renderLoaded({ limits: { maxTotalBytes: 4096 } });

    expect(runtimeParseEditableEpub).toHaveBeenLastCalledWith(expect.anything(), {
      limits: { maxTotalBytes: 4096 },
      signal: expect.any(AbortSignal),
    });
    fetchSpy.mockRestore();
  });

  it('ignores stale URL loads when epubUrl changes', async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      return url === '/first' ? first : second;
    });
    const loadCallsBefore = vi.mocked(runtimeParseEditableEpub).mock.calls.length;
    const { container, rerender } = render(MejiroEditor, { props: { epubUrl: '/first' } });

    await rerender({ epubUrl: '/second' });
    resolveSecond(new Response(new Uint8Array([2]).buffer, { status: 200 }));

    await waitFor(() =>
      expect(container.querySelector('.mejiro-editor-head strong')?.textContent).toBe('Second'),
    );

    resolveFirst(new Response(new Uint8Array([1]).buffer, { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtimeParseEditableEpub).toHaveBeenCalledTimes(loadCallsBefore + 1);
    expect(container.querySelector('.mejiro-editor-head strong')?.textContent).toBe('Second');
    fetchSpy.mockRestore();
  });
});

describe('MejiroEditor (Vue) — export download', () => {
  it('suppresses the download when exportPolicy.download is false', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container, emitted, fetchSpy } = await renderLoaded({
      exportPolicy: { download: false },
    });
    await fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(emitted().export).toHaveLength(1));
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('triggers the download when no export policy is given', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container, fetchSpy } = await renderLoaded();
    await fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

describe('MejiroEditor (Vue) — loaded document', () => {
  it('exports through the loaded editor itself, not a reactive wrapper around it', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let loaded: EditableEpub | undefined;
    const { container, fetchSpy } = await renderLoaded({
      onLoad: (editor: EditableEpub) => {
        loaded = editor;
      },
    });
    const exportSpy = vi.mocked((loaded as EditableEpub).export);
    let receiver: unknown;
    exportSpy.mockImplementation(async function (this: unknown) {
      receiver = this;
      return new Uint8Array(8);
    });

    await fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(exportSpy).toHaveBeenCalled());

    expect(receiver).toBe(loaded);
    expect(isReactive(receiver)).toBe(false);

    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

describe('MejiroEditor (Vue) — exportPolicy.watermark', () => {
  it('asks the export for the marked watermark without touching the edited document', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let loaded: EditableEpub | undefined;
    const { container, fetchSpy } = await renderLoaded({
      exportPolicy: { watermark: 'reader@example.com' },
      onLoad: (editor: EditableEpub) => {
        loaded = editor;
      },
    });
    const editor = loaded as EditableEpub;
    const blocksBefore = editor.epub.chapters.map((chapter) => chapter.blocks.length);

    const exportBtn = container.querySelector('.mejiro-editor-export') as HTMLButtonElement;
    for (let run = 1; run <= 3; run++) {
      await fireEvent.click(exportBtn);
      await waitFor(() => expect(editor.export).toHaveBeenCalledTimes(run));
    }

    expect(editor.epub.chapters.map((chapter) => chapter.blocks.length)).toEqual(blocksBefore);
    for (const call of vi.mocked(editor.export).mock.calls) {
      expect(call[0]).toMatchObject({ watermark: '[mejiro-watermark] reader@example.com' });
    }

    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

describe('MejiroEditor (Vue) — dropped file size', () => {
  it('rejects a file over maxInputBytes without reading it', async () => {
    const { container, emitted } = render(MejiroEditor, {
      props: { limits: { maxInputBytes: 4 } },
    });
    const file = new File([new Uint8Array(8)], 'book.epub');
    const read = vi.fn(() => Promise.resolve(new ArrayBuffer(8)));
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    await fireEvent.change(input);

    await waitFor(() =>
      expect((emitted().error?.[0]?.[0] as Error | undefined)?.message).toBe(
        'EPUB exceeds the compressed input limit (4 bytes)',
      ),
    );
    expect(read).not.toHaveBeenCalled();
  });
});
