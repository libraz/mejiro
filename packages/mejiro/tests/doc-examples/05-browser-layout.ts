import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';

const mejiro = new MejiroBrowser();

/** `docs/{en,ja}/05-browser-integration.md` §4, `layout()`. */
export async function layoutParagraph() {
  // #region doc:layout
  const result = await mejiro.layout({
    text: '吾輩は猫である。名前はまだ無い。',
    fontFamily: '"Noto Serif JP"', // Optional if fixedFontFamily is set
    fontSize: 16, // Optional if fixedFontSize is set
    lineWidth: verticalLineWidth(600, 16),
    mode: 'strict',
    enableHanging: true,
    inlineAnnotations: [],
    tokenBoundaries: undefined,
  });
  // result: BreakResult { breakPoints, hangingAdjustments?, effectiveAdvances? }
  // #endregion doc:layout
  return result;
}

/** `docs/{en,ja}/05-browser-integration.md` §5, `layoutChapter()`. */
export async function layoutChapter() {
  // #region doc:layout-chapter
  const result = await mejiro.layoutChapter({
    paragraphs: [
      { text: '第一章', fontSize: 22 },
      { text: '吾輩は猫である。名前はまだ無い。' },
      {
        text: '漢字を読む',
        // A ruby over more than one base character names its type.
        inlineAnnotations: [
          { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
        ],
      },
    ],
    fontFamily: '"Noto Serif JP"',
    fontSize: 16,
    lineWidth: verticalLineWidth(600, 16),
    mode: 'strict',
    enableHanging: true,
  });

  // result.paragraphs[i].breakResult -- BreakResult for paragraph i
  // result.paragraphs[i].chars       -- string[] of characters
  // #endregion doc:layout-chapter
  return result;
}
