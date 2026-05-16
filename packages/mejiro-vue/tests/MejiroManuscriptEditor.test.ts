// @vitest-environment happy-dom

import type { EpubBook } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

const epubMocks = vi.hoisted(() => ({
  exportProject: vi.fn(async () => new ArrayBuffer(8)),
  setCover: vi.fn(),
}));

vi.mock('@libraz/mejiro/epub', () => {
  return {
    // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
    EpubProject: {
      fromManuscript: vi.fn(() => ({
        export: epubMocks.exportProject,
        setCover: epubMocks.setCover,
        assets: [] as unknown[],
      })),
    },
    parseEpub: vi.fn(
      async () =>
        ({
          title: 'Manuscript',
          author: '',
          chapters: [{ title: 'Ch1', paragraphs: [{ text: 'a', inlineAnnotations: [] }] }],
        }) as EpubBook,
    ),
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

  it('falls back to a valid cover asset filename when the upload name has no safe characters', async () => {
    const { container } = render(MejiroManuscriptEditor);
    await fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['cover'], '💥', { type: 'image/png' })] },
    });

    await waitFor(() => {
      expect(epubMocks.setCover).toHaveBeenCalledWith(
        expect.objectContaining({
          href: 'OPS/Images/cover.png',
          mediaType: 'image/png',
        }),
      );
    });
  });
});
