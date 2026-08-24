/**
 * Pins the executable examples and character tables printed in
 * `docs/{en,ja}/03-line-breaking.md` to real `computeBreaks()` output and to
 * `getDefaultKinsokuRules()`, so a documented value cannot drift from the
 * shipped behaviour unnoticed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeBreaks, getLineRanges, toCodepoints } from '../src/index.js';
import { getDefaultKinsokuRules, isLineStartProhibited } from '../src/kinsoku.js';

const HANGING_TEXT = 'あいうえお、かきくけこ';
const SMALL_KANA_TEXT = 'あいうえおっかきくけこ';
const COUNTER_TEXT = 'あいうえ12人';
const SENTENCE_TEXT = '今日は良い天気ですね';
const advances = (count: number): Float32Array => new Float32Array(count).fill(16);

describe('line breaking documentation examples', () => {
  it('breaks with hanging punctuation enabled', () => {
    const result = computeBreaks({
      text: toCodepoints(HANGING_TEXT),
      advances: advances(11),
      lineWidth: 80,
      enableHanging: true,
    });

    expect([...result.breakPoints]).toEqual([5]);
    expect([...(result.hangingAdjustments ?? [])]).toEqual([16]);
  });

  it('breaks earlier with hanging punctuation disabled', () => {
    const result = computeBreaks({
      text: toCodepoints(HANGING_TEXT),
      advances: advances(11),
      lineWidth: 80,
      enableHanging: false,
    });

    expect([...result.breakPoints]).toEqual([3, 8]);
    expect(result.hangingAdjustments).toBeUndefined();
  });

  it('backtracks in strict mode and keeps the break in loose mode', () => {
    const text = toCodepoints(SMALL_KANA_TEXT);

    expect([
      ...computeBreaks({ text, advances: advances(11), lineWidth: 80, mode: 'strict' }).breakPoints,
    ]).toEqual([3, 8]);
    expect([
      ...computeBreaks({ text, advances: advances(11), lineWidth: 80, mode: 'loose' }).breakPoints,
    ]).toEqual([4, 9]);
  });

  it('breaks only at cluster boundaries', () => {
    const result = computeBreaks({
      text: toCodepoints('ABCDE'),
      advances: advances(5),
      lineWidth: 48,
      clusterIds: new Uint32Array([0, 0, 0, 1, 1]),
    });

    expect([...result.breakPoints]).toEqual([2]);
  });

  it('keeps a numeral and its counter together once cluster hints are applied', () => {
    const text = toCodepoints(COUNTER_TEXT);

    expect([...computeBreaks({ text, advances: advances(7), lineWidth: 80 }).breakPoints]).toEqual([
      4,
    ]);
    expect([
      ...computeBreaks({
        text,
        advances: advances(7),
        lineWidth: 80,
        clusterIds: new Uint32Array([0, 1, 2, 3, 4, 4, 4]),
      }).breakPoints,
    ]).toEqual([3]);
  });

  it('moves the break onto a bunsetsu edge once penalties are applied', () => {
    const text = toCodepoints(SENTENCE_TEXT);

    expect([...computeBreaks({ text, advances: advances(10), lineWidth: 96 }).breakPoints]).toEqual(
      [5],
    );
    expect([
      ...computeBreaks({
        text,
        advances: advances(10),
        lineWidth: 96,
        breakPenalties: new Uint8Array([2, 3, 0, 2, 0, 2, 3, 2, 3, 0]),
      }).breakPoints,
    ]).toEqual([4]);
  });

  it('converts break points into line ranges', () => {
    const text = toCodepoints('あいうえおかきくけこさしすせそ');
    const result = computeBreaks({ text, advances: advances(15), lineWidth: 80 });

    expect([...result.breakPoints]).toEqual([4, 9]);
    expect(getLineRanges(result.breakPoints, text.length)).toEqual([
      [0, 5],
      [5, 10],
      [10, 15],
    ]);
  });
});

/** Documentation pages and the section markers that delimit their character tables. */
const DOC_PAGES = [
  {
    path: 'docs/en/03-line-breaking.md',
    lineStart: ['**Line-start prohibited characters', '**Line-end prohibited characters'],
    lineEnd: ['**Line-end prohibited characters', '**Unbreakable pairs'],
    loose: ['### Loose Mode', '\n### '],
  },
  {
    path: 'docs/ja/03-line-breaking.md',
    lineStart: ['**行頭禁則文字', '**行末禁則文字'],
    lineEnd: ['**行末禁則文字', '**分割禁止ペア'],
    loose: ['### loose モード', '\n### '],
  },
] as const;
const DOC_PATHS = DOC_PAGES.map((page) => page.path);

/** Reads a documentation page relative to the repository root. */
function readDoc(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');
}

/**
 * Collects the characters listed in the second column of every table body row
 * between two markers of a documentation page. Header rows (the ones above the
 * `|---|` separator) are skipped.
 */
function tableChars(
  relativePath: string,
  [startMarker, endMarker]: readonly string[],
): Set<string> {
  const source = readDoc(relativePath);
  const start = source.indexOf(startMarker);
  expect(start, `no "${startMarker}" in ${relativePath}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end, `no "${endMarker}" in ${relativePath}`).toBeGreaterThan(start);

  const chars = new Set<string>();
  let inBody = false;
  for (const line of source.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) {
      inBody = false;
      continue;
    }
    const cell = line.split('|')[2]?.trim() ?? '';
    if (/^-+$/u.test(cell)) {
      inBody = true;
      continue;
    }
    if (!inBody) continue;
    for (const char of cell) chars.add(char);
  }
  return chars;
}

function codepointSet(codepoints: readonly number[]): Set<string> {
  return new Set(codepoints.map((cp) => String.fromCodePoint(cp)));
}

describe('kinsoku character tables', () => {
  const rules = getDefaultKinsokuRules();

  it.each(DOC_PAGES)('lists every line-start prohibited character in $path', (page) => {
    expect(tableChars(page.path, page.lineStart)).toEqual(codepointSet(rules.lineStartProhibited));
  });

  it.each(DOC_PAGES)('lists every line-end prohibited character in $path', (page) => {
    expect(tableChars(page.path, page.lineEnd)).toEqual(codepointSet(rules.lineEndProhibited));
  });

  it.each(DOC_PAGES)('lists exactly the characters loose mode allows in $path', (page) => {
    const looseAllowed = rules.lineStartProhibited.filter(
      (cp) => isLineStartProhibited(cp, 'strict') && !isLineStartProhibited(cp, 'loose'),
    );

    expect(tableChars(page.path, page.loose)).toEqual(codepointSet(looseAllowed));
  });

  it.each(DOC_PATHS)('documents the unbreakable pairs in %s', (path) => {
    const source = readDoc(path);
    for (const [left, right] of rules.unbreakablePairs) {
      const pair = `${String.fromCodePoint(left)}${String.fromCodePoint(right)}`;
      expect(source, `${pair} missing from ${path}`).toContain(`\`${pair}\``);
    }
  });
});
