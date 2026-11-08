export { chapterResult, result };

// #region doc:layout
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';

const mejiro = new MejiroBrowser();

const result = await mejiro.layout({
  text: '漢字を読む',
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: 200,
  inlineAnnotations: [
    {
      type: 'ruby',
      startIndex: 0,
      endIndex: 2,
      rubyText: 'かんじ',
      rubyType: 'group',
    },
  ],
});
// #endregion doc:layout

// #region doc:chapter
const chapterResult = await mejiro.layoutParagraphs({
  paragraphs: [
    {
      text: '漢字を読む',
      inlineAnnotations: [
        {
          type: 'ruby',
          startIndex: 0,
          endIndex: 2,
          rubyText: 'かんじ',
          rubyType: 'group',
        },
      ],
    },
    {
      text: '名前はまだ無い',
      inlineAnnotations: [],
    },
  ],
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineWidth: verticalLineWidth(600, 16),
});

// #endregion doc:chapter
