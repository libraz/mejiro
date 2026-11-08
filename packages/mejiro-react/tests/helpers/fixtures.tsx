// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { AnchorRect, ChapterLayout, PageResult, SpreadResult } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { vi } from 'vitest';

export function fakeEpub(): EpubBook {
  return {
    title: 'Book',
    author: 'A',
    chapters: [
      { title: 'C1', paragraphs: [{ text: 'a', inlineAnnotations: [] }] },
      { title: 'C2', paragraphs: [{ text: 'b', inlineAnnotations: [] }] },
      { title: 'C3', paragraphs: [{ text: 'c', inlineAnnotations: [] }] },
    ],
  };
}

export function pageResult(text: string): PageResult {
  return {
    page: {
      paragraphs: [
        {
          lines: [{ segments: [{ type: 'text', text }] }],
        },
      ],
    },
    lines: [{ segments: [{ type: 'text', text }], fontSize: 16 }],
    slots: [{ xPos: 0, yStart: 0, height: 240 }],
    hasImages: false,
  };
}

export function selectionRect(
  overrides: Partial<AnchorRect & { color: string }> = {},
): AnchorRect & {
  color?: string;
} {
  return {
    spreadIndex: 0,
    pageIndex: 0,
    side: 'right',
    x: 10,
    y: 20,
    width: 24,
    height: 18,
    ...overrides,
  };
}

/** Geometry and typography a fake layout reports, as a measured `ChapterLayout` does. */
export const FAKE_LAYOUT_METRICS = {
  geometry: {
    pageWidth: 320,
    lineWidth: 360,
    paddingX: 0,
    paddingY: 0,
    pageHeight: 460,
    contentHeight: 360,
  },
  typography: { fontFamily: 'serif', fontSize: 16, lineSpacing: 1.8 },
};

export function fakeScrollLayout(pageCount: number): ChapterLayout {
  return {
    ...FAKE_LAYOUT_METRICS,
    pageCount,
    getPage: (index: number) => pageResult(`頁${index + 1}`),
  } as unknown as ChapterLayout;
}

/** Listener set behind a stub editor's `subscribe`, and the call that notifies it. */
function stubListeners(): { subscribe: ReturnType<typeof vi.fn>; notify: () => void } {
  const listeners = new Set<() => void>();
  return {
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    notify: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

/** One-chapter editable document whose paragraph blocks hold `texts`. */
function editableDocument(title: string, texts: readonly string[]) {
  return {
    title,
    chapters: [
      {
        href: 'OPS/Text/chapter.xhtml',
        title: 'C1',
        blocks: texts.map((text, i) => ({
          kind: 'paragraph' as const,
          id: `b-${i + 1}`,
          text,
          inlineAnnotations: [] as never[],
        })),
        imageAssets: new Map(),
      },
    ],
  };
}

/**
 * Editing-session stub over a one-chapter document with paragraph blocks
 * `b-1`, `b-2`, … holding `texts`. Its mutators are spies that change nothing.
 */
export function mockEditableBook(title: string, ...texts: string[]): unknown {
  const { subscribe } = stubListeners();
  return {
    epub: editableDocument(title, texts),
    history: { canUndo: false, canRedo: false, depth: 0, redoDepth: 0 },
    subscribe,
    updateParagraph: vi.fn(),
    setInlineAnnotations: vi.fn(),
    addImage: vi.fn(() => ({ kind: 'image', id: 'img-1', assetKey: 'a.png' })),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
    export: vi.fn(async () => new Uint8Array(4)),
  };
}

/** Shape of the document {@link mockHistoryEditor} edits. */
export interface HistoryEditorStub {
  epub: {
    chapters: { blocks: { id: string; text: string }[] }[];
  };
}

/**
 * Editing-session stub whose `updateParagraph`, undo and redo replace the
 * single block `b-1` with a fresh object and notify subscribers, as the core
 * editor does after each command.
 */
export function mockHistoryEditor(initialText: string): unknown {
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let current = initialText;
  const epub = editableDocument('History', [current]);
  const { subscribe, notify } = stubListeners();
  function sync(next: string): void {
    current = next;
    epub.chapters[0].blocks = [{ kind: 'paragraph', id: 'b-1', text: next, inlineAnnotations: [] }];
    notify();
  }
  return {
    epub,
    history: { canUndo: false, canRedo: false, depth: 0, redoDepth: 0 },
    subscribe,
    updateParagraph: vi.fn((_chapterIndex: number, _blockId: string, patch: { text: string }) => {
      undoStack.push(current);
      redoStack.length = 0;
      sync(patch.text);
    }),
    setInlineAnnotations: vi.fn(),
    addImage: vi.fn(),
    undo: vi.fn(() => {
      const previous = undoStack.pop();
      if (previous === undefined) return false;
      redoStack.push(current);
      sync(previous);
      return true;
    }),
    redo: vi.fn(() => {
      const next = redoStack.pop();
      if (next === undefined) return false;
      undoStack.push(current);
      sync(next);
      return true;
    }),
    export: vi.fn(async () => new Uint8Array(4)),
  };
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Layout stub whose spreads carry only `pageCount` and the index they were read at. */
export function mockLayout(pageCount = 6): ChapterLayout {
  const spread = (spreadIndex = 0): SpreadResult =>
    ({ pageCount, spreadIndex }) as unknown as SpreadResult;
  return {
    pageCount,
    getSpread: vi.fn(spread),
    setImages: vi.fn(spread),
    clearImages: vi.fn(),
    resize: vi.fn(),
  } as unknown as ChapterLayout;
}

/** A detached `div` with a client box, as a laid-out reading surface has. */
export function sizedSurface(width = 640, height = 480): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
  return el;
}

/**
 * Counts the `loadingdone` listeners attached to `document.fonts` while
 * installed; `restore` puts the host's own methods back.
 */
export function countFontListeners(): { listeners: () => number; restore: () => void } {
  const handlers = new Set<unknown>();
  const fonts = document.fonts as FontFaceSet & Record<string, unknown>;
  const originals = ['addEventListener', 'removeEventListener'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(fonts, name)] as const,
  );
  Object.defineProperty(fonts, 'addEventListener', {
    configurable: true,
    value: (type: string, listener: unknown) => {
      if (type === 'loadingdone') handlers.add(listener);
    },
  });
  Object.defineProperty(fonts, 'removeEventListener', {
    configurable: true,
    value: (type: string, listener: unknown) => {
      if (type === 'loadingdone') handlers.delete(listener);
    },
  });
  return {
    listeners: () => handlers.size,
    restore: () => {
      for (const [name, original] of originals) {
        if (original) Object.defineProperty(fonts, name, original);
        else delete fonts[name];
      }
    },
  };
}

/** A `File` whose `arrayBuffer` is spied on, to prove an oversized file is never read. */
export function spiedEpubFile(bytes: number): { file: File; read: ReturnType<typeof vi.fn> } {
  const file = new File([new Uint8Array(bytes)], 'book.epub', { type: 'application/epub+zip' });
  const read = vi.fn(() => Promise.resolve(new ArrayBuffer(bytes)));
  Object.defineProperty(file, 'arrayBuffer', { value: read });
  return { file, read };
}

/**
 * Gives every reader surface a 1×1 client box, the smallest one the layout
 * hooks measure; the book then sizes its pages at the minimum page geometry.
 * Returns the function that removes the stub.
 */
export function measurableReaderSurface(): () => void {
  const isSurface = (el: HTMLElement) => el.classList.contains('mejiro-reader-surface');
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isSurface(this) ? 1 : 0;
  });
  const height = vi
    .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return isSurface(this) ? 1 : 0;
    });
  return () => {
    width.mockRestore();
    height.mockRestore();
  };
}
