import { describe, it } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';

/** Probe header: the components and an EPUB value to pass them. */
const HEADER = `import { createElement } from 'react';
import type { EpubBook } from '@libraz/mejiro/epub';
import {
  MejiroEditor,
  MejiroManuscriptEditor,
  MejiroReader,
} from '@libraz/mejiro-react';
declare const epub: EpubBook;
`;

describe('MejiroReader props', () => {
  it('accepts one book source and rejects epub together with epubUrl', () => {
    expectTypeErrors(
      `${HEADER}
import type {
  MejiroReaderManuscriptProps,
  MejiroReaderParsedProps,
  MejiroReaderPickerProps,
  MejiroReaderProps,
  MejiroReaderUrlProps,
} from '@libraz/mejiro-react';
const parsed: MejiroReaderParsedProps = { epub };
const url: MejiroReaderUrlProps = { epubUrl: '/b.epub' };
const picker: MejiroReaderPickerProps = { enableDropZone: true };
const manuscript: MejiroReaderManuscriptProps = { manuscript: [{ title: 'a', body: 'b' }] };
const both: MejiroReaderProps = { epub, epubUrl: '/b.epub' };
import type { MejiroReaderControlledProps } from '@libraz/mejiro-react';
import type { MejiroReaderFileProps } from '@libraz/mejiro-react';`,
      {
        fails: [
          "const both: MejiroReaderProps = { epub, epubUrl: '/b.epub' };",
          'import type { MejiroReaderControlledProps }',
          'import type { MejiroReaderFileProps }',
        ],
      },
    );
  });

  it('names the position props chapterIndex / spreadIndex / anchor with onXxxChange handlers', () => {
    expectTypeErrors(
      `${HEADER}
createElement(MejiroReader, {
  epub,
  chapterIndex: 1,
  onChapterIndexChange: (chapterIndex: number) => void chapterIndex,
  spreadIndex: 2,
  onSpreadIndexChange: (spreadIndex: number) => void spreadIndex,
  anchor: { chapterIndex: 1, paragraphIndex: 0, charIndex: 0 },
  onAnchorChange: (anchor) => void anchor.chapterIndex,
  onChapterFinished: (chapterIndex: number) => void chapterIndex,
});
createElement(MejiroReader, { epub, chapter: 1 });
createElement(MejiroReader, { epub, spreadIdx: 1 });
createElement(MejiroReader, { epub, onSpreadIdxChange: () => {} });
createElement(MejiroReader, { epub, onSpreadChange: () => {} });
createElement(MejiroReader, { epub, onChapterChange: () => {} });
createElement(MejiroReader, { epub, onChapterCompleted: () => {} });`,
      {
        fails: [
          'chapter: 1 }',
          'spreadIdx: 1 }',
          'onSpreadIdxChange: () => {} }',
          'onSpreadChange: () => {} }',
          'onChapterChange: () => {} }',
          'onChapterCompleted: () => {} }',
        ],
      },
    );
  });

  it('names chrome flags show* and drops bare, enableHeader and enableChapterNav', () => {
    expectTypeErrors(
      `${HEADER}
import type { MejiroChapterNavMode } from '@libraz/mejiro-react';
const none: MejiroChapterNavMode = 'none';
createElement(MejiroReader, {
  epub,
  title: 'Book',
  showStats: true,
  showSettings: false,
  showPageIndicator: false,
  showImageOverlayButton: true,
  chapterNavMode: none,
  enableKeyboard: false,
});
createElement(MejiroReader, { epub, bare: true });
createElement(MejiroReader, { epub, enableHeader: false });
createElement(MejiroReader, { epub, enableChapterNav: false });
createElement(MejiroReader, { epub, enableStats: true });
createElement(MejiroReader, { epub, enableSettings: true });
createElement(MejiroReader, { epub, enablePageIndicator: true });
createElement(MejiroReader, { epub, enableImageOverlay: true });`,
      {
        fails: [
          'bare: true }',
          'enableHeader: false }',
          'enableChapterNav: false }',
          'enableStats: true }',
          'enableSettings: true }',
          'enablePageIndicator: true }',
          'enableImageOverlay: true }',
        ],
      },
    );
  });

  it('takes Partial<BookOptions> and read-only arrays, and drops MejiroBookOptions', () => {
    expectTypeErrors(
      `${HEADER}
import type { BookOptions } from '@libraz/mejiro/book';
import type { FontChoice, ReaderAnnotation } from '@libraz/mejiro-react';
declare const options: Partial<BookOptions>;
declare const fonts: readonly FontChoice[];
declare const annotations: readonly ReaderAnnotation[];
createElement(MejiroReader, { epub, options, fonts, annotations });
createElement(MejiroReader, { epub, options: { kinsoku: 'loose', strictFontCheck: true } });
createElement(MejiroReader, { epub, options: { mode: 'loose' } });
import type { MejiroBookOptions } from '@libraz/mejiro/book';`,
      { fails: ["options: { mode: 'loose' } }", 'import type { MejiroBookOptions }'] },
    );
  });

  it('resolves spreadMode itself and passes the URL fetcher a signal', () => {
    expectTypeErrors(
      `${HEADER}
import type { FetchEpubOptions, MejiroSpreadMode, ResolvedSpreadMode } from '@libraz/mejiro-react';
const auto: MejiroSpreadMode = 'auto';
createElement(MejiroReader, {
  epubUrl: '/b.epub',
  spreadMode: auto,
  fetchEpub: async (url: string, options: FetchEpubOptions) => {
    void options.signal.aborted;
    return new Uint8Array(await (await fetch(url, { signal: options.signal })).arrayBuffer());
  },
});
const resolved: ResolvedSpreadMode = 'auto';
createElement(MejiroReader, { epub, single: true });`,
      { fails: ["const resolved: ResolvedSpreadMode = 'auto';", 'single: true }'] },
    );
  });
});

describe('MejiroReader handle and events', () => {
  it('reports a SpreadPosition and names bus events after their prop', () => {
    expectTypeErrors(
      `import type {
  MejiroReaderChapterFinishedEvent,
  MejiroReaderEventMap,
  MejiroReaderHandle,
  MejiroReaderSpreadIndexChangeEvent,
  ReadingAnchorRange,
  SpreadPosition,
} from '@libraz/mejiro-react';
declare const handle: MejiroReaderHandle;
const position: SpreadPosition = handle.getSpreadPosition();
const counts: [number, number, number, number] = [
  position.chapterIndex,
  position.spreadIndex,
  position.spreadCount,
  position.pageCount,
];
const range: ReadingAnchorRange | null = handle.getVisibleRange();
handle.subscribe('spreadIndexChange', (event: MejiroReaderSpreadIndexChangeEvent) => {
  void [event.chapterIndex, event.spreadIndex];
});
handle.subscribe('chapterFinished', (event: MejiroReaderChapterFinishedEvent) => {
  void event.chapterIndex;
});
void handle.updateOptions({ fontSize: 20 });
const events: keyof MejiroReaderEventMap = 'spreadIndexChange';
handle.getReadingPosition();
handle.subscribe('spreadChanged', () => {});
void handle.setOptions({ fontSize: 20 });
void handle.updateOptions({ strictFontCheck: true });
import type { ReadingPosition } from '@libraz/mejiro-react';`,
      {
        fails: [
          'handle.getReadingPosition();',
          "handle.subscribe('spreadChanged'",
          'handle.setOptions(',
          'strictFontCheck: true',
          'import type { ReadingPosition }',
        ],
      },
    );
  });
});

describe('MejiroEditor props', () => {
  it('folds the export controls into ExportPolicy and loads with fetchOptions / fetchEpub', () => {
    expectTypeErrors(
      `${HEADER}
import type { ExportPolicy, ManuscriptPreviewProps } from '@libraz/mejiro-react';
const policy: ExportPolicy = {
  download: false,
  transform: async (bytes: Uint8Array<ArrayBuffer>) => bytes,
  watermark: 'reader@example.com',
};
const preview: ManuscriptPreviewProps = { theme: 'dark', options: { fontSize: 18 }, showStats: true };
createElement(MejiroEditor, {
  epubUrl: '/b.epub',
  fetchOptions: { credentials: 'include' },
  fetchEpub: async (_url, options) => {
    void options.signal;
    return new Uint8Array(0);
  },
  exportPolicy: policy,
  previewProps: preview,
  showExportButton: false,
  onExport: (bytes: Uint8Array) => void bytes.byteLength,
});
createElement(MejiroEditor, { enableExport: false });
createElement(MejiroEditor, { onBeforeExport: () => false });
createElement(MejiroEditor, { exportPolicy: { encrypt: (b: ArrayBuffer) => b } });
createElement(MejiroEditor, { exportPolicy: { allowDownload: false } });
const legacyWatermark: ExportPolicy = { watermark: { text: 'x' } };
import type { MejiroExportPolicy } from '@libraz/mejiro-react';
const previewEpub: ManuscriptPreviewProps = { epub };`,
      {
        fails: [
          'enableExport: false }',
          'onBeforeExport: () => false }',
          'encrypt: (b: ArrayBuffer) => b',
          'allowDownload: false',
          "watermark: { text: 'x' }",
          'import type { MejiroExportPolicy }',
          'const previewEpub: ManuscriptPreviewProps = { epub };',
        ],
      },
    );
  });
});

describe('MejiroManuscriptEditor props', () => {
  it('controls chapters through onChaptersChange and times autosave in milliseconds', () => {
    expectTypeErrors(
      `${HEADER}
import type { ManuscriptChapter } from '@libraz/mejiro-react';
declare const chapters: readonly ManuscriptChapter[];
createElement(MejiroManuscriptEditor, {
  chapters,
  onChaptersChange: (next: readonly ManuscriptChapter[]) => void next.length,
  autosaveDebounceMs: 400,
  onExport: (bytes: Uint8Array) => void bytes.byteLength,
  previewProps: { chapterNavMode: 'none', theme: 'sepia' },
});
createElement(MejiroManuscriptEditor, { autosaveDelay: 400 });
createElement(MejiroManuscriptEditor, { previewProps: { bare: true } });
import type { ManuscriptEditorChapter } from '@libraz/mejiro-react';`,
      {
        fails: ['autosaveDelay: 400 }', 'bare: true }', 'import type { ManuscriptEditorChapter }'],
      },
    );
  });
});
