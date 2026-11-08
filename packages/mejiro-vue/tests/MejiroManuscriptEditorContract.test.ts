// @vitest-environment happy-dom

import type { ManuscriptChapter } from '@libraz/mejiro';
import { fireEvent, render, waitFor } from '@testing-library/vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { enMessages, MejiroI18nProvider, MejiroManuscriptEditor } from '../src/index.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const CHAPTERS: readonly ManuscriptChapter[] = [
  { id: 'c1', title: 'One', body: 'first' },
  { id: 'c2', title: 'Two', body: 'second' },
];

/** The chapter-title input of the draft section. */
function chapterTitleInput(container: Element): HTMLInputElement {
  const inputs = container.querySelectorAll<HTMLInputElement>('.mejiro-editor-section input');
  return inputs[inputs.length - 1];
}

describe('MejiroManuscriptEditor (Vue) — chapters binding', () => {
  it('reports every chapter edit through v-model:chapters and shows what the host holds', async () => {
    const chapters = ref<readonly ManuscriptChapter[]>(CHAPTERS);
    const reports: (readonly ManuscriptChapter[])[] = [];
    const { container } = render(
      defineComponent({
        setup: () => () =>
          h(MejiroManuscriptEditor, {
            chapters: chapters.value,
            'onUpdate:chapters': (next: readonly ManuscriptChapter[]) => {
              reports.push(next);
              chapters.value = next;
            },
          }),
      }),
    );

    await fireEvent.update(chapterTitleInput(container), 'Renamed');
    await nextTick();
    expect(reports.at(-1)?.map((c) => c.title)).toEqual(['Renamed', 'Two']);
    expect(chapterTitleInput(container).value).toBe('Renamed');

    chapters.value = [{ id: 'c9', title: 'Replaced', body: 'body' }];
    await nextTick();
    await nextTick();
    expect(container.querySelector('.mejiro-editor-paragraphs')?.textContent).toContain('Replaced');
  });

  it('rolls a chapter edit back when the host declines it', async () => {
    const onChaptersChange = vi.fn();
    const { container } = render(MejiroManuscriptEditor, {
      props: { chapters: CHAPTERS, 'onUpdate:chapters': onChaptersChange },
    });

    await fireEvent.update(chapterTitleInput(container), 'Declined');
    await nextTick();
    await nextTick();

    expect(onChaptersChange).toHaveBeenCalled();
    expect(chapterTitleInput(container).value).toBe('One');
  });

  it('keeps edits of chapters given without a listener', async () => {
    const { container } = render(MejiroManuscriptEditor, { props: { chapters: CHAPTERS } });
    await fireEvent.update(chapterTitleInput(container), 'Kept');
    await nextTick();
    await nextTick();
    expect(chapterTitleInput(container).value).toBe('Kept');
  });

  it('takes chapters as read-only ManuscriptChapter values and types the update', () => {
    expectTypeErrors(
      `import type { ManuscriptChapter } from '@libraz/mejiro';
import type { ManuscriptAutosaveDraft, MejiroManuscriptEditorProps } from '@libraz/mejiro-vue';
const chapters: readonly ManuscriptChapter[] = [{ title: 'T', body: '' }] as const;
const ok: MejiroManuscriptEditorProps = {
  chapters,
  'onUpdate:chapters': (next: readonly ManuscriptChapter[]) => void next,
  onExport: (bytes: Uint8Array) => void bytes,
  autosaveDebounceMs: 300,
  onAutosave: (draft: ManuscriptAutosaveDraft) => void draft,
};
void ok;
declare const draft: ManuscriptAutosaveDraft;
draft.title = 'x';
const p1: MejiroManuscriptEditorProps = { autosaveDelay: 300 };
const p2: MejiroManuscriptEditorProps = { 'onUpdate:chapters': (next: string) => void next };`,
      { fails: ["draft.title = 'x'", 'const p1', 'const p2'] },
    );
  });
});

describe('MejiroManuscriptEditor (Vue) — preview title', () => {
  it('titles the preview with the book title unless previewProps names one', async () => {
    const { container, rerender } = render(MejiroManuscriptEditor, {
      props: { chapters: CHAPTERS, title: 'Draft book' },
    });
    const mark = () => container.querySelector('.mejiro-reader-logo-mark')?.textContent;
    expect(mark()).toBe('Draft book');
    await rerender({ chapters: CHAPTERS, title: 'Draft book', previewProps: { title: 'Host' } });
    expect(mark()).toBe('Host');
  });
});

describe('MejiroManuscriptEditor (Vue) — autosave debounce', () => {
  it('autosaves once autosaveDebounceMs has passed since the last edit', async () => {
    vi.useFakeTimers();
    const onAutosave = vi.fn();
    const { container } = render(MejiroManuscriptEditor, {
      props: { chapters: CHAPTERS, onAutosave, autosaveDebounceMs: 300 },
    });
    await fireEvent.update(chapterTitleInput(container), 'Edited');

    vi.advanceTimersByTime(299);
    expect(onAutosave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAutosave).toHaveBeenCalledTimes(1);
    expect(onAutosave.mock.calls[0][0].chapters[0].title).toBe('Edited');
  });
});

describe('MejiroManuscriptEditor (Vue) — catalog defaults', () => {
  it('titles new chapters from the catalog in effect', async () => {
    const messages = { ...enMessages, manuscriptDefaultChapterTitle: 'Part {n}' };
    const { container } = render(
      defineComponent({
        setup: () => () =>
          h(MejiroI18nProvider, { messages }, () =>
            h(MejiroManuscriptEditor, { chapters: CHAPTERS }),
          ),
      }),
    );
    const add = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === enMessages.manuscriptAddChapter,
    ) as HTMLButtonElement;
    await fireEvent.click(add);
    await waitFor(() =>
      expect(container.querySelector('.mejiro-editor-paragraphs')?.textContent).toContain('Part 3'),
    );
  });
});

describe('MejiroManuscriptEditor (Vue) — export', () => {
  it('emits the exported EPUB as a Uint8Array', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://stub');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { container, emitted } = render(MejiroManuscriptEditor, {
      props: { chapters: CHAPTERS, title: 'Book', author: 'Author' },
    });
    await fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);
    await waitFor(() => expect(emitted().export).toHaveLength(1));
    expect((emitted().export[0] as [unknown])[0]).toBeInstanceOf(Uint8Array);
  });
});
