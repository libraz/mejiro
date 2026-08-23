import { describe, expect, it } from 'vitest';
import {
  insertManuscriptParagraph,
  manuscriptParagraphs,
  manuscriptToEpubBook,
  parseInlineImageMarker,
} from '../../src/epub/manuscript-source.js';

describe('manuscriptToEpubBook', () => {
  it('emits a heading paragraph for each chapter title', () => {
    const book = manuscriptToEpubBook([{ id: 'c1', title: '第一話', body: '' }]);
    expect(book.chapters[0].title).toBe('第一話');
    expect(book.chapters[0].paragraphs[0]).toMatchObject({
      text: '第一話',
      headingLevel: 1,
    });
  });

  it('splits the body on blank lines and parses each block', () => {
    const book = manuscriptToEpubBook([
      { id: 'c1', title: 'タイトル', body: '本文一。\n\n本文二。' },
    ]);
    const paragraphs = book.chapters[0].paragraphs;
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1].text).toBe('本文一。');
    expect(paragraphs[2].text).toBe('本文二。');
  });

  it('extracts ruby annotations from auto-ruby notation under the default dialect', () => {
    const book = manuscriptToEpubBook([
      { id: 'c1', title: 'タイトル', body: '漢字《かんじ》です。' },
    ]);
    const body = book.chapters[0].paragraphs[1];
    expect(body.text).toBe('漢字です。');
    expect(body.inlineAnnotations).toHaveLength(1);
    expect(body.inlineAnnotations[0]).toMatchObject({ kind: 'ruby', rubyText: 'かんじ' });
  });

  it('drops mejiro-only annotations when the dialect is narou', () => {
    const book = manuscriptToEpubBook([{ id: 'c1', title: 'T', body: '《《圏点》》' }], {
      dialect: 'narou',
    });
    const body = book.chapters[0].paragraphs[1];
    expect(body.text).toBe('《《圏点》》');
    expect(body.inlineAnnotations).toHaveLength(0);
  });

  it('shares paragraph splitting and inline image marker parsing with project export', () => {
    const marker = '[[mejiro-image:..%2FImages%2Ffig.png|%E6%8C%BF%E7%B5%B5]]';
    expect(manuscriptParagraphs(`段落\n\n${marker}`)).toEqual(['段落', marker]);
    expect(parseInlineImageMarker(marker)).toEqual({ src: '../Images/fig.png', alt: '挿絵' });
  });

  it('skips inline image markers instead of exposing them as preview text', () => {
    const marker = '[[mejiro-image:..%2FImages%2Ffig.png|%E6%8C%BF%E7%B5%B5]]';
    const book = manuscriptToEpubBook([
      { id: 'c1', title: 'T', body: `段落1\n\n${marker}\n\n段落2` },
    ]);

    expect(book.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual([
      'T',
      '段落1',
      '段落2',
    ]);
  });

  it('preserves ideographic spaces that indent paragraphs and divide scenes', () => {
    expect(manuscriptParagraphs('　一段落目です。\n\n　\n\n　二段落目です。')).toEqual([
      '　一段落目です。',
      '　',
      '　二段落目です。',
    ]);
    expect(manuscriptParagraphs('  余白  \n\n　字下げ  ')).toEqual(['余白', '　字下げ']);
  });

  it('keeps indented paragraphs in the synthesized preview book', () => {
    const book = manuscriptToEpubBook([
      { title: 'T', body: '　一段落目です。\n\n　\n\n　二段落目です。' },
    ]);

    expect(book.chapters[0].paragraphs.map((paragraph) => paragraph.text)).toEqual([
      'T',
      '　一段落目です。',
      '　',
      '　二段落目です。',
    ]);
  });

  it('inserts a block at the requested index of the shared paragraph space', () => {
    const cases = [
      '段落1\n\n段落2',
      '\n\n段落1\n\n段落2',
      '段落1\n\n\n\n段落2\n\n',
      '\n段落1\n\n段落2',
    ];

    for (const body of cases) {
      for (let index = 0; index <= 2; index++) {
        const inserted = insertManuscriptParagraph(body, index, 'BLOCK');
        expect(manuscriptParagraphs(inserted).indexOf('BLOCK')).toBe(index);
        expect(manuscriptParagraphs(inserted)).toHaveLength(3);
      }
    }
  });

  it('clamps insertion indices and replaces a body with no paragraphs at all', () => {
    expect(manuscriptParagraphs(insertManuscriptParagraph('段落1', 9, 'BLOCK'))).toEqual([
      '段落1',
      'BLOCK',
    ]);
    expect(manuscriptParagraphs(insertManuscriptParagraph('段落1', -3, 'BLOCK'))).toEqual([
      'BLOCK',
      '段落1',
    ]);
    expect(insertManuscriptParagraph('\n \n', 0, 'BLOCK')).toBe('BLOCK');
  });

  it('honors the book-level title and author options', () => {
    const book = manuscriptToEpubBook([{ title: 'C1', body: '' }], {
      title: '作品名',
      author: '作者',
    });
    expect(book.title).toBe('作品名');
    expect(book.author).toBe('作者');
  });
});
