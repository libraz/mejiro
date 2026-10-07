// @vitest-environment happy-dom
/** @jsxImportSource react */

import { EditableEpub } from '@libraz/mejiro/epub';
import { fireEvent, render, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/MejiroReader.js', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
    MejiroReader: forwardRef(function FakeReader(_props, ref) {
      useImperativeHandle(ref, () => ({ goToAnchor: async () => {} }), []);
      return null;
    }),
  };
});

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
  const result = render(
    <MejiroEditor
      epubUrl="/book.epub"
      onLoad={(loaded: EditableEpub) => {
        editor = loaded;
      }}
      {...props}
    />,
  );
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
  await waitFor(() => expect(textarea().value).toBe('漢字です'));
  return { ...result, editor: loaded, textarea, button, rubyInput, range, paragraphButtons };
}

/** Places the textarea selection at `[start, end)` and lets the editor capture it. */
function select(el: HTMLTextAreaElement, start: number, end: number): void {
  el.setSelectionRange(start, end);
  fireEvent.select(el);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MejiroEditor (React) — pending edit commit', () => {
  it('resolves a caret at the end of the text to the last character', async () => {
    const view = await renderEditor();
    select(view.textarea(), 4, 4);
    expect(view.range()).toBe('Base: 3-4 (1 chars)');

    fireEvent.change(view.rubyInput(), { target: { value: 'す' } });
    fireEvent.click(view.button('Apply ruby'));

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
    select(view.textarea(), 0, 3);
    fireEvent.change(view.rubyInput(), { target: { value: 'かんじで' } });
    fireEvent.click(view.button('Apply ruby'));

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
    fireEvent.change(view.textarea(), { target: { value: '新漢字です' } });
    select(view.textarea(), 1, 2);
    fireEvent.change(view.rubyInput(), { target: { value: 'かん' } });
    expect(view.button('Apply ruby').disabled).toBe(false);
    fireEvent.click(view.button('Apply ruby'));

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
    const onExport = vi.fn();
    const onBeforeExport = vi.fn(() => undefined);
    const view = await renderEditor({ onExport, onBeforeExport });
    fireEvent.change(view.textarea(), { target: { value: '書き換えた' } });
    fireEvent.click(view.button('Export EPUB'));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));

    const exported = await EditableEpub.load(onExport.mock.calls[0][0] as ArrayBuffer);
    expect(exported.book.chapters[0].paragraphs[0].text).toBe('書き換えた');
    expect(onBeforeExport.mock.calls[0][0]).toBe(onExport.mock.calls[0][0]);
  });

  it('offers no text or ruby editing on a selected scene break', async () => {
    const onError = vi.fn();
    const view = await renderEditor({ onError });
    fireEvent.click(view.paragraphButtons()[1] as HTMLButtonElement);
    await waitFor(() => expect(view.textarea().value).toBe(''));

    expect(view.textarea().readOnly).toBe(true);
    expect(view.button('Apply text').disabled).toBe(true);
    fireEvent.change(view.rubyInput(), { target: { value: 'るび' } });
    expect(view.button('Apply ruby').disabled).toBe(true);
    expect(view.range()).toBe('Base: 0-0 (0 chars)');
    fireEvent.click(view.button('Apply ruby'));

    fireEvent.click(view.paragraphButtons()[2] as HTMLButtonElement);
    await waitFor(() => expect(view.textarea().value).toBe('後'));
    expect(view.editor.undo()).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('MejiroEditor (React) — download', () => {
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
    const onError = vi.fn();
    const view = await renderEditor({ onError });

    fireEvent.click(view.button('Export EPUB'));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    fireEvent.click(view.button('Export EPUB'));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(states).toEqual([
      { connected: true, revoked: 0 },
      { connected: true, revoked: 1 },
    ]);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith('blob://stub');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'blocked' }));
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
