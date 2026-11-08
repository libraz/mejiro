// @vitest-environment happy-dom

import { MejiroError } from '@libraz/mejiro';
import { EpubProject } from '@libraz/mejiro/epub';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import {
  type UseEditableEpubOptions,
  type UseEditableEpubReturn,
  useEditableEpub,
} from '../src/index.js';

/** Real EPUB bytes with one chapter of two paragraphs. */
function epubBytes(): Promise<Uint8Array> {
  return new EpubProject({
    metadata: { title: 'Editable' },
    chapters: [{ title: '一', body: '最初の段落。\n\n次の段落。' }],
    includeTitlePage: false,
  }).export();
}

function harness(options: UseEditableEpubOptions = {}): UseEditableEpubReturn {
  let result!: UseEditableEpubReturn;
  mount(
    defineComponent({
      setup() {
        result = useEditableEpub(options);
        return () => h('div');
      },
    }),
  );
  return result;
}

/** Loads the sample book and returns the composable state plus the first paragraph's id. */
async function loaded(options: UseEditableEpubOptions = {}) {
  const state = harness(options);
  const editor = await state.loadBuffer(await epubBytes());
  if (!editor) throw new Error('load failed');
  const paragraph = editor.epub.chapters[0].blocks.find(
    (block) => block.kind === 'paragraph' && block.text === '最初の段落。',
  );
  if (!paragraph) throw new Error('missing paragraph');
  return { state, editor, blockId: paragraph.id };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useEditableEpub (Vue) — document slots', () => {
  it('exposes the document as epub and an EpubBook projection as previewEpub', async () => {
    const { state, editor } = await loaded();

    expect(state.epub.value).toBe(editor.epub);
    const texts = state.previewEpub.value?.chapters[0].paragraphs.map((p) => p.text);
    expect(texts).toContain('最初の段落。');
    expect(state.previewEpub.value?.chapters[0]).not.toHaveProperty('blocks');
  });

  it('follows edits made directly on the editor', async () => {
    const { state, editor, blockId } = await loaded();
    const before = state.revision.value;

    editor.updateParagraph(0, blockId, { text: '直接の編集。' });

    expect(state.revision.value).toBe(before + 1);
    expect(state.history.value?.canUndo).toBe(true);
    const texts = state.previewEpub.value?.chapters[0].paragraphs.map((p) => p.text);
    expect(texts).toContain('直接の編集。');
  });

  it('edits the selected block by id through the composable commands', async () => {
    const { state, blockId } = await loaded();

    state.setSelection({ chapterIndex: 0, blockId });
    state.updateParagraph({ text: '更新。' });

    expect(state.selectedParagraph.value).toMatchObject({ id: blockId, text: '更新。' });
  });
});

describe('useEditableEpub (Vue) — loading by URL', () => {
  it('loads a url through fetchEpub, handing it an abort signal', async () => {
    const bytes = await epubBytes();
    const fetchEpub = vi.fn(async (_url: string, _options: { signal: AbortSignal }) => bytes);
    const state = harness({ fetchEpub });

    await state.loadUrl('/book.epub');

    expect(fetchEpub).toHaveBeenCalledWith('/book.epub', { signal: expect.any(AbortSignal) });
    expect(state.epub.value?.title).toBe('Editable');
  });

  it('merges fetchOptions into the default fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(await epubBytes(), { status: 200 }));
    const state = harness({ fetchOptions: { headers: { authorization: 'Bearer t' } } });

    await state.loadUrl('/book.epub');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/book.epub',
      expect.objectContaining({
        headers: { authorization: 'Bearer t' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(state.epub.value?.title).toBe('Editable');
  });

  it('aborts the load in flight when a newer load starts', async () => {
    const signals: AbortSignal[] = [];
    const fetchEpub = vi.fn(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise<Uint8Array>((_, reject) => {
          signals.push(signal);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const onError = vi.fn();
    const state = harness({ fetchEpub, onError });

    const first = state.loadUrl('/a.epub');
    void state.loadUrl('/b.epub');

    expect(signals[0].aborted).toBe(true);
    await expect(first).resolves.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('useEditableEpub (Vue) — export', () => {
  it('exports Uint8Array bytes and hands them to onExport', async () => {
    const onExport = vi.fn();
    const { state } = await loaded({ onExport });

    const bytes = await state.exportEpub();

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(onExport).toHaveBeenCalledWith(bytes);
  });

  it('reports a failed export through error and onError and still rejects', async () => {
    const failure = new MejiroError('asset-fetch-failed', 'image unavailable');
    const onError = vi.fn();
    const { state } = await loaded({
      onError,
      assetResolver: () => Promise.reject(failure),
    });
    state.addImage({ filename: 'figure.png', url: 'https://cdn.example.test/figure.png' });

    await expect(state.exportEpub()).rejects.toBe(failure);

    expect(state.error.value).toBe(failure);
    expect(state.error.value).toMatchObject({ name: 'MejiroError', code: 'asset-fetch-failed' });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(state.exporting.value).toBe(false);
  });
});

describe('useEditableEpub (Vue) — public types', () => {
  it('names the document slots epub and previewEpub and keeps state read-only', () => {
    expectTypeErrors(
      `import type { EpubBook } from '@libraz/mejiro/epub';
import { useEditableEpub } from '@libraz/mejiro-vue';
const state = useEditableEpub({ url: () => '/a.epub', fetchOptions: { credentials: 'include' } });
const preview: EpubBook | null = state.previewEpub.value;
const title: string | undefined = state.epub.value?.title;
const bytes: Promise<Uint8Array | null> = state.exportEpub({ watermark: 'w' });
state.updateParagraph({ text: 'x' });
state.selection.value = { chapterIndex: 0, blockId: null };
state.revision.value = 0;
void state.book;
void state.previewBook;`,
      {
        fails: [
          'state.selection.value =',
          'state.revision.value = 0;',
          'void state.book;',
          'void state.previewBook;',
        ],
      },
    );
  });
});
