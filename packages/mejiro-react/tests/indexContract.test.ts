import * as core from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import * as i18n from '../src/i18n.js';

describe('message catalogs and helpers come from the core package', () => {
  it('re-exports the frozen, read-only core catalogs', () => {
    expect(i18n.enMessages).toBe(core.enMessages);
    expect(i18n.jaMessages).toBe(core.jaMessages);
    expect(Object.isFrozen(i18n.enMessages)).toBe(true);
    expectTypeErrors(
      `import { enMessages, type MejiroMessages } from '@libraz/mejiro-react';
const title: string = enMessages.tocTitle;
const messages: MejiroMessages = enMessages;
enMessages.tocTitle = 'x';`,
      { fails: ["enMessages.tocTitle = 'x'"] },
    );
  });

  it('re-exports resolveMessages and formatMessage under the core names and drops format', () => {
    expect(i18n.resolveMessages).toBe(core.resolveMessages);
    expect(i18n.formatMessage).toBe(core.formatMessage);
    expect('format' in i18n).toBe(false);
    expectTypeErrors(
      `import { enMessages, formatMessage, resolveMessages, type MejiroI18nProviderProps } from '@libraz/mejiro-react';
const catalog = resolveMessages('ja', { tocTitle: 'x' }, enMessages);
const text: string = formatMessage(catalog.chapterN, { n: 1 });
const props: MejiroI18nProviderProps = { locale: 'ja', children: null };
import { format } from '@libraz/mejiro-react';`,
      { fails: ["import { format } from '@libraz/mejiro-react'"] },
    );
  });
});

describe('the package barrel names the primitive shapes', () => {
  it('exports SelectionRect and ReaderAnnotation for the selection and highlight inputs', () => {
    expectTypeErrors(
      `import type { ReaderAnnotation, SelectionRect } from '@libraz/mejiro-react';
const rect: SelectionRect = { spreadIndex: 0, pageIndex: 0, side: 'right', x: 0, y: 0, width: 1, height: 1, color: 'red' };
const highlight: ReaderAnnotation = {
  chapterIndex: 0,
  start: { paragraphIndex: 0, charIndex: 0 },
  end: { paragraphIndex: 0, charIndex: 2 },
  color: 'red',
};
const bad: SelectionRect = { spreadIdx: 0, pageIndex: 0, side: 'right', x: 0, y: 0, width: 1, height: 1 };`,
      { fails: ['const bad: SelectionRect'] },
    );
  });

  it('names the overlay rectangle ImageOverlayRect only', () => {
    expectTypeErrors(
      `import type { ImageOverlayRect } from '@libraz/mejiro-react';
const rect: ImageOverlayRect = { x: 0, y: 0, width: 10, height: 10 };
import type { ImageRect } from '@libraz/mejiro-react';`,
      { fails: ["import type { ImageRect } from '@libraz/mejiro-react'"] },
    );
  });

  it('exports one image overlay hook, taking the spread in its options', () => {
    expectTypeErrors(
      `import type { ChapterLayout } from '@libraz/mejiro/book';
import { useImageOverlay, type UseImageOverlayOptions } from '@libraz/mejiro-react';
declare const layout: ChapterLayout | null;
const options: UseImageOverlayOptions = { spreadIndex: 0, onReflow: (spread) => spread.pageCount };
const overlays = useImageOverlay(layout, options);
overlays.addOverlay({ width: 10 });
overlays.clearOverlays(0);
useImageOverlay(layout, 0, () => {});
import { useMultiImageOverlay } from '@libraz/mejiro-react';`,
      {
        fails: [
          'useImageOverlay(layout, 0, () => {})',
          "import { useMultiImageOverlay } from '@libraz/mejiro-react'",
        ],
      },
    );
  });

  it('exports MejiroImagePlaceholder in place of MejiroImageOverlay', () => {
    expectTypeErrors(
      `import { MejiroImagePlaceholder, type MejiroImagePlaceholderProps } from '@libraz/mejiro-react';
const props: MejiroImagePlaceholderProps = { rect: { x: 0, y: 0, width: 1, height: 1 } };
const component = MejiroImagePlaceholder;
import { MejiroImageOverlay } from '@libraz/mejiro-react';`,
      { fails: ["import { MejiroImageOverlay } from '@libraz/mejiro-react'"] },
    );
  });

  it('names useSpread state by index and count, and selects library volumes by id', () => {
    expectTypeErrors(
      `import type { ChapterLayout } from '@libraz/mejiro/book';
import { useLibrary, useSpread, type GoToOptions, type UseSpreadReturn } from '@libraz/mejiro-react';
declare const layout: ChapterLayout;
const nav: UseSpreadReturn = useSpread(layout);
const keys: number[] = [nav.index, nav.count, nav.spreadIndex, nav.spreadCount, nav.pageCount];
const animate: GoToOptions = { animate: false };
nav.goTo(1, animate);
const library = useLibrary({ volumes: [{ id: 'a', label: 'A' }] });
library.selectVolume('a');
const picked: string | undefined = library.volume?.id;
const at: number = library.volumeIndex;
nav.spreadIdx;
nav.setSpread(1);
library.goTo('a');`,
      { fails: ['nav.spreadIdx', 'nav.setSpread(1)', "library.goTo('a')"] },
    );
  });
});

describe('primitive options use the shared vocabulary', () => {
  it('times the page turn with turnDurationMs', () => {
    expectTypeErrors(
      `import type { ChapterLayout } from '@libraz/mejiro/book';
import { useSpread } from '@libraz/mejiro-react';
declare const layout: ChapterLayout;
useSpread(layout, { turnDurationMs: 120 });
useSpread(layout, { turnDuration: 120 });`,
      { fails: ['turnDuration: 120'] },
    );
  });

  it('chooses the spread mode with a resolved spreadMode on the hook and the spread', () => {
    expectTypeErrors(
      `import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { MejiroSpread, useSpread, type ResolvedSpreadMode } from '@libraz/mejiro-react';
import { createElement } from 'react';
declare const layout: ChapterLayout;
declare const spread: SpreadResult;
const mode: ResolvedSpreadMode = 'single';
useSpread(layout, { spreadMode: mode });
createElement(MejiroSpread, { spread, layout, spreadMode: 'double', singleSide: null });
const auto: ResolvedSpreadMode = 'auto';
useSpread(layout, { single: true });
createElement(MejiroSpread, { spread, layout, singlePage: true });`,
      { fails: ["const auto: ResolvedSpreadMode = 'auto'", 'single: true', 'singlePage: true'] },
    );
  });

  it('names handlers after the state they report or the item the user selects', () => {
    expectTypeErrors(
      `import type { ChapterLayout } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import {
  MejiroChapterNav, MejiroNotationHighlighter, MejiroSettingsPanel, MejiroShelf, MejiroToc,
  useLibrary, useSpread,
} from '@libraz/mejiro-react';
import { createElement } from 'react';
declare const layout: ChapterLayout;
declare const epub: EpubBook;
const settings = { fontFamily: 'serif', fontSize: 16 };
useSpread(layout, { onIndexChange: (index: number) => index });
useLibrary({ volumes: [], onVolumeChange: (volume) => volume.id });
createElement(MejiroToc, { epub, onChapterSelect: (chapterIndex: number) => chapterIndex });
createElement(MejiroShelf, { volumes: [], onVolumeSelect: (volume) => volume.id });
createElement(MejiroChapterNav, { epub, chapterIndex: 0, onChapterIndexChange: () => {} });
createElement(MejiroSettingsPanel, { open: true, settings, onSettingsChange: () => {} });
createElement(MejiroNotationHighlighter, { value: '', onValueChange: () => {}, onChange: (e) => e.target.value });
useSpread(layout, { onChange: () => {} });
useLibrary({ volumes: [], onChange: () => {} });
createElement(MejiroToc, { epub, onSelect: (chapter: number) => chapter });
createElement(MejiroShelf, { volumes: [], onSelect: (volume: { id: string }) => volume.id });
createElement(MejiroChapterNav, { epub, chapter: 0, onChange: () => {} });
createElement(MejiroSettingsPanel, { open: true, settings, onChange: () => {} });
createElement(MejiroNotationHighlighter, { value: '', onChange: (next: string) => {} });`,
      {
        fails: [
          'useSpread(layout, { onChange',
          'useLibrary({ volumes: [], onChange',
          'createElement(MejiroToc, { epub, onSelect',
          'createElement(MejiroShelf, { volumes: [], onSelect',
          'createElement(MejiroChapterNav, { epub, chapter: 0',
          'createElement(MejiroSettingsPanel, { open: true, settings, onChange',
          "createElement(MejiroNotationHighlighter, { value: '', onChange: (next: string)",
        ],
      },
    );
  });

  it('shows the table-of-contents search with showSearch', () => {
    expectTypeErrors(
      `import type { EpubBook } from '@libraz/mejiro/epub';
import { MejiroToc } from '@libraz/mejiro-react';
import { createElement } from 'react';
declare const epub: EpubBook;
createElement(MejiroToc, { epub, showSearch: true });
createElement(MejiroToc, { epub, searchable: true });`,
      { fails: ['searchable: true'] },
    );
  });

  it('accepts read-only arrays for every list input', () => {
    expectTypeErrors(
      `import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import {
  MejiroScrollView, MejiroSelectionLayer, MejiroSettingsPanel, MejiroShelf, MejiroSpread, useImageOverlay,
  type FontChoice, type MultiImageItem, type SelectionRect, type VolumeInfo,
} from '@libraz/mejiro-react';
import { createElement } from 'react';
declare const layout: ChapterLayout;
declare const spread: SpreadResult;
declare const images: readonly MultiImageItem[];
declare const rects: readonly SelectionRect[];
declare const fonts: readonly FontChoice[];
declare const volumes: readonly VolumeInfo[];
createElement(MejiroSpread, { spread, layout, images, selectionRects: rects });
createElement(MejiroScrollView, { layout, images, selectionRects: rects });
createElement(MejiroSelectionLayer, { rects, side: 'right' });
createElement(MejiroSettingsPanel, { open: true, settings: { fontFamily: 'serif', fontSize: 16 }, onSettingsChange: () => {}, fonts });
createElement(MejiroShelf, { volumes });
const overlays = useImageOverlay(layout, { spreadIndex: 0 });
createElement(MejiroSpread, { spread, layout, images: overlays.currentImages });
overlays.currentImages.push(images[0]);`,
      { fails: ['overlays.currentImages.push'] },
    );
  });
});
