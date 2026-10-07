import { MejiroBook } from '@libraz/mejiro/book';

const book = new MejiroBook({ fontFamily: '"Noto Serif JP", serif', fontSize: 16 });
book.setPageSize({ pageWidth: 400, lineWidth: 600 });

/** `docs/{en,ja}/01-getting-started.md`, plain-text paragraphs. */
export async function layoutParagraphs() {
  // #region doc:paragraphs
  const layout = await book.layoutChapter({
    paragraphs: [
      { text: '吾輩は猫である。', headingLevel: 1 },
      { text: '名前はまだ無い。どこで生れたかとんと見当がつかぬ。' },
    ],
  });
  // #endregion doc:paragraphs
  return layout;
}
