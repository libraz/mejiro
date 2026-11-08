function loadMejiroStyles(): void {
  if (typeof document === 'undefined') return;
  void import('@libraz/mejiro/render/mejiro.css');
  void import('@libraz/mejiro/render/mejiro-reader.css');
  void import('@libraz/mejiro/render/mejiro-editor.css');
}

loadMejiroStyles();

export type {
  ManuscriptChapter,
  MejiroErrorCode,
  MejiroStorage,
  MejiroWarning,
  MejiroWarningCode,
  ReadingAnchor,
} from '@libraz/mejiro';
export { MejiroError } from '@libraz/mejiro';
export type {
  MejiroI18nProviderProps,
  MejiroLocale,
  MejiroMessages,
  UseI18nOptions,
} from './i18n.js';
export {
  enMessages,
  formatMessage,
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
export { type ExportPolicy, MejiroEditor, type MejiroEditorProps } from './MejiroEditor.js';
export {
  MejiroImagePlaceholder,
  type MejiroImagePlaceholderProps,
} from './MejiroImagePlaceholder.js';
export {
  type ManuscriptAutosaveDraft,
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
  type MejiroReaderChapterFinishedEvent,
  type MejiroReaderCommonProps,
  type MejiroReaderEventMap,
  type MejiroReaderFit,
  type MejiroReaderHandle,
  type MejiroReaderManuscriptProps,
  type MejiroReaderMode,
  type MejiroReaderParsedProps,
  type MejiroReaderPickerProps,
  type MejiroReaderProps,
  type MejiroReaderSettingsSlot,
  type MejiroReaderSpreadIndexChangeEvent,
  type MejiroReaderTurnEndEvent,
  type MejiroReaderTurnStartEvent,
  type MejiroReaderUrlProps,
  type MejiroSpreadMode,
  type MejiroTheme,
  type MejiroThemeName,
  type PageNumberDisplay,
  type ReadingAnchorRange,
  type SpreadPosition,
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
export {
  MejiroSpread,
  type MejiroSpreadProps,
  type PageHeaderData,
  type ReaderAnnotation,
  type SelectionRect,
} from './MejiroSpread.js';
export { MejiroStats, type MejiroStatsProps } from './MejiroStats.js';
export { MejiroToc, type MejiroTocProps } from './MejiroToc.js';
export type {
  Annotation,
  UseAnnotationsOptions,
  UseAnnotationsReturn,
} from './useAnnotations.js';
export { useAnnotations } from './useAnnotations.js';
export type {
  ChapterLayoutRecomputeOptions,
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
export type { FetchEpubOptions, UseEpubOptions, UseEpubReturn } from './useEpub.js';
export { useEpub } from './useEpub.js';
export type { UseEpubProjectOptions, UseEpubProjectReturn } from './useEpubProject.js';
export { useEpubProject } from './useEpubProject.js';
export type {
  ImageOverlayRect,
  MultiImageItem,
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
  UseManuscriptLayoutOptions,
  UseManuscriptLayoutReturn,
} from './useManuscriptLayout.js';
export { useManuscriptLayout } from './useManuscriptLayout.js';
export type { UseMejiroBookOptions, UseMejiroBookReturn } from './useMejiroBook.js';
export { useMejiroBook } from './useMejiroBook.js';
export type {
  UseReadingPositionOptions,
  UseReadingPositionReturn,
} from './useReadingPosition.js';
export { useReadingPosition } from './useReadingPosition.js';
export type {
  GoToOptions,
  ResolvedSpreadMode,
  UseSpreadOptions,
  UseSpreadReturn,
} from './useSpread.js';
export { useSpread } from './useSpread.js';
