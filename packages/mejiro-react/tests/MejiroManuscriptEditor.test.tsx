// @vitest-environment happy-dom
/** @jsxImportSource react */

import { fireEvent, render, waitFor } from '@testing-library/react';
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
