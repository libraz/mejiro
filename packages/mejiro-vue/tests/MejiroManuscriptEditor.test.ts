// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, waitFor } from '@testing-library/vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

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

describe('MejiroManuscriptEditor (Vue)', () => {
  beforeEach(() => {
    epubMocks.exportProject.mockClear();
    epubMocks.setCover.mockClear();
  });

  it('renders the editor panel with metadata and chapter sections', () => {
    const { container } = render(MejiroManuscriptEditor);
    const labels = Array.from(container.querySelectorAll('.mejiro-editor-label')).map(
      (el) => el.textContent ?? '',
    );
    expect(labels).toContain('Metadata');
    expect(labels).toContain('Chapters');
    expect(labels).toContain('Draft');
  });

  it('uses i18n messages for default manuscript values', async () => {
    const messages = {
      ...enMessages,
      manuscriptDefaultTitle: 'Draft Title',
      manuscriptDefaultChapterTitle: 'Part {n}',
      manuscriptDefaultBody: 'Draft body',
    };
    const Wrapped = defineComponent({
      setup() {
        return () => h(MejiroI18nProvider, { messages }, () => h(MejiroManuscriptEditor));
      },
    });
    const { container } = render(Wrapped);

    const inputs = Array.from(container.querySelectorAll('input')).map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(inputs).toContain('Draft Title');
    expect(inputs).toContain('Part 1');
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Draft body');

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === messages.manuscriptAddChapter,
    ) as HTMLButtonElement;
    addButton.click();
    await Promise.resolve();
    expect(container.textContent).toContain('Part 2');
  });

  it('forwards previewProps to the embedded MejiroReader', async () => {
    const { container } = render(MejiroManuscriptEditor, {
      props: { previewProps: { subtitle: 'Custom Sub' } },
    });
    await waitFor(() => {
      expect(container.querySelector('.mejiro-reader-logo-sub')?.textContent).toBe('Custom Sub');
    });
  });

  it('previewProps cannot override the editor-driven epub/fonts/enableImageOverlay', async () => {
    const { container } = render(MejiroManuscriptEditor, {
      props: { previewProps: { subtitle: 'Sub' } },
    });
    await waitFor(() => {
      expect(container.querySelector('.mejiro-reader')).not.toBeNull();
    });
    const hasImageBtn = Array.from(container.querySelectorAll('.mejiro-reader-btn')).some((b) =>
      b.textContent?.includes('Image'),
    );
    expect(hasImageBtn).toBe(false);
  });

  it('uses `title` / `author` props as initial values when no update listeners are attached', () => {
    const { container } = render(MejiroManuscriptEditor, {
      props: { title: 'From Parent', author: 'Author X' },
    });
    const inputs = Array.from(container.querySelectorAll('.mejiro-editor-panel input')).map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(inputs).toContain('From Parent');
    expect(inputs).toContain('Author X');
  });

  it('controlled mode: parent owns the title via v-model:title', async () => {
    const onUpdateTitle = vi.fn();
    const { container, rerender } = render(MejiroManuscriptEditor, {
      props: { title: 'Step 1', 'onUpdate:title': onUpdateTitle },
    });
    const titleInput = container.querySelector('.mejiro-editor-panel input') as HTMLInputElement;
    expect(titleInput.value).toBe('Step 1');
    await fireEvent.update(titleInput, 'User typed');
    expect(onUpdateTitle).toHaveBeenLastCalledWith('User typed');
    await rerender({ title: 'Step 2', 'onUpdate:title': onUpdateTitle });
    expect((container.querySelector('.mejiro-editor-panel input') as HTMLInputElement).value).toBe(
      'Step 2',
    );
  });

  it('controlled mode: the title input falls back to the prop when the parent declines the edit', async () => {
    const onUpdateTitle = vi.fn();
    const { container } = render(MejiroManuscriptEditor, {
      props: { title: 'Step 1', 'onUpdate:title': onUpdateTitle },
    });
    const titleInput = container.querySelector('.mejiro-editor-panel input') as HTMLInputElement;

    await fireEvent.update(titleInput, 'User typed');

    expect(onUpdateTitle).toHaveBeenLastCalledWith('User typed');
    expect(titleInput.value).toBe('Step 1');
    expect(container.querySelector('.mejiro-editor-head strong')?.textContent).toBe('Step 1');
  });

  it('controlled mode: the author input falls back to the prop when the parent declines the edit', async () => {
    const onUpdateAuthor = vi.fn();
    const { container } = render(MejiroManuscriptEditor, {
      props: { author: 'Author A', 'onUpdate:author': onUpdateAuthor },
    });
    const authorInput = container.querySelectorAll(
      '.mejiro-editor-panel input',
    )[1] as HTMLInputElement;

    await fireEvent.update(authorInput, 'Author B');

    expect(onUpdateAuthor).toHaveBeenLastCalledWith('Author B');
    expect(authorInput.value).toBe('Author A');
  });

  it('uncontrolled mode: input edits stay local when no update listener is attached', async () => {
    const { container } = render(MejiroManuscriptEditor, { props: { title: 'Initial' } });
    const titleInput = container.querySelector('.mejiro-editor-panel input') as HTMLInputElement;

    await fireEvent.update(titleInput, 'User edit');

    expect(titleInput.value).toBe('User edit');
    expect(container.querySelector('.mejiro-editor-head strong')?.textContent).toBe('User edit');
  });

  it('controlled mode: `cover` + onUpdate:cover fires when the file picker selects a file', async () => {
    const onUpdateCover = vi.fn();
    const { container } = render(MejiroManuscriptEditor, {
      props: { 'onUpdate:cover': onUpdateCover },
    });
    const fileInput = container.querySelector(
      '.mejiro-editor-panel input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['cover'], 'cover.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await fireEvent.change(fileInput);
    expect(onUpdateCover).toHaveBeenCalledWith(file);
  });

  it('autosaves chapters together with metadata and cover', async () => {
    vi.useFakeTimers();
    try {
      const onAutosave = vi.fn();
      const { container } = render(MejiroManuscriptEditor, {
        props: { title: 'Draft', author: 'Author', onAutosave, autosaveDelay: 100 },
      });
      const input = container.querySelector(
        '.mejiro-editor-panel input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(['cover'], 'cover.png', { type: 'image/png' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      await fireEvent.change(input);

      vi.advanceTimersByTime(150);

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

  it('autosaves when only the title changes', async () => {
    vi.useFakeTimers();
    try {
      const onAutosave = vi.fn();
      const { container } = render(MejiroManuscriptEditor, {
        props: { title: 'Before', author: 'Author', onAutosave, autosaveDelay: 100 },
      });
      const titleInput = container.querySelector('.mejiro-editor-panel input') as HTMLInputElement;
      await fireEvent.update(titleInput, 'After');

      vi.advanceTimersByTime(150);

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
      const { container } = render(MejiroManuscriptEditor, {
        props: { onAutosave, autosaveDelay: 100 },
      });
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      await fireEvent.update(textarea, 'changed');

      vi.advanceTimersByTime(150);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await nextTick();

      expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe('autosave failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('mirrors the layout when panelSide is left', () => {
    const { container: right } = render(MejiroManuscriptEditor);
    expect(right.querySelector('.mejiro-editor')?.getAttribute('data-panel-side')).toBe('right');

    const { container: left } = render(MejiroManuscriptEditor, { props: { panelSide: 'left' } });
    const root = left.querySelector('.mejiro-editor') as HTMLElement;
    expect(root.getAttribute('data-panel-side')).toBe('left');
    // The mirrored layout is the stylesheet's reaction to that attribute.
    expect(editorCss).toContain('.mejiro-editor[data-panel-side="left"]');
  });

  it('surfaces a failed export in the editor panel and through the error event', async () => {
    const failure = new Error('packaging failed');
    epubMocks.exportProject.mockRejectedValueOnce(failure);
    const onError = vi.fn();

    const { container } = render(MejiroManuscriptEditor, { props: { onError } });
    await fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);

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

    const { container } = render(MejiroManuscriptEditor, { props: { onError } });
    const fileInput = container.querySelector(
      '.mejiro-editor-panel input[type="file"]',
    ) as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    await fireEvent.change(fileInput);
    await fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);

    await waitFor(() => {
      expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe('cover unreadable');
    });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(epubMocks.exportProject).not.toHaveBeenCalled();
  });

  it('uses the notation highlighter for manuscript body editing', async () => {
    const { container } = render(MejiroManuscriptEditor, {
      props: { chapters: [{ id: 'c1', title: 'Chapter', body: '' }] },
    });
    const wrapper = container.querySelector('.mejiro-notation-highlighter');
    const textarea = container.querySelector('.mejiro-notation-textarea') as HTMLTextAreaElement;
    expect(wrapper).not.toBeNull();

    await fireEvent.update(textarea, '|漢字《かんじ》');

    expect(textarea.value).toBe('|漢字《かんじ》');
    expect(
      container.querySelector('.mejiro-notation-overlay [data-token="ruby"]')?.textContent,
    ).toBe('|漢字《かんじ》');
  });

  it('keeps the notation buttons wired to the highlighter textarea', async () => {
    const { container } = render(MejiroManuscriptEditor, {
      props: { chapters: [{ id: 'c1', title: 'Chapter', body: '強調' }] },
    });
    const textarea = container.querySelector('.mejiro-notation-textarea') as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 2);
    const emphasisButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === enMessages.manuscriptEmphasisDots,
    ) as HTMLButtonElement;

    await fireEvent.click(emphasisButton);

    expect(
      (container.querySelector('.mejiro-notation-textarea') as HTMLTextAreaElement).value,
    ).toBe('《《強調》》');
  });

  it('forwards preview options, theme, and settings slot to the embedded reader', async () => {
    const { container } = render(MejiroManuscriptEditor, {
      props: {
        previewProps: { options: { fontFamily: 'serif', fontSize: 22 }, theme: 'dark' },
      },
      slots: {
        settings: () => h('div', { class: 'custom-preview-settings' }, 'Custom'),
      },
    });

    await waitFor(() => {
      expect(container.querySelector('.mejiro-reader')).not.toBeNull();
    });
    expect(container.querySelector('.mejiro-reader')?.getAttribute('data-mejiro-theme')).toBe(
      'dark',
    );
    expect(container.querySelector('.mejiro-reader-stats')?.textContent).toContain('serif 22px');
    expect(container.querySelector('.custom-preview-settings')?.textContent).toBe('Custom');
  });

  it('falls back to a valid cover asset filename when the upload name has no safe characters', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://stub');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const { container } = render(MejiroManuscriptEditor);
    const input = container.querySelector(
      '.mejiro-editor-panel input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['cover'], '💥', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await fireEvent.change(input);
    await fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);

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
