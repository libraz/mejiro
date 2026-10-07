// @vitest-environment happy-dom

import { EditableEpub } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/vue';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: defineComponent({
    name: 'FakeReader',
    setup(_props, { expose }) {
      expose({ goToAnchor: async () => {} });
      return () => h('div');
    },
  }),
}));

import { MejiroEditor } from '../src/MejiroEditor.js';

const containerXml = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="OPS/package.opf" /></rootfiles></container>`;

const opfXml = `<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
  <manifest><item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml" /></manifest>
  <spine><itemref idref="c1" /></spine>
</package>`;

/** An EPUB whose chapter holds an emphasized paragraph, a scene break and a plain one. */
async function epubBuffer(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', containerXml);
  zip.file('OPS/package.opf', opfXml);
  zip.file(
    'OPS/Text/chapter.xhtml',
    `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body>
<p>漢<em>字で</em>す</p><hr /><p>後</p></body></html>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function renderEditor(props: Record<string, unknown> = {}) {
  const buffer = await epubBuffer();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(buffer.slice(0)));
  let editor: EditableEpub | undefined;
  const result = render(MejiroEditor, {
    props: {
      epubUrl: '/book.epub',
      onLoad: (loaded: EditableEpub) => {
        editor = loaded;
      },
      ...props,
    },
  });
  await waitFor(() => expect(editor).toBeDefined());
  const loaded = editor as EditableEpub;
  const { container } = result;
  const textarea = () => container.querySelector('textarea') as HTMLTextAreaElement;
  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement;
  const rubyInput = () =>
    container.querySelector('input[placeholder="furigana"]') as HTMLInputElement;
  const range = () => container.querySelector('.mejiro-editor-range')?.textContent;
  const paragraphButtons = () =>
    Array.from(container.querySelectorAll('.mejiro-editor-paragraphs button'));
  const errors = () => result.emitted<[Error]>().error ?? [];
  await waitFor(() => expect(textarea().value).toBe('漢字です'));
  return {
    ...result,
    editor: loaded,
    textarea,
    button,
    rubyInput,
    range,
    paragraphButtons,
    errors,
  };
}

/** Places the textarea selection at `[start, end)` and lets the editor capture it. */
async function select(el: HTMLTextAreaElement, start: number, end: number): Promise<void> {
  el.setSelectionRange(start, end);
  await fireEvent.select(el);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MejiroEditor (Vue) — pending edit commit', () => {
  it('resolves a caret at the end of the text to the last character', async () => {
    const view = await renderEditor();
    await select(view.textarea(), 4, 4);
    expect(view.range()).toBe('Base: 3-4 (1 chars)');

    await fireEvent.update(view.rubyInput(), 'す');
    await fireEvent.click(view.button('Apply ruby'));

    const ruby = view.editor.book.chapters[0].paragraphs[0].inlineAnnotations.filter(
      (ann) => ann.kind === 'ruby',
    );
    expect(ruby).toEqual([
      { kind: 'ruby', startIndex: 3, endIndex: 4, rubyText: 'す', type: 'mono' },
    ]);
  });

  it('keeps every non-ruby annotation the new ruby overlaps', async () => {
    const view = await renderEditor();
    const before = view.editor.book.chapters[0].paragraphs[0].inlineAnnotations;
    expect(before.some((ann) => ann.kind !== 'ruby')).toBe(true);
    await select(view.textarea(), 0, 3);
    await fireEvent.update(view.rubyInput(), 'かんじで');
    await fireEvent.click(view.button('Apply ruby'));

    const after = view.editor.book.chapters[0].paragraphs[0].inlineAnnotations;
    expect(after.filter((ann) => ann.kind !== 'ruby')).toEqual(
      before.filter((ann) => ann.kind !== 'ruby'),
    );
    expect(after.filter((ann) => ann.kind === 'ruby')).toEqual([
      { kind: 'ruby', startIndex: 0, endIndex: 3, rubyText: 'かんじで', type: 'group' },
    ]);
  });

  it('commits pending text before the ruby, as one undo step', async () => {
    const view = await renderEditor();
    await fireEvent.update(view.textarea(), '新漢字です');
    await select(view.textarea(), 1, 2);
    await fireEvent.update(view.rubyInput(), 'かん');
    expect(view.button('Apply ruby').disabled).toBe(false);
    await fireEvent.click(view.button('Apply ruby'));

    const paragraph = view.editor.book.chapters[0].paragraphs[0];
    expect(paragraph.text).toBe('新漢字です');
    expect(paragraph.inlineAnnotations).toContainEqual({
      kind: 'ruby',
      startIndex: 1,
      endIndex: 2,
      rubyText: 'かん',
      type: 'mono',
    });
    expect(view.editor.undo()).toBe(true);
    expect(view.editor.book.chapters[0].paragraphs[0].text).toBe('漢字です');
  });

  it('exports text typed in the proofread box but not yet applied', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://stub');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const onBeforeExport = vi.fn(() => undefined);
    const view = await renderEditor({ onBeforeExport });
    await fireEvent.update(view.textarea(), '書き換えた');
    await fireEvent.click(view.button('Export EPUB'));
    await waitFor(() => expect(view.emitted<[ArrayBuffer]>().export).toHaveLength(1));

    const buffer = (view.emitted<[ArrayBuffer]>().export as [ArrayBuffer][])[0][0];
    const exported = await EditableEpub.load(buffer);
    expect(exported.book.chapters[0].paragraphs[0].text).toBe('書き換えた');
    expect(onBeforeExport.mock.calls[0][0]).toBe(buffer);
  });

  it('offers no text or ruby editing on a selected scene break', async () => {
    const view = await renderEditor();
    await fireEvent.click(view.paragraphButtons()[1] as HTMLButtonElement);
    await waitFor(() => expect(view.textarea().value).toBe(''));

    expect(view.textarea().readOnly).toBe(true);
    expect(view.button('Apply text').disabled).toBe(true);
    await fireEvent.update(view.rubyInput(), 'るび');
    expect(view.button('Apply ruby').disabled).toBe(true);
    expect(view.range()).toBe('Base: 0-0 (0 chars)');
    await fireEvent.click(view.button('Apply ruby'));

    await fireEvent.click(view.paragraphButtons()[2] as HTMLButtonElement);
    await waitFor(() => expect(view.textarea().value).toBe('後'));
    expect(view.editor.undo()).toBe(false);
    expect(view.errors()).toHaveLength(0);
  });
});

describe('MejiroEditor (Vue) — download', () => {
  it('revokes the object URL once, after the click, even when the click throws', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://stub');
    const states: Array<{ connected: boolean; revoked: number }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      states.push({ connected: this.isConnected, revoked: revoke.mock.calls.length });
      if (states.length === 2) throw new Error('blocked');
    });
    const view = await renderEditor();

    await fireEvent.click(view.button('Export EPUB'));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    await fireEvent.click(view.button('Export EPUB'));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(states).toEqual([
      { connected: true, revoked: 0 },
      { connected: true, revoked: 1 },
    ]);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith('blob://stub');
    expect(view.errors()).toEqual([[expect.objectContaining({ message: 'blocked' })]]);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
