// @vitest-environment happy-dom

import type { EditableEpub, EditableEpubBook } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';

const readerState = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: defineComponent({
    name: 'FakeReader',
    inheritAttrs: false,
    setup(_props, { attrs, expose }) {
      expose({ goToAnchor: async () => {} });
      return () => {
        readerState.props.push({ ...attrs });
        return h('div', { class: 'fake-reader' });
      };
    },
  }),
}));

const loadMock = vi.hoisted(() => vi.fn());

vi.mock('@libraz/mejiro/epub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@libraz/mejiro/epub')>()),
  parseEditableEpub: loadMock,
}));

import { MejiroEditor } from '../src/index.js';

function stubEditor(): EditableEpub {
  const epub = {
    title: 'Book',
    author: 'A',
    chapters: [
      {
        title: 'Ch1',
        href: 'OPS/Text/ch1.xhtml',
        originalXhtml: '',
        blocks: [{ kind: 'paragraph', id: 'b-1', text: 'abc', inlineAnnotations: [] }],
        imageAssets: new Map(),
      },
    ],
  } as unknown as EditableEpubBook;
  return {
    epub,
    title: epub.title,
    author: epub.author,
    subscribe: () => () => {},
    updateParagraph: vi.fn(),
    setInlineAnnotations: vi.fn(),
    transaction: (fn: () => void) => fn(),
    addImage: vi.fn(),
    export: vi.fn(async () => new Uint8Array([1, 2, 3])),
  } as unknown as EditableEpub;
}

afterEach(() => {
  vi.restoreAllMocks();
  loadMock.mockReset();
  readerState.props.length = 0;
});

describe('MejiroEditor (Vue) — loading by URL', () => {
  it('merges fetchOptions into the fetch call, with its own signal', async () => {
    loadMock.mockResolvedValue(stubEditor());
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }));
    render(MejiroEditor, {
      props: { epubUrl: '/private.epub', fetchOptions: { credentials: 'include' } },
    });
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith('/private.epub', {
      credentials: 'include',
      signal: expect.any(AbortSignal),
    });
  });

  it('loads through fetchEpub with a signal it aborts when the URL changes', async () => {
    loadMock.mockResolvedValue(stubEditor());
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const signals: AbortSignal[] = [];
    const fetchEpub = vi.fn((_url: string, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return signals.length === 1
        ? new Promise<Uint8Array>(() => {})
        : Promise.resolve(new Uint8Array([2]));
    });
    const url = ref('/a.epub');
    render(
      defineComponent({ setup: () => () => h(MejiroEditor, { epubUrl: url.value, fetchEpub }) }),
    );
    await flushPromises();
    url.value = '/b.epub';
    await waitFor(() => expect(loadMock).toHaveBeenCalled());

    expect(fetchEpub.mock.calls.map(([u]) => u)).toEqual(['/a.epub', '/b.epub']);
    expect(signals[0].aborted).toBe(true);
    expect(loadMock.mock.calls[0][0]).toEqual(new Uint8Array([2]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

async function renderLoaded(props: Record<string, unknown> = {}) {
  loadMock.mockResolvedValue(stubEditor());
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
  const result = render(MejiroEditor, { props: { epubUrl: '/book.epub', ...props } });
  await waitFor(() =>
    expect(result.container.querySelector('.mejiro-editor-paragraphs')).not.toBeNull(),
  );
  return result;
}

describe('MejiroEditor (Vue) — preview props', () => {
  it('forwards previewProps to the preview reader, keeping the book and chapter its own', async () => {
    await renderLoaded({
      previewProps: { theme: 'dark', showStats: true, chapterNavMode: 'none' },
    });
    const last = readerState.props.at(-1);
    expect(last).toMatchObject({ theme: 'dark', showStats: true, chapterNavMode: 'none' });
    expect(last?.chapterIndex).toBe(0);
    expect(last?.epub).toMatchObject({ title: 'Book' });
    expect(typeof last?.['onUpdate:chapterIndex']).toBe('function');
  });

  it('titles the preview with the book title unless previewProps names one', async () => {
    const { rerender } = await renderLoaded();
    expect(readerState.props.at(-1)?.title).toBe('Book');
    await rerender({ previewProps: { title: 'Host title' } });
    expect(readerState.props.at(-1)?.title).toBe('Host title');
  });

  it('types previewProps as the shared subset of the reader props', () => {
    expectTypeErrors(
      `import type {
  ManuscriptPreviewProps,
  MejiroChapterNavMode,
  MejiroEditorProps,
  MejiroReaderCommonProps,
} from '@libraz/mejiro-vue';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const shared: Equal<NonNullable<MejiroEditorProps['previewProps']>, ManuscriptPreviewProps> = true;
const mode: Equal<ManuscriptPreviewProps['chapterNavMode'], MejiroChapterNavMode | undefined> = true;
const options: Equal<ManuscriptPreviewProps['options'], MejiroReaderCommonProps['options']> = true;
void [shared, mode, options];
const p1: ManuscriptPreviewProps = { epub: null };
const p2: ManuscriptPreviewProps = { enableHeader: true };`,
      { fails: ['const p1', 'const p2'] },
    );
  });
});

describe('MejiroEditor (Vue) — export policy', () => {
  it('emits the Uint8Array the transform returns and downloads only when download is not false', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://stub');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const transform = vi.fn(async (bytes: Uint8Array) => bytes.slice().reverse());
    const { container, emitted, rerender } = await renderLoaded({
      exportPolicy: { transform, download: false },
    });
    const exportButton = () =>
      container.querySelector('.mejiro-editor-export') as HTMLButtonElement;

    await fireEvent.click(exportButton());
    await waitFor(() => expect(emitted().export).toHaveLength(1));
    expect(transform).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(emitted().export[0]).toEqual([new Uint8Array([3, 2, 1])]);
    expect(click).not.toHaveBeenCalled();

    await rerender({ exportPolicy: { transform } });
    await fireEvent.click(exportButton());
    await waitFor(() => expect(emitted().export).toHaveLength(2));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('hides the export button with showExportButton false', async () => {
    const { container } = await renderLoaded({ showExportButton: false });
    expect(container.querySelector('.mejiro-editor-export')).toBeNull();
  });

  it('folds the export controls into ExportPolicy and drops the overlapping ones', () => {
    expectTypeErrors(
      `import type { ExportPolicy, MejiroEditorProps } from '@libraz/mejiro-vue';
const policy: ExportPolicy = {
  download: false,
  transform: async (bytes: Uint8Array<ArrayBuffer>) => bytes,
  watermark: 'reader@example.com',
};
const ok: MejiroEditorProps = {
  exportPolicy: policy,
  showExportButton: false,
  fonts: [{ value: 'serif', label: 'Serif' }] as const,
  onExport: (bytes: Uint8Array) => void bytes,
  onLoad: (editor: import('@libraz/mejiro/epub').EditableEpub) => void editor,
  onError: (error: Error) => void error,
};
void ok;
const p1: MejiroEditorProps = { onBeforeExport: () => false };
const p2: MejiroEditorProps = { enableExport: false };
const p3: ExportPolicy = { encrypt: (bytes: Uint8Array) => bytes };
const p4: ExportPolicy = { allowDownload: false };
const p5: ExportPolicy = { watermark: { text: 'x' } };
const p6: MejiroEditorProps = { onExport: (bytes: ArrayBuffer) => void bytes };`,
      { fails: ['const p1', 'const p2', 'const p3', 'const p4', 'const p5', 'const p6'] },
    );
  });
});
