// @vitest-environment happy-dom

import type { AnchorRect, ChapterLayout, PageResult, SpreadResult } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { vi } from 'vitest';
import { type App, createApp, defineComponent } from 'vue';

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

/** Listener registry standing in for `EditableEpub.subscribe`. */
function editorListeners(): {
  subscribe: ReturnType<typeof vi.fn>;
  notify: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    notify: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

/** One-chapter editable book whose paragraph blocks hold `texts`, ids `b-1`, `b-2`, … */
function editableBook(title: string, texts: readonly string[]) {
  return {
    title,
    chapters: [
      {
        href: 'OPS/Text/chapter.xhtml',
        title: 'C1',
        originalXhtml: '',
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
 * Editable-EPUB stub over a one-chapter book of `texts`. Every mutator
 * notifies its subscribers, as the core editor does after each change.
 */
export function mockEditableBook(title: string, ...texts: string[]): unknown {
  const { subscribe, notify } = editorListeners();
  return {
    epub: editableBook(title, texts),
    history: { canUndo: false, canRedo: false, depth: 0, redoDepth: 0 },
    subscribe,
    updateParagraph: vi.fn(notify),
    setInlineAnnotations: vi.fn(notify),
    addImage: vi.fn((_chapterIndex: number, image: { filename: string }) => {
      notify();
      return { kind: 'image', id: 'image-1', assetKey: image.filename };
    }),
    undo: vi.fn(() => false),
    redo: vi.fn(() => false),
    export: vi.fn(async () => new Uint8Array(4)),
  };
}

/** Shape of {@link mockHistoryEditor} the tests read back. */
export interface HistoryEditorStub {
  epub: {
    chapters: { blocks: { id: string; text: string }[] }[];
  };
}

/**
 * Editable-EPUB stub whose edits, undo and redo replace the block list with a
 * fresh array and notify subscribers, the way the core editor applies each
 * command.
 */
export function mockHistoryEditor(initialText: string): unknown {
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let current = initialText;
  const { subscribe, notify } = editorListeners();
  const epub = editableBook('History', [current]);
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

/**
 * Mounts a one-shot component that runs `setup()` inside `setup()` so the
 * composable has a valid component instance. Returns the result plus an
 * unmount helper.
 */
export function withSetup<T>(setup: () => T): { result: T; unmount: () => void; app: App } {
  let result!: T;
  const app = createApp(
    defineComponent({
      setup() {
        result = setup();
        return () => null;
      },
    }),
  );
  app.mount(document.createElement('div'));
  return { result, unmount: () => app.unmount(), app };
}

export function mockLayout(pageCount = 6): ChapterLayout {
  const spread = (i: number): SpreadResult =>
    ({ spreadIndex: i, pageCount }) as unknown as SpreadResult;
  return {
    pageCount,
    getSpread: vi.fn(spread),
    setImages: vi.fn((i: number) => spread(i)),
    clearImages: vi.fn(),
    resize: vi.fn(),
  } as unknown as ChapterLayout;
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
 * Gives every element a 1 × 1 client box. happy-dom lays nothing out, and a
 * surface measuring zero is never fitted a page size; the smallest box that
 * can be fitted yields the minimum page size (280 × 400), which is what the
 * reader tests paginate against. Call once at module scope.
 */
export function giveElementsAClientBox(): void {
  for (const name of ['clientWidth', 'clientHeight']) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => 1 });
  }
}
