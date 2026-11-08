/**
 * @vitest-environment happy-dom
 *
 * Pairwise model of ChapterLayout.findText (every pair of values covered):
 *
 * | query        | caseSensitive | maxResults |
 * |--------------|---------------|------------|
 * | string       | false         | absent     |
 * | regexI       | absent        | 1          |
 * | regexI       | true          | absent     |
 * | regexI       | false         | invalid0   |
 * | regexI       | absent        | invalid0   |
 * | regexI       | absent        | absent     |
 * | regexNoFlags | true          | absent     |
 * | regexI       | false         | 1          |
 * | string       | true          | 1          |
 * | string       | absent        | invalid0   |
 * | regexNoFlags | absent        | 1          |
 * | regexNoFlags | false         | invalid0   |
 * | regexI       | true          | invalid0   |
 *
 * Expected: a string query is always literal; caseSensitive applies only to
 * string queries (a RegExp keeps its own flags); maxResults 0 is a RangeError.
 */
import { MejiroError } from '@libraz/mejiro';
import { type ChapterLayout, MejiroBook } from '@libraz/mejiro/book';
import { beforeAll, describe, expect, it } from 'vitest';
import { expectTypeErrors } from '../type-probe.js';

/**
 * `b.` read literally matches `B.` and `b.`; read as a pattern it also matches
 * `bc`. Code point offsets of each candidate: `B.` at 1, `b.` at 6, `bc` at 11.
 */
const TEXT = 'aB.c ab.c abc';

const QUERIES = {
  string: 'b.',
  regexI: /b./i,
  regexNoFlags: /b./,
} as const;

/** Start offsets every query finds with no result cap. */
const ALL_STARTS: Record<keyof typeof QUERIES, Record<'insensitive' | 'sensitive', number[]>> = {
  string: { insensitive: [1, 6], sensitive: [6] },
  regexI: { insensitive: [1, 6, 11], sensitive: [1, 6, 11] },
  regexNoFlags: { insensitive: [6, 11], sensitive: [6, 11] },
};

type Row = {
  query: keyof typeof QUERIES;
  caseSensitive: boolean | 'absent';
  maxResults: 1 | 'invalid0' | 'absent';
};

const ROWS: Row[] = [
  { query: 'string', caseSensitive: false, maxResults: 'absent' },
  { query: 'regexI', caseSensitive: 'absent', maxResults: 1 },
  { query: 'regexI', caseSensitive: true, maxResults: 'absent' },
  { query: 'regexI', caseSensitive: false, maxResults: 'invalid0' },
  { query: 'regexI', caseSensitive: 'absent', maxResults: 'invalid0' },
  { query: 'regexI', caseSensitive: 'absent', maxResults: 'absent' },
  { query: 'regexNoFlags', caseSensitive: true, maxResults: 'absent' },
  { query: 'regexI', caseSensitive: false, maxResults: 1 },
  { query: 'string', caseSensitive: true, maxResults: 1 },
  { query: 'string', caseSensitive: 'absent', maxResults: 'invalid0' },
  { query: 'regexNoFlags', caseSensitive: 'absent', maxResults: 1 },
  { query: 'regexNoFlags', caseSensitive: false, maxResults: 'invalid0' },
  { query: 'regexI', caseSensitive: true, maxResults: 'invalid0' },
];

let layout: ChapterLayout;

beforeAll(async () => {
  const book = new MejiroBook({
    fontFamily: 'serif',
    fontSize: 16,
    pageSize: { pageWidth: 400, lineWidth: 400 },
  });
  layout = await book.layoutChapter({ paragraphs: [{ text: TEXT }, { text: 'が' }] });
});

describe('ChapterLayout.findText', () => {
  it.each(ROWS)(
    'query $query, caseSensitive $caseSensitive, maxResults $maxResults',
    ({ query, caseSensitive, maxResults }) => {
      const options = {
        ...(caseSensitive === 'absent' ? {} : { caseSensitive }),
        ...(maxResults === 'absent' ? {} : { maxResults: maxResults === 'invalid0' ? 0 : 1 }),
      };
      const run = () => layout.findText(QUERIES[query], options);
      if (maxResults === 'invalid0') {
        expect(run).toThrow(RangeError);
        return;
      }
      const all = ALL_STARTS[query][caseSensitive === true ? 'sensitive' : 'insensitive'];
      const expected = maxResults === 1 ? all.slice(0, 1) : all;
      const matches = run();
      expect(matches.map((m) => m.startIndex)).toEqual(expected);
      for (const match of matches) {
        expect(match.paragraphIndex).toBe(0);
        expect(match.endIndex - match.startIndex).toBe(2);
      }
    },
  );

  it('leaves the lastIndex of a global or sticky RegExp untouched', () => {
    const global = /b./g;
    global.lastIndex = 3;
    const sticky = /b./y;
    expect(layout.findText(global).map((m) => m.startIndex)).toEqual([6, 11]);
    expect(layout.findText(sticky).map((m) => m.startIndex)).toEqual([6, 11]);
    expect(global.lastIndex).toBe(3);
    expect(sticky.lastIndex).toBe(0);
  });

  it('matches an NFC-normalized string query and returns nothing for an empty one', () => {
    expect(layout.findText('が')).toMatchObject([
      { paragraphIndex: 1, startIndex: 0, endIndex: 1 },
    ]);
    expect(layout.findText('')).toEqual([]);
  });

  it('rejects an unsafe pattern with regex-unsafe', () => {
    let thrown: unknown;
    try {
      layout.findText(/(a+)+b/);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MejiroError);
    expect(thrown).toMatchObject({ code: 'regex-unsafe' });
  });

  it('takes a RegExp for patterns and reports code point ranges as startIndex and endIndex', () => {
    expectTypeErrors(
      `import type { ChapterLayout, FindTextOptions, SearchMatch } from '@libraz/mejiro/book';
declare const layout: ChapterLayout;
const options: FindTextOptions = { caseSensitive: true, maxResults: 5 };
const matches: SearchMatch[] = layout.findText(/a+/u, options);
const index: number = matches[0].paragraphIndex;
const range: number = matches[0].endIndex - matches[0].startIndex;
layout.findText('a+', { regex: true });
const old = matches[0].paragraph;
const oldStart = matches[0].charStart;`,
      { fails: ['regex: true', 'matches[0].paragraph;', 'matches[0].charStart'] },
    );
  });
});
