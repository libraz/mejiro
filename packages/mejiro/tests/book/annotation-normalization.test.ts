/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { MejiroBook } from '../../src/book/mejiro-book.js';

/**
 * Decomposed source: KA + dakuten, KI + dakuten, KU. Five characters as
 * authored, three after NFC — which is the character array mejiro lays out
 * and the one every public offset addresses.
 */
const DECOMPOSED = '\u304b\u3099\u304d\u3099\u304f';

function book(): MejiroBook {
  const instance = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
  instance.setPageSize({ pageWidth: 400, lineWidth: 200 });
  return instance;
}

describe('MejiroBook annotation normalization', () => {
  it('moves caller-supplied annotations onto the NFC text', async () => {
    const layout = await book().layoutChapter({
      paragraphs: [
        {
          text: DECOMPOSED,
          inlineAnnotations: [
            // [2, 4) of the decomposed text is KI + dakuten, the second
            // character once composed.
            { kind: 'ruby', startIndex: 2, endIndex: 4, rubyText: 'ぎ', type: 'mono' },
            // [4, 5) is KU, the third character.
            { kind: 'emphasis', startIndex: 4, endIndex: 5 },
          ],
        },
      ],
    });

    const paragraph = layout.snapshot().paragraphs[0];
    expect([...paragraph.text]).toEqual(['が', 'ぎ', 'く']);
    expect(paragraph.inlineAnnotations).toEqual([
      { kind: 'ruby', startIndex: 1, endIndex: 2, rubyText: 'ぎ', type: 'mono' },
      { kind: 'emphasis', startIndex: 2, endIndex: 3 },
    ]);
    expect(paragraph.layoutRubyAnnotations?.[0]).toMatchObject({ startIndex: 1, endIndex: 2 });
  });

  it('re-breaks a decomposed chapter without a range error', async () => {
    const layout = await book().layoutChapter({
      paragraphs: [
        {
          text: DECOMPOSED,
          inlineAnnotations: [
            { kind: 'ruby', startIndex: 2, endIndex: 4, rubyText: 'ぎ', type: 'mono' },
          ],
        },
      ],
    });

    // A re-break runs the cached paragraph through computeBreaks again, which
    // rejects an annotation reaching past the text it was cached with.
    expect(() => layout.resize({ lineWidth: 120 })).not.toThrow();
    expect(layout.getSpread(0).right.page.paragraphs.length).toBeGreaterThan(0);
  });

  it('collapses a tcy span authored against the decomposed text', async () => {
    const layout = await book().layoutChapter({
      paragraphs: [
        {
          text: DECOMPOSED,
          // [0, 4) covers both dakuten pairs: the first two composed characters.
          inlineAnnotations: [{ kind: 'tcy', startIndex: 0, endIndex: 4 }],
        },
      ],
    });

    expect(layout.snapshot().paragraphs[0].layoutTcyAnnotations).toEqual([
      { startIndex: 0, endIndex: 2, advance: 16 },
    ]);
  });
});
