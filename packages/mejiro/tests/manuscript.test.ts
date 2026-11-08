import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@libraz/mejiro';
import { type ParsedManuscript, parseManuscript } from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

describe('parseManuscript', () => {
  it('is importable from the root entry, with its option and result types', () => {
    expectTypeErrors(
      `import { parseManuscript } from '@libraz/mejiro';
import type { ManuscriptDialect, ParseManuscriptOptions, ParsedManuscript } from '@libraz/mejiro';
const dialect: ManuscriptDialect = 'narou';
const options: ParseManuscriptOptions = { dialect };
export const parsed: ParsedManuscript = parseManuscript('漢字《かんじ》', options);
export const text: string = parsed.text;
export const first = parsed.inlineAnnotations[0];
export const mutate = parsed.inlineAnnotations.push(first);
`,
      { fails: ['const mutate'] },
    );
    expect(typeof parseManuscript).toBe('function');
  });

  it('no longer offers the ruby-only parser', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/manuscript.ts'), 'utf8');

    expect('parseManuscriptRuby' in core).toBe(false);
    expect(source).not.toContain('parseManuscriptRuby');
  });

  it('describes every annotation variant with the type discriminant and shared ruby keys', () => {
    const source =
      '｜漢字《かんじ》と漢字《かん》と《《傍点》》と〔20〕と**強**と*斜*と[[#n1]]と[リンク](https://example.com)';
    const parsed: ParsedManuscript = parseManuscript(source);
    const byType = new Map(parsed.inlineAnnotations.map((ann) => [ann.type, ann]));

    expect([...byType.keys()].sort()).toEqual(
      ['em', 'emphasis', 'footnote-ref', 'link', 'ruby', 'strong', 'tcy'].sort(),
    );
    expect(parsed.inlineAnnotations.every((ann) => !('kind' in ann))).toBe(true);
    expect(byType.get('footnote-ref')).toMatchObject({ noteId: 'n1' });

    const rubies = parsed.inlineAnnotations.filter((ann) => ann.type === 'ruby');
    expect(rubies).toHaveLength(2);
    for (const ruby of rubies) {
      expect(ruby).toMatchObject({ rubyType: 'group' });
      expect(ruby).not.toHaveProperty('type', 'group');
    }
  });

  it('marks a single-character ruby base as mono through rubyType', () => {
    const parsed = parseManuscript('漢《かん》', { dialect: 'narou' });

    expect(parsed.inlineAnnotations).toEqual([
      { type: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'かん', rubyType: 'mono' },
    ]);
  });
});
