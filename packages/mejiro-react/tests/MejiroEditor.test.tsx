// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { EditableEpub, EditableEpubBook } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

function fakeEditableBook(title = 'Editable'): EditableEpubBook {
  return {
    title,
    author: 'A',
    chapters: [
      {
        title: 'Ch1',
        href: 'OPS/Text/ch1.xhtml',
        paragraphs: [{ text: 'one', inlineAnnotations: [] }],
        blocks: [{ kind: 'paragraph', id: 'b-1', text: 'one', inlineAnnotations: [] }],
        imageAssets: new Map(),
      },
    ],
    packageData: {
      rootfilePath: 'OPS/package.opf',
      opfDir: 'OPS/',
      opfXml: '',
      files: new Map(),
    },
  } as unknown as EditableEpubBook;
}

vi.mock('@libraz/mejiro/epub', () => {
  function fakeEditorForBuffer(buffer: ArrayBuffer): EditableEpub {
    const marker = new Uint8Array(buffer)[0];
    const title = marker === 1 ? 'First' : marker === 2 ? 'Second' : 'Editable';
    const book = fakeEditableBook(title);
    return {
      book,
      title: book.title,
      author: book.author,
      updateParagraph: vi.fn(),
      addImage: vi.fn(),
      export: vi.fn(async () => new ArrayBuffer(8)),
    } as unknown as EditableEpub;
  }

  return {
    // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
    EditableEpub: {
      load: vi.fn(async (buffer: ArrayBuffer) => fakeEditorForBuffer(buffer)),
    },
  };
});

import { EditableEpub as RuntimeEditableEpub } from '@libraz/mejiro/epub';
import { enMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroEditor } from '../src/MejiroEditor.js';

async function renderLoaded(props: Record<string, unknown> = {}) {
  // Trigger the mount fetch by passing a non-empty epubUrl; the global fetch
  // returns a Response so EditableEpub.load (mocked) resolves with our fake.
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
  const result = render(<MejiroEditor epubUrl="/test.epub" {...props} />);
  await waitFor(() =>
    expect(result.container.querySelector('.mejiro-editor-paragraphs')).not.toBeNull(),
  );
  return { ...result, fetchSpy };
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

  it('enableExport={false} hides Export button', async () => {
    const { container, fetchSpy } = await renderLoaded({ enableExport: false });
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

  it('calls onError when URL loading fails', async () => {
    const onError = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(0), { status: 404 }));
    const { container } = render(<MejiroEditor epubUrl="/missing.epub" onError={onError} />);

    await waitFor(() =>
      expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe(
        'Failed to load EPUB: 404',
      ),
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('Failed to load EPUB: 404');
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
    const loadCallsBefore = vi.mocked(RuntimeEditableEpub.load).mock.calls.length;
    const { container, rerender } = render(<MejiroEditor epubUrl="/first" />);

    rerender(<MejiroEditor epubUrl="/second" />);
    resolveSecond(new Response(new Uint8Array([2]).buffer, { status: 200 }));

    await waitFor(() =>
      expect(container.querySelector('.mejiro-editor-head strong')?.textContent).toBe('Second'),
    );

    resolveFirst(new Response(new Uint8Array([1]).buffer, { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(RuntimeEditableEpub.load).toHaveBeenCalledTimes(loadCallsBefore + 1);
    expect(container.querySelector('.mejiro-editor-head strong')?.textContent).toBe('Second');
    fetchSpy.mockRestore();
  });
});

describe('MejiroEditor (React) — onBeforeExport', () => {
  it('suppresses the download when onBeforeExport returns false', async () => {
    const onBeforeExport = vi.fn(() => false);
    const onExport = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container, fetchSpy } = await renderLoaded({ onBeforeExport, onExport });
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(onBeforeExport).toHaveBeenCalled());
    expect(onExport).toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('triggers the download when onBeforeExport is omitted', async () => {
    const onExport = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container, fetchSpy } = await renderLoaded({ onExport });
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('triggers the download when onBeforeExport returns undefined', async () => {
    const onBeforeExport = vi.fn(() => undefined);
    const onExport = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container, fetchSpy } = await renderLoaded({ onBeforeExport, onExport });
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(onBeforeExport).toHaveBeenCalled());
    expect(onExport).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});
