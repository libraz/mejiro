function loadMejiroStyles(): void {
  if (typeof document === 'undefined') return;
  void import('@libraz/mejiro/render/mejiro.css');
  void import('@libraz/mejiro/render/mejiro-reader.css');
  void import('@libraz/mejiro/render/mejiro-editor.css');
}

loadMejiroStyles();

export type { MejiroLocale, MejiroMessages, UseI18nOptions } from './i18n.js';
export {
  enMessages,
  format,
  jaMessages,
  MejiroI18nProvider,
  resolveMessages,
  useI18n,
} from './i18n.js';

export {
  MejiroChapterNav,
  type MejiroChapterNavProps,
  type MejiroChapterNavVariant,
} from './MejiroChapterNav.js';
export { MejiroDropZone, type MejiroDropZoneProps } from './MejiroDropZone.js';
export {
  MejiroEditor,
  type MejiroEditorProps,
  type MejiroExportPolicy,
} from './MejiroEditor.js';
export { MejiroImageOverlay, type MejiroImageOverlayProps } from './MejiroImageOverlay.js';
export {
  type ManuscriptEditorChapter,
  type ManuscriptPreviewProps,
  MejiroManuscriptEditor,
  type MejiroManuscriptEditorProps,
} from './MejiroManuscriptEditor.js';
export {
  MejiroNotationHighlighter,
  type MejiroNotationHighlighterProps,
} from './MejiroNotationHighlighter.js';
export { MejiroPage, type MejiroPageProps } from './MejiroPage.js';
export { MejiroPageIndicator, type MejiroPageIndicatorProps } from './MejiroPageIndicator.js';
export { MejiroPageView, type MejiroPageViewProps } from './MejiroPageView.js';
export {
  type MejiroChapterNavMode,
  MejiroReader,
  type MejiroReaderEventMap,
  type MejiroReaderFit,
  type MejiroReaderHandle,
  type MejiroReaderMode,
  type MejiroReaderProps,
  type MejiroReaderSettingsSlot,
  type MejiroSpreadMode,
  type MejiroTheme,
  type MejiroThemeName,
  type PageNumberDisplay,
  type ReadingPosition,
} from './MejiroReader.js';
export { MejiroScrollView, type MejiroScrollViewProps } from './MejiroScrollView.js';
export {
  MejiroSelectionLayer,
  type MejiroSelectionLayerProps,
} from './MejiroSelectionLayer.js';
export type {
  EditableSettings,
  FontChoice,
  MejiroSettingsPanelProps,
} from './MejiroSettingsPanel.js';
export { MejiroSettingsPanel } from './MejiroSettingsPanel.js';
export { MejiroShelf, type MejiroShelfProps } from './MejiroShelf.js';
export { MejiroSpread, type MejiroSpreadProps, type PageHeaderData } from './MejiroSpread.js';
export { MejiroStats, type MejiroStatsProps } from './MejiroStats.js';
export { MejiroToc, type MejiroTocProps } from './MejiroToc.js';
export type {
  Annotation,
  AnnotationsStorage,
  UseAnnotationsOptions,
  UseAnnotationsReturn,
} from './useAnnotations.js';
export { useAnnotations } from './useAnnotations.js';
export type {
  PageDimensions,
  UseChapterLayoutOptions,
  UseChapterLayoutReturn,
} from './useChapterLayout.js';
export { useChapterLayout } from './useChapterLayout.js';
export type {
  EditableEpubSelection,
  UseEditableEpubOptions,
  UseEditableEpubReturn,
} from './useEditableEpub.js';
export { useEditableEpub } from './useEditableEpub.js';
export type { UseEpubOptions, UseEpubReturn } from './useEpub.js';
export { useEpub } from './useEpub.js';
export type {
  EpubProjectChapterDraft,
  UseEpubProjectOptions,
  UseEpubProjectReturn,
} from './useEpubProject.js';
export { useEpubProject } from './useEpubProject.js';
export type {
  ImageRect,
  UseImageOverlayOptions,
  UseImageOverlayReturn,
} from './useImageOverlay.js';
export { useImageOverlay } from './useImageOverlay.js';
export type {
  UseLibraryOptions,
  UseLibraryReturn,
  VolumeInfo,
} from './useLibrary.js';
export { useLibrary } from './useLibrary.js';
export type {
  UseManuscriptDraftOptions,
  UseManuscriptDraftReturn,
} from './useManuscriptDraft.js';
export { useManuscriptDraft } from './useManuscriptDraft.js';
export type {
  ManuscriptPageDimensions,
  UseManuscriptLayoutOptions,
  UseManuscriptLayoutReturn,
} from './useManuscriptLayout.js';
export { useManuscriptLayout } from './useManuscriptLayout.js';
export type { UseMejiroBookReturn } from './useMejiroBook.js';
export { useMejiroBook } from './useMejiroBook.js';
export type {
  MultiImageItem,
  UseMultiImageOverlayOptions,
  UseMultiImageOverlayReturn,
} from './useMultiImageOverlay.js';
export { useMultiImageOverlay } from './useMultiImageOverlay.js';
export type {
  ReadingPositionStorage,
  ReadingPositionValue,
  UseReadingPositionOptions,
  UseReadingPositionReturn,
} from './useReadingPosition.js';
export { useReadingPosition } from './useReadingPosition.js';
export type { UseSpreadOptions, UseSpreadReturn } from './useSpread.js';
export { useSpread } from './useSpread.js';
