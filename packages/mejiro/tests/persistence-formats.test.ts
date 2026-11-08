import * as core from '@libraz/mejiro';
import {
  type Annotation,
  parseAnnotations,
  parseReadingPosition,
  serializeAnnotations,
  serializeReadingPosition,
  toSortedAnnotations,
} from '@libraz/mejiro';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

/*
 * Stored payloads, as each release wrote them. The strings are fixtures of the
 * persisted formats, not values built through the serializers.
 */

describe('reading position storage formats', () => {
  const POSITION = { chapterIndex: 2, paragraphIndex: 3, charIndex: 4 };

  it('reads a payload written without a version', () => {
    expect(parseReadingPosition('{"chapter":2,"paragraph":3,"charIndex":4}')).toEqual(POSITION);
  });

  it('reads a payload that only knew the spread index as the start of its chapter, silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseReadingPosition('{"chapter":2,"spreadIdx":9}')).toEqual({
      chapterIndex: 2,
      paragraphIndex: 0,
      charIndex: 0,
    });
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('reads a version 2 payload', () => {
    expect(parseReadingPosition('{"version":2,"chapter":2,"paragraph":3,"charIndex":4}')).toEqual(
      POSITION,
    );
  });

  it('reads a version 3 payload and a bare anchor in the current key spelling', () => {
    const v3 = '{"version":3,"chapterIndex":2,"paragraphIndex":3,"charIndex":4}';

    expect(parseReadingPosition(v3)).toEqual(POSITION);
    expect(parseReadingPosition(JSON.stringify(POSITION))).toEqual(POSITION);
  });

  it('writes version 3 only, and reads back what it wrote', () => {
    const raw = serializeReadingPosition(POSITION);

    expect(JSON.parse(raw)).toEqual({ version: 3, ...POSITION });
    expect(parseReadingPosition(raw)).toEqual(POSITION);
  });

  it('returns null for an unknown version and for non-object payloads', () => {
    const payloads = [
      '{"version":4,"chapterIndex":2,"paragraphIndex":3,"charIndex":4}',
      '{"version":1,"chapter":2,"paragraph":3,"charIndex":4}',
      '{"version":3,"chapter":2,"paragraph":3,"charIndex":4}',
      '{"version":2,"chapterIndex":2,"paragraphIndex":3,"charIndex":4}',
      '42',
      '"text"',
      'null',
      'true',
      '[]',
      '',
      'not json',
    ];
    for (const raw of payloads) expect(parseReadingPosition(raw), raw).toBeNull();
    expect(parseReadingPosition(null)).toBeNull();
  });

  it('names the anchor ReadingAnchor and has one type for a stored position', () => {
    expect('ReadingPositionValue' in core).toBe(false);
    expectTypeErrors(
      `import { parseReadingPosition, serializeReadingPosition } from '@libraz/mejiro';
import type { ReadingAnchor } from '@libraz/mejiro';
export const position: ReadingAnchor | null = parseReadingPosition(null);
export const raw: string = serializeReadingPosition({ chapterIndex: 0, paragraphIndex: 0, charIndex: 0 });
export const old = serializeReadingPosition({ chapter: 0, paragraph: 0, charIndex: 0 });
`,
      { fails: ['const old'] },
    );
  });
});

describe('annotation storage formats', () => {
  const START = { paragraphIndex: 1, charIndex: 0 };
  const END = { paragraphIndex: 1, charIndex: 8 };
  const CURRENT: Annotation = {
    id: 'a1',
    chapterIndex: 2,
    start: START,
    end: END,
    color: 'yellow',
    note: 'memo',
    createdAt: 5,
  };
  const V1_ENTRY = {
    id: 'a1',
    chapter: 2,
    start: { paragraph: 1, charIndex: 0 },
    end: { paragraph: 1, charIndex: 8 },
    color: 'yellow',
    note: 'memo',
    createdAt: 5,
  };

  it('reads a version 1 payload in the current shape', () => {
    const raw = JSON.stringify({ version: 1, annotations: [V1_ENTRY] });

    expect(parseAnnotations(raw)).toEqual([CURRENT]);
  });

  it('reads a bare list in either key spelling', () => {
    expect(parseAnnotations(JSON.stringify([V1_ENTRY]))).toEqual([CURRENT]);
    expect(parseAnnotations(JSON.stringify([CURRENT]))).toEqual([CURRENT]);
  });

  it('reads a version 3 payload', () => {
    expect(parseAnnotations(JSON.stringify({ version: 3, annotations: [CURRENT] }))).toEqual([
      CURRENT,
    ]);
  });

  it('writes version 3 only, and reads back what it wrote', () => {
    const raw = serializeAnnotations([CURRENT]);

    expect(JSON.parse(raw)).toEqual({ version: 3, annotations: [CURRENT] });
    expect(parseAnnotations(raw)).toEqual([CURRENT]);
  });

  it('reads an entry in either key spelling whichever envelope holds it', () => {
    expect(parseAnnotations(JSON.stringify({ version: 3, annotations: [V1_ENTRY] }))).toEqual([
      CURRENT,
    ]);
    expect(parseAnnotations(JSON.stringify({ version: 1, annotations: [CURRENT] }))).toEqual([
      CURRENT,
    ]);
  });

  it('returns null, not an empty list, when the payload cannot be read', () => {
    const payloads = [
      '{"version":2,"annotations":[]}',
      '{"version":99,"annotations":[]}',
      '{"annotations":[]}',
      '{"version":3}',
      '{"version":3,"annotations":{}}',
      '42',
      '"text"',
      'null',
      'true',
      'not json',
    ];
    for (const raw of payloads) expect(parseAnnotations(raw), raw).toBeNull();
  });

  it('returns an empty list when nothing was stored', () => {
    expect(parseAnnotations(null)).toEqual([]);
    expect(parseAnnotations('')).toEqual([]);
    expect(parseAnnotations('{"version":3,"annotations":[]}')).toEqual([]);
    expect(parseAnnotations('[]')).toEqual([]);
  });

  it('declares the unreadable result in its return type', () => {
    expectTypeErrors(
      `import { parseAnnotations } from '@libraz/mejiro';
import type { Annotation } from '@libraz/mejiro';
const parsed = parseAnnotations(null);
export const handled: Annotation[] = parsed ?? [];
export const unhandled: Annotation[] = parsed;
`,
      { fails: ['const unhandled'] },
    );
  });
});

describe('toSortedAnnotations', () => {
  const at = (id: string, chapterIndex: number, paragraphIndex: number, charIndex: number) => ({
    id,
    chapterIndex,
    start: { paragraphIndex, charIndex },
    end: { paragraphIndex, charIndex: charIndex + 1 },
  });

  it('orders by chapter, paragraph then character and returns a new array', () => {
    const input = [at('d', 1, 0, 0), at('c', 0, 2, 0), at('b', 0, 1, 9), at('a', 0, 1, 2)];
    const snapshot = [...input];

    const sorted = toSortedAnnotations(input);

    expect(sorted.map((ann) => ann.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(sorted).not.toBe(input);
    expect(input).toEqual(snapshot);
  });

  it('replaces the sort-named function', () => {
    expect('sortAnnotations' in core).toBe(false);
  });
});
