import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clampEditableEpubSelection, cloneEditableEpubBook } from '../../src/epub/clone.js';
import type { EditableBlock, EditableEpubBook, EditableEpubChapter } from '../../src/epub/types.js';

const PACKAGES_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Published packages whose sources must not carry a second book clone. */
const PUBLISHED_SOURCES = ['mejiro/src', 'mejiro-react/src', 'mejiro-vue/src'];

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/u.test(entry.name)) files.push(full);
    }
  };
  for (const source of PUBLISHED_SOURCES) walk(path.join(PACKAGES_ROOT, source));
  return files;
}

/**
 * `<package>/<relative path>:<symbol>` for every declared helper that clones an
 * editable book, chapter or block. Clone helpers for unrelated shapes (heading
 * styles, a single annotation) are out of scope.
 */
function bookCloneDeclarations(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:function|const)\s+(clone[A-Za-z0-9_]*)/gu)) {
      if (!/Editable|Book/u.test(match[1])) continue;
      found.push(`${path.relative(PACKAGES_ROOT, file)}:${match[1]}`);
    }
  }
  return found.sort();
}

function makeChapter(): EditableEpubChapter {
  return {
    title: 'Chapter 1',
    href: 'OPS/Text/chapter-001.xhtml',
    originalXhtml: '<html></html>',
    blocks: [
      {
        kind: 'paragraph',
        id: 'p1',
        text: '吾輩は猫である',
        inlineAnnotations: [{ type: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'わがはい' }],
      },
      { kind: 'image', id: 'i1', assetKey: 'figure-01.png', alt: 'figure' },
    ],
    imageAssets: new Map([
      ['figure-01.png', { filename: 'figure-01.png', data: new Uint8Array([1, 2]) }],
    ]),
  };
}

function makeBook(): EditableEpubBook {
  return {
    title: 'Book',
    author: 'Author',
    chapters: [makeChapter()],
  };
}

/** Write access to a fixture chapter's blocks, which the public type exposes read-only. */
function blocksOf(chapter: EditableEpubChapter): EditableBlock[] {
  return chapter.blocks as EditableBlock[];
}

describe('cloneEditableEpubBook', () => {
  it('isolates every mutable container from the source book', () => {
    const book = makeBook();
    const copy = cloneEditableEpubBook(book);

    expect(copy).toEqual(book);
    expect(copy).not.toBe(book);
    expect(copy.chapters[0]).not.toBe(book.chapters[0]);
    expect(copy.chapters[0].blocks).not.toBe(book.chapters[0].blocks);
    expect(copy.chapters[0].blocks[0]).not.toBe(book.chapters[0].blocks[0]);
    expect(copy.chapters[0].imageAssets).not.toBe(book.chapters[0].imageAssets);

    blocksOf(copy.chapters[0]).push({
      kind: 'paragraph',
      id: 'p2',
      text: 'x',
      inlineAnnotations: [],
    });
    (copy.chapters[0].imageAssets as Map<string, unknown>).set('extra.png', {
      filename: 'extra.png',
      url: 'u',
    });

    expect(book.chapters[0].blocks).toHaveLength(2);
    expect(book.chapters[0].imageAssets.has('extra.png')).toBe(false);
  });

  it('copies inline annotations object by object', () => {
    const book = makeBook();
    const copy = cloneEditableEpubBook(book);
    const sourceBlock = book.chapters[0].blocks[0];
    const copiedBlock = copy.chapters[0].blocks[0];
    if (sourceBlock.kind !== 'paragraph' || copiedBlock.kind !== 'paragraph') {
      throw new Error('fixture must start with a paragraph block');
    }

    expect(copiedBlock.inlineAnnotations[0]).not.toBe(sourceBlock.inlineAnnotations[0]);

    // A UI editing the preview copy must not reach the editor's annotations.
    (copiedBlock.inlineAnnotations[0] as { rubyText: string }).rubyText = 'changed';
    expect((sourceBlock.inlineAnnotations[0] as { rubyText: string }).rubyText).toBe('わがはい');
  });

  it('copies jukugo split points and asset entries, sharing only binary payloads', () => {
    const book = makeBook();
    const jukugo = {
      type: 'ruby' as const,
      startIndex: 0,
      endIndex: 2,
      rubyText: 'わがはい',
      rubyType: 'jukugo' as const,
      jukugoSplitPoints: [1],
    };
    blocksOf(book.chapters[0])[0] = { ...book.chapters[0].blocks[0], inlineAnnotations: [jukugo] };
    const data = new Uint8Array([1]);
    (book.chapters[0].imageAssets as Map<string, unknown>).set('figure-01.png', {
      filename: 'figure-01.png',
      data,
    });

    const copy = cloneEditableEpubBook(book);
    const copiedBlock = copy.chapters[0].blocks[0];
    if (copiedBlock.kind !== 'paragraph') throw new Error('fixture must start with a paragraph');
    const splitPointsOf = (annotation: unknown) =>
      (annotation as { jukugoSplitPoints: number[] }).jukugoSplitPoints;
    splitPointsOf(copiedBlock.inlineAnnotations[0])[0] = 9;
    const copiedAsset = copy.chapters[0].imageAssets.get('figure-01.png');
    if (copiedAsset) copiedAsset.filename = 'changed.png';

    expect(jukugo.jukugoSplitPoints).toEqual([1]);
    expect(book.chapters[0].imageAssets.get('figure-01.png')?.filename).toBe('figure-01.png');
    expect(copiedAsset?.data).toBe(data);
  });

  it('carries over a chapter field the clone does not name', () => {
    // The clone spreads each chapter before overriding its containers, so a
    // field added to EditableEpubChapter reaches every surface without an edit
    // here. This stands in for that future field.
    interface ExtendedChapter extends EditableEpubChapter {
      reviewState: { approved: boolean };
    }
    const book = makeBook();
    const chapter = book.chapters[0] as ExtendedChapter;
    chapter.reviewState = { approved: true };

    const copy = cloneEditableEpubBook(book);

    expect((copy.chapters[0] as ExtendedChapter).reviewState).toEqual({ approved: true });
  });
});

describe('clampEditableEpubSelection', () => {
  it('confines a selection to the chapters and blocks the book has', () => {
    const book = makeBook();

    expect(clampEditableEpubSelection(book, { chapterIndex: 5, blockId: 'i1' })).toEqual({
      chapterIndex: 0,
      blockId: 'i1',
    });
    expect(clampEditableEpubSelection(book, { chapterIndex: -2, blockId: 'gone' })).toEqual({
      chapterIndex: 0,
      blockId: 'p1',
    });
  });

  it('truncates fractional indices and falls back on non-finite ones', () => {
    const book = makeBook();
    const twoChapters: EditableEpubBook = {
      ...book,
      chapters: [...book.chapters, { ...makeChapter(), href: 'OPS/Text/chapter-002.xhtml' }],
    };

    expect(
      clampEditableEpubSelection(twoChapters, { chapterIndex: 1.9, blockId: null }).chapterIndex,
    ).toBe(1);
    expect(
      clampEditableEpubSelection(twoChapters, { chapterIndex: Number.NaN, blockId: null })
        .chapterIndex,
    ).toBe(0);
  });

  it('resolves to no block when there is no book or no block', () => {
    const empty: EditableEpubBook = { ...makeBook(), chapters: [] };
    const blockless: EditableEpubBook = {
      ...makeBook(),
      chapters: [{ ...makeChapter(), blocks: [] }],
    };

    for (const book of [null, empty, blockless]) {
      expect(clampEditableEpubSelection(book, { chapterIndex: 3, blockId: 'p1' })).toEqual({
        chapterIndex: 0,
        blockId: null,
      });
    }
  });
});

describe('book clone duplication', () => {
  it('declares every editable-book clone helper in the one core module', () => {
    // Pinned by symbol name rather than by line, so moving code inside the
    // module is free while a second copy in any published package fails here.
    expect(bookCloneDeclarations()).toEqual([
      'mejiro/src/epub/clone.ts:cloneEditableBlock',
      'mejiro/src/epub/clone.ts:cloneEditableEpubBook',
      'mejiro/src/epub/clone.ts:cloneEditableEpubChapter',
    ]);
  });

  it('keeps the framework packages free of a local book clone', () => {
    const frameworkClones = bookCloneDeclarations().filter(
      (entry) => entry.startsWith('mejiro-react/') || entry.startsWith('mejiro-vue/'),
    );

    expect(frameworkClones).toEqual([]);
  });
});
