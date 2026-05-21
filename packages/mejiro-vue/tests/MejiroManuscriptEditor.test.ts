// @vitest-environment happy-dom

import { fireEvent, render, waitFor } from '@testing-library/vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

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
