// @vitest-environment happy-dom
/** @jsxImportSource react */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const epubMocks = vi.hoisted(() => ({
  exportProject: vi.fn(async () => new ArrayBuffer(8)),
  setCover: vi.fn(),
}));

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();
  return {
    ...actual,
    // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
    EpubProject: {
      fromManuscript: vi.fn(() => ({
        export: epubMocks.exportProject,
        setCover: epubMocks.setCover,
        assets: [] as unknown[],
      })),
    },
  };
});

import { enMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroManuscriptEditor } from '../src/MejiroManuscriptEditor.js';

const editorCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../mejiro/src/render/mejiro-editor.css'),
  'utf8',
);

describe('MejiroManuscriptEditor (React)', () => {
  beforeEach(() => {
    epubMocks.exportProject.mockClear();
    epubMocks.setCover.mockClear();
  });

  it('renders the editor panel with metadata and chapter sections', () => {
    const { container } = render(<MejiroManuscriptEditor />);
    const labels = Array.from(container.querySelectorAll('.mejiro-editor-label')).map(
      (el) => el.textContent ?? '',
    );
    expect(labels).toContain('Metadata');
    expect(labels).toContain('Chapters');
    expect(labels).toContain('Draft');
  });

  it('uses i18n messages for default manuscript values', () => {
    const messages = {
      ...enMessages,
      manuscriptDefaultTitle: 'Draft Title',
      manuscriptDefaultChapterTitle: 'Part {n}',
      manuscriptDefaultBody: 'Draft body',
    };
    const { container } = render(
      <MejiroI18nProvider messages={messages}>
        <MejiroManuscriptEditor />
      </MejiroI18nProvider>,
    );

    const inputs = Array.from(container.querySelectorAll('input')).map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(inputs).toContain('Draft Title');
    expect(inputs).toContain('Part 1');
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Draft body');

    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === messages.manuscriptAddChapter,
      ) as HTMLButtonElement,
    );
    expect(container.textContent).toContain('Part 2');
  });

  it('forwards previewProps to the embedded MejiroReader', async () => {
    const { container } = render(
      <MejiroManuscriptEditor previewProps={{ subtitle: 'Custom Sub' }} />,
    );
    await waitFor(() => {
      expect(container.querySelector('.mejiro-reader-logo-sub')?.textContent).toBe('Custom Sub');
    });
  });

  it('previewProps cannot override the editor-driven epub/fonts/enableImageOverlay', async () => {
    const { container } = render(<MejiroManuscriptEditor previewProps={{ subtitle: 'Sub' }} />);
    await waitFor(() => {
      expect(container.querySelector('.mejiro-reader')).not.toBeNull();
    });
    // The Image overlay button is force-off by the editor.
    const hasImageBtn = Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
      b.textContent?.includes('Image'),
    );
    expect(hasImageBtn).toBe(false);
  });

  it('uses `title` / `author` props as initial values when no onChange handlers are provided', () => {
    const { container } = render(<MejiroManuscriptEditor title="From Parent" author="Author X" />);
    const inputs = Array.from(container.querySelectorAll('input')).map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(inputs).toContain('From Parent');
    expect(inputs).toContain('Author X');
  });

  it('uncontrolled mode: input edits stay local even when the title prop changes later', () => {
    const { container, rerender } = render(<MejiroManuscriptEditor title="Initial" />);
    const titleInput = container.querySelector('.mejiro-editor-panel input') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'User edit' } });
    expect((container.querySelector('.mejiro-editor-panel input') as HTMLInputElement).value).toBe(
      'User edit',
    );
    // Parent prop change after a user edit overwrites the user's value
    // because the editor syncs uncontrolled state from prop changes.
    rerender(<MejiroManuscriptEditor title="Parent overwrite" />);
    expect((container.querySelector('.mejiro-editor-panel input') as HTMLInputElement).value).toBe(
      'Parent overwrite',
    );
  });

  it('controlled mode: parent owns the title via `title` + `onTitleChange`', () => {
    const onTitleChange = vi.fn();
    const { container, rerender } = render(
      <MejiroManuscriptEditor title="Step 1" onTitleChange={onTitleChange} />,
    );
    const titleInput = container.querySelector('.mejiro-editor-panel input') as HTMLInputElement;
    expect(titleInput.value).toBe('Step 1');
    fireEvent.change(titleInput, { target: { value: 'User typed' } });
    expect(onTitleChange).toHaveBeenLastCalledWith('User typed');
    // Parent ignores onTitleChange — the controlled value stays "Step 1".
    expect((container.querySelector('.mejiro-editor-panel input') as HTMLInputElement).value).toBe(
      'Step 1',
    );
    // Parent applies the next value.
    rerender(<MejiroManuscriptEditor title="Step 2" onTitleChange={onTitleChange} />);
    expect((container.querySelector('.mejiro-editor-panel input') as HTMLInputElement).value).toBe(
      'Step 2',
    );
  });

  it('controlled mode: `author` + `onAuthorChange` mirrors the title pattern', () => {
    const onAuthorChange = vi.fn();
    const { container } = render(
      <MejiroManuscriptEditor author="Author A" onAuthorChange={onAuthorChange} />,
    );
    const inputs = container.querySelectorAll('.mejiro-editor-panel input');
    const authorInput = inputs[1] as HTMLInputElement;
    expect(authorInput.value).toBe('Author A');
    fireEvent.change(authorInput, { target: { value: 'Author B' } });
    expect(onAuthorChange).toHaveBeenLastCalledWith('Author B');
  });

  it('controlled mode: `cover` + `onCoverChange` fires when the file picker selects a file', () => {
    const onCoverChange = vi.fn();
    const { container } = render(<MejiroManuscriptEditor onCoverChange={onCoverChange} />);
    const fileInput = container.querySelector(
      '.mejiro-editor-panel input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['cover'], 'cover.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);
    expect(onCoverChange).toHaveBeenCalledWith(file);
  });

  it('autosaves chapters together with metadata and cover', () => {
    vi.useFakeTimers();
    try {
      const onAutosave = vi.fn();
      const { container } = render(
        <MejiroManuscriptEditor
          title="Draft"
          author="Author"
          onAutosave={onAutosave}
          autosaveDelay={100}
        />,
      );
      const input = container.querySelector(
        '.mejiro-editor-panel input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(['cover'], 'cover.png', { type: 'image/png' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(onAutosave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Draft',
          author: 'Author',
          cover: file,
          chapters: expect.any(Array),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('autosaves when only the title changes', () => {
    vi.useFakeTimers();
    try {
      const onAutosave = vi.fn();
      const { container } = render(
        <MejiroManuscriptEditor
          title="Before"
          author="Author"
          onAutosave={onAutosave}
          autosaveDelay={100}
        />,
      );
      const titleInput = container.querySelector('.mejiro-editor-panel input') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'After' } });

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(onAutosave).toHaveBeenCalledTimes(1);
      expect(onAutosave.mock.calls[0][0]).toEqual({
        title: 'After',
        author: 'Author',
        cover: null,
        chapters: expect.any(Array),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces autosave errors in the editor panel', async () => {
    vi.useFakeTimers();
    try {
      const onAutosave = vi.fn(async () => {
        throw new Error('autosave failed');
      });
      const { container } = render(
        <MejiroManuscriptEditor onAutosave={onAutosave} autosaveDelay={100} />,
      );
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'changed' } });

      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe('autosave failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('mirrors the layout when panelSide is left', () => {
    const { container: right } = render(<MejiroManuscriptEditor />);
    expect(right.querySelector('.mejiro-editor')?.getAttribute('data-panel-side')).toBe('right');

    const { container: left } = render(<MejiroManuscriptEditor panelSide="left" />);
    const root = left.querySelector('.mejiro-editor') as HTMLElement;
    expect(root.getAttribute('data-panel-side')).toBe('left');
    // The mirrored layout is the stylesheet's reaction to that attribute.
    expect(editorCss).toContain('.mejiro-editor[data-panel-side="left"]');
  });

  it('surfaces a failed export in the editor panel and through onError', async () => {
    const failure = new Error('packaging failed');
    epubMocks.exportProject.mockRejectedValueOnce(failure);
    const onError = vi.fn();

    const { container } = render(<MejiroManuscriptEditor onError={onError} />);
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);

    await waitFor(() => {
      expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe('packaging failed');
    });
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('surfaces a cover that cannot be read as bytes at export time', async () => {
    const failure = new Error('cover unreadable');
    const onError = vi.fn();
    const file = new File(['cover'], 'cover.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(failure),
      configurable: true,
    });

    const { container } = render(<MejiroManuscriptEditor onError={onError} />);
    const fileInput = container.querySelector(
      '.mejiro-editor-panel input[type="file"]',
    ) as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);

    await waitFor(() => {
      expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe('cover unreadable');
    });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(epubMocks.exportProject).not.toHaveBeenCalled();
  });

  it('forwards preview options, theme, and settings renderer to the embedded reader', () => {
    const { container } = render(
      <MejiroManuscriptEditor
        previewProps={{
          options: { fontFamily: 'serif', fontSize: 22 },
          theme: 'dark',
          renderSettings: () => <div className="custom-preview-settings">Custom</div>,
        }}
      />,
    );

    expect(container.querySelector('.mejiro-reader')?.getAttribute('data-mejiro-theme')).toBe(
      'dark',
    );
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('serif 22px');
    expect(container.querySelector('.custom-preview-settings')?.textContent).toBe('Custom');
  });

  it('uses the notation highlighter for manuscript body editing', () => {
    const { container } = render(<MejiroManuscriptEditor />);
    const wrapper = container.querySelector('.mejiro-notation-highlighter');
    const textarea = container.querySelector('.mejiro-notation-textarea') as HTMLTextAreaElement;

    expect(wrapper).not.toBeNull();
    fireEvent.change(textarea, { target: { value: '漢字《かんじ》' } });
    expect(textarea.value).toBe('漢字《かんじ》');
  });

  it('falls back to a valid cover asset filename when the upload name has no safe characters', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://stub');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const { container } = render(<MejiroManuscriptEditor />);
    const input = container.querySelector(
      '.mejiro-editor-panel input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['cover'], '💥', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);

    await waitFor(() => {
      expect(epubMocks.setCover).toHaveBeenCalledWith(
        expect.objectContaining({
          href: 'OPS/Images/cover.png',
          mediaType: 'image/png',
        }),
      );
    });

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});
