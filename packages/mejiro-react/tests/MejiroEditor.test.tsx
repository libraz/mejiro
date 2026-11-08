// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { EditableEpub } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** One-chapter editable document holding the paragraph blocks `texts`. */
function editableDocument(title: string, texts: readonly string[]) {
  return {
    title,
    author: 'A',
    chapters: [
      {
        title: 'Ch1',
        href: 'OPS/Text/ch1.xhtml',
        blocks: texts.map((text, i) => ({
          kind: 'paragraph' as const,
          id: `b-${i + 1}`,
          text,
          inlineAnnotations: [] as never[],
        })),
        imageAssets: new Map(),
      },
    ],
  };
}

/**
 * Editing session over `editableDocument`, shaped like the public
 * `EditableEpub`. `updateParagraph` writes the new text into the block it
 * names, as the core editor does.
 */
function stubEditor(title: string, ...texts: string[]): EditableEpub {
  const epub = editableDocument(title, texts);
  return {
    epub,
    title,
    author: epub.author,
    updateParagraph: vi.fn((chapterIndex: number, blockId: string, patch: { text?: string }) => {
      const chapter = epub.chapters[chapterIndex];
      chapter.blocks = chapter.blocks.map((block) =>
        block.id === blockId && patch.text !== undefined ? { ...block, text: patch.text } : block,
      );
    }),
    transaction: (fn: () => void) => fn(),
    addImage: vi.fn(),
    export: vi.fn(async () => new Uint8Array(8)),
  } as unknown as EditableEpub;
}

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  // Only the load entry point is faked; the module's pure helpers (the
  // preview projection) stay real.
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();
  return {
    ...actual,
    parseEditableEpub: vi.fn(async (bytes: ArrayBuffer | Uint8Array) => {
      const marker = new Uint8Array(bytes)[0];
      const title = marker === 1 ? 'First' : marker === 2 ? 'Second' : 'Editable';
      return stubEditor(title, 'one');
    }),
  };
});

import { parseEditableEpub as runtimeParseEditableEpub } from '@libraz/mejiro/epub';
import { enMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroEditor } from '../src/MejiroEditor.js';

async function renderLoaded(props: Record<string, unknown> = {}) {
  // Trigger the mount fetch by passing a non-empty epubUrl; the global fetch
  // returns a Response so parseEditableEpub (mocked) resolves with our fake.
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
  const result = render(<MejiroEditor epubUrl="/test.epub" {...props} />);
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

describe('MejiroEditor (React) — section toggles', () => {
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
    const { container } = render(
      <MejiroI18nProvider
        messages={{ ...enMessages, editorProofread: '校正', editorExportEpub: '書き出し' }}
      >
        <MejiroEditor epubUrl="/test.epub" />
      </MejiroI18nProvider>,
    );
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

  it('does not refetch when only onLoad changes', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { container, rerender } = render(<MejiroEditor epubUrl="/test.epub" onLoad={vi.fn()} />);
    await waitFor(() =>
      expect(container.querySelector('.mejiro-editor-paragraphs')).not.toBeNull(),
    );

    rerender(<MejiroEditor epubUrl="/test.epub" onLoad={vi.fn()} />);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('does not refetch when only onError changes', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    const { container, rerender } = render(<MejiroEditor epubUrl="/test.epub" onError={vi.fn()} />);
    await waitFor(() =>
      expect(container.querySelector('.mejiro-editor-paragraphs')).not.toBeNull(),
    );

    rerender(<MejiroEditor epubUrl="/test.epub" onError={vi.fn()} />);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('commits pending proofread text before switching paragraphs', async () => {
    const stub = stubEditor('Two', 'one', 'two');
    const { container, restore } = await renderWithEditor(stub);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe('one'));

    fireEvent.change(textarea, { target: { value: 'one edited' } });
    const paragraphButtons = Array.from(
      container.querySelectorAll('.mejiro-editor-paragraphs button'),
    );
    fireEvent.click(paragraphButtons[1] as HTMLButtonElement);

    expect(stub.updateParagraph).toHaveBeenCalledWith(0, 'b-1', { text: 'one edited' });
    const first = stub.epub.chapters[0].blocks[0];
    expect(first.kind === 'paragraph' && first.text).toBe('one edited');
    await waitFor(() =>
      expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('two'),
    );
    restore();
  });

  it('does not commit when the proofread buffer is unchanged', async () => {
    const stub = stubEditor('Two', 'one', 'two');
    const { container, restore } = await renderWithEditor(stub);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe('one'));
    const paragraphButtons = Array.from(
      container.querySelectorAll('.mejiro-editor-paragraphs button'),
    );

    fireEvent.click(paragraphButtons[1] as HTMLButtonElement);

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

  it('calls onError when URL loading fails', async () => {
    const onError = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(0), { status: 404 }));
    const { container } = render(<MejiroEditor epubUrl="/missing.epub" onError={onError} />);

    await waitFor(() => expect(container.querySelector('.mejiro-editor-error')).not.toBeNull());

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ name: 'MejiroError', code: 'fetch-failed' });
    expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe(
      onError.mock.calls[0][0].message,
    );
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
    const { container, rerender } = render(<MejiroEditor epubUrl="/first" />);

    rerender(<MejiroEditor epubUrl="/second" />);
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

describe('MejiroEditor (React) — exportPolicy.download', () => {
  it('suppresses the download when exportPolicy.download is false', async () => {
    const onExport = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container, fetchSpy } = await renderLoaded({
      exportPolicy: { download: false },
      onExport,
    });
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(onExport.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('triggers the download when no export policy is given', async () => {
    const onExport = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container, fetchSpy } = await renderLoaded({ onExport });
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('hands the transformed bytes to onExport and the download', async () => {
    const transformed = new Uint8Array([9, 9]);
    const transform = vi.fn(async () => transformed);
    const onExport = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blobs: BlobPart[][] = [];
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      'Blob',
      class extends OriginalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          blobs.push(parts);
        }
      },
    );
    try {
      const { container, fetchSpy } = await renderLoaded({ exportPolicy: { transform }, onExport });
      fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
      await waitFor(() => expect(onExport).toHaveBeenCalled());
      expect(transform.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
      expect(onExport).toHaveBeenCalledWith(transformed);
      expect(blobs.at(-1)?.[0]).toBe(transformed);
      fetchSpy.mockRestore();
    } finally {
      vi.unstubAllGlobals();
      clickSpy.mockRestore();
    }
  });
});

describe('MejiroEditor (React) — exportPolicy.watermark', () => {
  it('passes the marked watermark to the editor export on every run', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let loaded: EditableEpub | undefined;
    const { container, fetchSpy } = await renderLoaded({
      exportPolicy: { watermark: 'reader@example.com' },
      onLoad: (editor: EditableEpub) => {
        loaded = editor;
      },
    });
    const exportSpy = vi.mocked((loaded as EditableEpub).export);

    const button = container.querySelector('.mejiro-editor-export') as HTMLButtonElement;
    for (let run = 1; run <= 3; run++) {
      fireEvent.click(button);
      await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(run));
    }

    for (const call of exportSpy.mock.calls) {
      expect(call[0]).toMatchObject({ watermark: '[mejiro-watermark] reader@example.com' });
    }

    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

describe('MejiroEditor (React) — dropped file size', () => {
  it('rejects a file over maxInputBytes without reading it', async () => {
    const onError = vi.fn();
    const { container } = render(<MejiroEditor limits={{ maxInputBytes: 4 }} onError={onError} />);
    const file = new File([new Uint8Array(8)], 'book.epub');
    const read = vi.fn(() => Promise.resolve(new ArrayBuffer(8)));
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    fireEvent.change(input);

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'EPUB exceeds the compressed input limit (4 bytes)',
        }),
      ),
    );
    expect(read).not.toHaveBeenCalled();
  });
});
