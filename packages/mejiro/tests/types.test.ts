import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LINE_SPACING } from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

const SRC_ROOT = join(import.meta.dirname, '../src');

describe('shared data types', () => {
  describe('root entry', () => {
    it('declares paragraph, anchor and annotation types for core-only consumers', () => {
      expectTypeErrors(
        `import type {
  BookParagraph,
  ChapterSource,
  HeadingLevel,
  InChapterAnchor,
  InlineAnnotation,
  ParagraphKind,
  ReadingAnchor,
} from '@libraz/mejiro';
export const level: HeadingLevel = 3;
export const kind: ParagraphKind = 'sceneBreak';
export const paragraph: BookParagraph = { text: 'a', kind: 'heading', headingLevel: 2 };
export const source: ChapterSource = { paragraphs: [paragraph] };
export const anchor: InChapterAnchor = { paragraphIndex: 0, charIndex: 0 };
export const reading: ReadingAnchor = { chapterIndex: 0, paragraphIndex: 0, charIndex: 0 };
export const annotation: InlineAnnotation = { type: 'footnote-ref', startIndex: 0, endIndex: 1, noteId: 'n' };
`,
        { fails: [] },
      );
    });

    it('rejects out-of-range heading levels and the pre-0.11 anchor and annotation keys', () => {
      expectTypeErrors(
        `import type { BookParagraph, HeadingLevel, InlineAnnotation, ReadingAnchor } from '@libraz/mejiro';
export const level: HeadingLevel = 7;
export const paragraph: BookParagraph = { text: 'a', headingLevel: 0 };
export const oldAnchor: ReadingAnchor = { chapter: 0, paragraph: 0, charIndex: 0 };
export const oldDiscriminant: InlineAnnotation = { kind: 'tcy', startIndex: 0, endIndex: 1 };
export const oldFootnote: InlineAnnotation = { type: 'footnote', startIndex: 0, endIndex: 1, noteId: 'n' };
export const ruby: InlineAnnotation = { type: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'r', rubyType: 'mono' };
export const oldRuby: InlineAnnotation = { type: 'ruby', startIndex: 0, endIndex: 1, rubyText: 'r', rubyKind: 'mono' };
`,
        {
          fails: [
            'const level',
            'const paragraph',
            'const oldAnchor',
            'const oldDiscriminant',
            'const oldFootnote',
            'const oldRuby:',
          ],
        },
      );
    });

    it('exports the default line spacing as 1.8', () => {
      expect(DEFAULT_LINE_SPACING).toBe(1.8);
    });
  });

  describe('subpath re-exports', () => {
    it('is one ParagraphKind and one BookParagraph whichever subpath imports them', () => {
      expectTypeErrors(
        `import type { BookParagraph, InlineAnnotation, ParagraphKind } from '@libraz/mejiro';
import type { InlineAnnotation as BrowserAnnotation } from '@libraz/mejiro/browser';
import type { BookParagraph as BookPathParagraph, ParagraphKind as BookPathKind } from '@libraz/mejiro/book';
import type { ParagraphKind as EpubKind } from '@libraz/mejiro/epub';
export const fromBook = (kind: BookPathKind): ParagraphKind => kind;
export const fromEpub = (kind: EpubKind): BookPathKind => kind;
export const toEpub = (kind: ParagraphKind): EpubKind => kind;
export const paragraph = (p: BookPathParagraph): BookParagraph => p;
export const annotation = (a: BrowserAnnotation): InlineAnnotation => a;
`,
        { fails: [] },
      );
    });

    it('does not accept a value outside the single ParagraphKind union', () => {
      expectTypeErrors(
        `import type { ParagraphKind as BookKind } from '@libraz/mejiro/book';
import type { ParagraphKind as EpubKind } from '@libraz/mejiro/epub';
export const wrongForBook: BookKind = 'caption';
export const wrongForEpub: EpubKind = 'caption';
`,
        { fails: ['wrongForBook', 'wrongForEpub'] },
      );
    });
  });

  describe('declarations', () => {
    it('declares each shared type in exactly one source file', () => {
      const names = [
        'ParagraphKind',
        'BookParagraph',
        'InlineAnnotation',
        'InChapterAnchor',
        'ReadingAnchor',
      ];
      const declarations = new Map<string, string[]>(names.map((name) => [name, []]));
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.name.endsWith('.ts')) {
            const source = readFileSync(path, 'utf8');
            for (const name of names) {
              if (new RegExp(`^export (type|interface) ${name}\\b`, 'mu').test(source)) {
                declarations.get(name)?.push(path.slice(SRC_ROOT.length + 1));
              }
            }
          }
        }
      };
      walk(SRC_ROOT);
      for (const name of names) expect(declarations.get(name), name).toEqual(['types.ts']);
    });
  });

  describe('layering', () => {
    it('keeps the root entry free of imports from the book, browser, epub and render subpaths', () => {
      const offenders: string[] = [];
      for (const entry of readdirSync(SRC_ROOT, { withFileTypes: true })) {
        if (!(entry.isFile() && entry.name.endsWith('.ts'))) continue;
        const source = readFileSync(join(SRC_ROOT, entry.name), 'utf8');
        for (const match of source.matchAll(/from\s+'(\.\/[^']+)'/gu)) {
          if (/^\.\/(book|browser|epub|render|analysis|image)\//u.test(match[1])) {
            offenders.push(`${entry.name}: ${match[1]}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('binary input', () => {
    it('accepts an ArrayBuffer or a Uint8Array and rejects other values', () => {
      expectTypeErrors(
        `import type { BinaryInput } from '@libraz/mejiro';
export const fromBuffer: BinaryInput = new ArrayBuffer(4);
export const fromView: BinaryInput = new Uint8Array(4);
export const fromString: BinaryInput = 'bytes';
export const fromInts: BinaryInput = new Uint16Array(4);
`,
        { fails: ['fromString', 'fromInts'] },
      );
    });
  });

  describe('editable settings', () => {
    it('describes the settings panel fields on its own, with the kinsoku key', () => {
      expectTypeErrors(
        `import type { EditableSettings } from '@libraz/mejiro';
export const ok: EditableSettings = { fontFamily: 'serif', fontSize: 18, lineSpacing: 1.8, kinsoku: 'loose', enableHanging: true };
export const oldKey: EditableSettings = { fontFamily: 'serif', fontSize: 18, mode: 'loose' };
`,
        { fails: ['const oldKey'] },
      );
    });
  });
});
