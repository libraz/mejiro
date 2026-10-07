import { describe, expect, it, vi } from 'vitest';
import {
  type Annotation,
  parseAnnotations,
  parseReadingPosition,
  type ReadingPositionValue,
  serializeAnnotations,
  serializeReadingPosition,
} from '../src/persistence.js';

/** Position a reader resumes at when nothing usable was persisted. */
const START_OF_BOOK: ReadingPositionValue = { chapter: 0, paragraph: 0, charIndex: 0 };

describe('parseReadingPosition', () => {
  it('round-trips a serialized position', () => {
    const value: ReadingPositionValue = { chapter: 3, paragraph: 12, charIndex: 40 };

    expect(parseReadingPosition(serializeReadingPosition(value))).toEqual(value);
  });

  it('rejects fractional, negative and non-finite fields', () => {
    const payloads = [
      '{"version":2,"chapter":1.5,"paragraph":0,"charIndex":0}',
      '{"version":2,"chapter":0,"paragraph":2.5,"charIndex":0}',
      '{"version":2,"chapter":0,"paragraph":0,"charIndex":0.25}',
      '{"version":2,"chapter":-1,"paragraph":0,"charIndex":0}',
      '{"version":2,"chapter":0,"paragraph":-2,"charIndex":0}',
      '{"version":2,"chapter":0,"paragraph":0,"charIndex":-3}',
      '{"version":2,"chapter":1e999,"paragraph":0,"charIndex":0}',
      '{"version":2,"chapter":0,"paragraph":1e999,"charIndex":0}',
      '{"version":2,"chapter":0,"paragraph":0,"charIndex":-1e999}',
      '{"version":2,"chapter":0,"paragraph":0,"charIndex":1e30}',
      '{"version":2,"chapter":"0","paragraph":0,"charIndex":0}',
      '{"version":2,"chapter":0,"paragraph":null,"charIndex":0}',
      '{"version":2,"chapter":0,"charIndex":0}',
    ];

    for (const raw of payloads) {
      expect(parseReadingPosition(raw), raw).toBeNull();
      expect(parseReadingPosition(raw) ?? START_OF_BOOK, raw).toEqual(START_OF_BOOK);
    }
  });

  it('rejects a legacy payload whose chapter is not a non-negative integer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseReadingPosition('{"chapter":1.5,"spreadIdx":4}')).toBeNull();
    expect(parseReadingPosition('{"chapter":-1,"spreadIdx":4}')).toBeNull();
    expect(parseReadingPosition('{"chapter":1e999,"spreadIdx":4}')).toBeNull();
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('migrates a legacy payload with a valid chapter to the chapter start', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseReadingPosition('{"chapter":2,"spreadIdx":4}')).toEqual({
      chapter: 2,
      paragraph: 0,
      charIndex: 0,
    });

    warn.mockRestore();
  });

  it('rejects malformed and unversioned payloads', () => {
    expect(parseReadingPosition(null)).toBeNull();
    expect(parseReadingPosition('')).toBeNull();
    expect(parseReadingPosition('not json')).toBeNull();
    expect(parseReadingPosition('[]')).toBeNull();
    expect(parseReadingPosition('{"chapter":1}')).toBeNull();
  });

  it('accepts a bare anchor object with valid fields', () => {
    const value: ReadingPositionValue = { chapter: 3, paragraph: 12, charIndex: 40 };

    expect(parseReadingPosition(JSON.stringify(value))).toEqual(value);
  });

  it('rejects a bare anchor object with invalid fields', () => {
    expect(parseReadingPosition('{"chapter":0,"paragraph":-1,"charIndex":0}')).toBeNull();
    expect(parseReadingPosition('{"chapter":0,"paragraph":0,"charIndex":1.5}')).toBeNull();
  });
});

describe('parseAnnotations', () => {
  const annotation: Annotation = {
    id: 'a1',
    chapter: 2,
    start: { paragraph: 1, charIndex: 0 },
    end: { paragraph: 1, charIndex: 8 },
    color: 'yellow',
  };

  it('round-trips a serialized list', () => {
    expect(parseAnnotations(serializeAnnotations([annotation]))).toEqual([annotation]);
  });

  it('accepts a bare annotation array', () => {
    expect(parseAnnotations(JSON.stringify([annotation]))).toEqual([annotation]);
  });

  it('drops malformed entries from a bare annotation array', () => {
    expect(parseAnnotations(JSON.stringify([annotation, {}, null, 3]))).toEqual([annotation]);
  });

  it('keeps the first entry per id and drops empty ids and reversed ranges, in both shapes', () => {
    const duplicate = { ...annotation, color: 'red' };
    const reversed = {
      ...annotation,
      id: 'reversed',
      start: { paragraph: 2, charIndex: 0 },
      end: { paragraph: 1, charIndex: 9 },
    };
    const reversedInParagraph = {
      ...annotation,
      id: 'reversed-2',
      start: { paragraph: 1, charIndex: 5 },
      end: { paragraph: 1, charIndex: 4 },
    };
    const collapsed = { ...annotation, id: 'collapsed', end: annotation.start };
    const spanning = {
      ...annotation,
      id: 'spanning',
      start: { paragraph: 1, charIndex: 9 },
      end: { paragraph: 3, charIndex: 0 },
    };
    const entries = [
      reversed,
      annotation,
      duplicate,
      { ...annotation, id: '' },
      reversedInParagraph,
      collapsed,
      spanning,
    ];
    const expected = [annotation, collapsed, spanning];
    expect(parseAnnotations(JSON.stringify(entries))).toEqual(expected);
    expect(parseAnnotations(JSON.stringify({ version: 1, annotations: entries }))).toEqual(
      expected,
    );
  });

  it('returns an empty list for malformed payloads', () => {
    expect(parseAnnotations(null)).toEqual([]);
    expect(parseAnnotations('not json')).toEqual([]);
    expect(parseAnnotations('{"version":99,"annotations":[]}')).toEqual([]);
  });
});
