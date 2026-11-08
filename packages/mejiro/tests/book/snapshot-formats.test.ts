import { MejiroBook } from '@libraz/mejiro/book';
import { describe, expect, it } from 'vitest';

/** A snapshot as the previous format version wrote it. */
const V2_SNAPSHOT = {
  version: 2,
  config: {
    fontSize: 16,
    lineSpacing: 1.8,
    headingScale: 1.4,
    mode: 'loose',
    enableHanging: true,
  },
  size: { pageWidth: 300, lineWidth: 200, pagePaddingX: 10, pagePaddingY: 20 },
  paragraphs: [
    {
      text: '見出し',
      advances: [16, 16, 16],
      breakPoints: [],
      inlineAnnotations: [],
      isHeading: true,
    },
    {
      text: '漢字です',
      advances: [16, 16, 16, 16],
      breakPoints: [],
      inlineAnnotations: [
        { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
        { kind: 'footnote', startIndex: 3, endIndex: 4, noteId: 'n1' },
      ],
      layoutRubyAnnotations: [
        {
          startIndex: 0,
          endIndex: 2,
          rubyText: [0x304b, 0x3093, 0x3058],
          rubyAdvances: [8, 8, 8],
          type: 'group',
        },
      ],
    },
    {
      text: '小見出し',
      advances: [16, 16, 16, 16],
      breakPoints: [],
      inlineAnnotations: [],
      isHeading: true,
      headingLevel: 2,
    },
  ],
  images: [{ spreadIndex: 0, images: [{ x: 10, y: 20, w: 30, h: 40 }] }],
};

function book(): MejiroBook {
  return new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
}

describe('ChapterLayoutSnapshot formats', () => {
  it('reads a previous-version snapshot into the current shape', () => {
    const layout = book().layoutFromSnapshot(V2_SNAPSHOT as never);
    const snapshot = layout.snapshot();

    expect(snapshot.version).toBe(3);
    expect(snapshot.config).toEqual({
      fontSize: 16,
      lineSpacing: 1.8,
      headingScale: 1.4,
      kinsoku: 'loose',
      enableHanging: true,
    });
    expect(snapshot.size).toEqual({ pageWidth: 300, lineWidth: 200, paddingX: 10, paddingY: 20 });
    expect(snapshot.images).toEqual([
      { spreadIndex: 0, images: [{ x: 10, y: 20, width: 30, height: 40 }] },
    ]);

    const [heading, body, subheading] = snapshot.paragraphs;
    expect(heading.kind).toBe('heading');
    expect(heading.headingLevel).toBeUndefined();
    expect(subheading).toMatchObject({ headingLevel: 2 });
    for (const paragraph of snapshot.paragraphs) expect('isHeading' in paragraph).toBe(false);
    expect(body.inlineAnnotations).toEqual([
      { type: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', rubyType: 'group' },
      { type: 'footnote-ref', startIndex: 3, endIndex: 4, noteId: 'n1' },
    ]);
    expect(body.layoutRubyAnnotations).toEqual([
      {
        startIndex: 0,
        endIndex: 2,
        rubyText: [0x304b, 0x3093, 0x3058],
        rubyAdvances: [8, 8, 8],
        rubyType: 'group',
      },
    ]);
    expect(layout.getPage(0).lines[0]).toMatchObject({ kind: 'heading' });
  });

  it('round-trips a current-version snapshot unchanged', () => {
    const current = book()
      .layoutFromSnapshot(V2_SNAPSHOT as never)
      .snapshot();
    const restored = book().layoutFromSnapshot(current).snapshot();
    expect(restored).toEqual(current);
  });

  it.each([
    ['an unknown version', { ...V2_SNAPSHOT, version: 99 }],
    ['a missing version', { ...V2_SNAPSHOT, version: undefined }],
    ['null', null],
    ['a string', 'snapshot'],
    ['a malformed paragraph', { ...V2_SNAPSHOT, paragraphs: [{ text: 'あ', advances: [] }] }],
  ])('rejects %s with snapshot-invalid', (_label, value) => {
    expect(() => book().layoutFromSnapshot(value as never)).toThrow(
      expect.objectContaining({ name: 'MejiroError', code: 'snapshot-invalid' }),
    );
  });
});
