import type { EditableEpub } from '@libraz/mejiro/epub';

export { editor, nextBuffer };

// `buffer` comes from the loading examples printed above this one.
const buffer = await (await fetch('/books/example.epub')).arrayBuffer();

// #region doc:update
import { parseEditableEpub } from '@libraz/mejiro/epub';

const editor = await parseEditableEpub(buffer);

// Mutators address an existing block by its id.
const [, , block] = editor.epub.chapters[0].blocks;

editor.updateParagraph(0, block.id, {
  text: '差し替え後の本文',
  inlineAnnotations: [
    // 本文 sits at indices 6 and 7: startIndex is inclusive, endIndex exclusive.
    { type: 'ruby', startIndex: 6, endIndex: 8, rubyText: 'ほんぶん', rubyType: 'group' },
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
  for (const block of editor.epub.chapters[0].blocks) {
    if (block.kind !== 'paragraph' || !block.text.includes(query)) continue;
    editor.updateParagraph(0, block.id, { text: block.text.replaceAll(query, replacement) });
  }
  // #endregion doc:walk-blocks
}
