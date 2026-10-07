import type { EditableEpub } from '@libraz/mejiro/epub';

export { editor, nextBuffer };

// `buffer` comes from the loading examples printed above this one.
const buffer = await (await fetch('/books/example.epub')).arrayBuffer();

// #region doc:update
import { parseEditableEpub } from '@libraz/mejiro/epub';

const editor = await parseEditableEpub(buffer);

editor.updateParagraph(0, 2, {
  text: '差し替え後の本文',
  inlineAnnotations: [
    // 本文 sits at indices 6 and 7: startIndex is inclusive, endIndex exclusive.
    { kind: 'ruby', startIndex: 6, endIndex: 8, rubyText: 'ほんぶん', type: 'group' },
  ],
});

const nextBuffer = await editor.export({
  onProgress(stage, ratio) {
    console.log(stage, ratio);
  },
});
// #endregion doc:update

/** Replaces `query` in every paragraph of the first chapter. */
export function replaceInChapter(editor: EditableEpub, query: string, replacement: string) {
  // #region doc:walk-blocks
  // updateParagraph() takes a paragraph index, which skips image blocks.
  let paragraphIndex = 0;
  for (const block of editor.book.chapters[0].blocks) {
    if (block.kind !== 'paragraph') continue;
    if (block.text.includes(query)) {
      editor.updateParagraph(0, paragraphIndex, {
        text: block.text.replaceAll(query, replacement),
      });
    }
    paragraphIndex++;
  }
  // #endregion doc:walk-blocks
}
