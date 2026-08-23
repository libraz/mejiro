export type { EditableEpubSelection } from './clone.js';
export { clampEditableEpubSelection, cloneEditableEpubBook } from './clone.js';
export type {
  AddImageInput,
  AddImageInputBytes,
  AddImageInputCommon,
  AddImageInputUrl,
  AssetResolver,
  AssetResolverAsset,
  AssetResolverRequest,
  EpubExportOptions,
} from './editor.js';
export {
  addEpubChapterImage,
  EditableEpub,
  exportEditableEpub,
  parseEditableEpub,
  setEpubInlineAnnotations,
  updateEpubParagraph,
} from './editor.js';
export type { EpubParseLimits, EpubParseOptions } from './limits.js';
export { DEFAULT_EPUB_PARSE_LIMITS } from './limits.js';
export type {
  ManuscriptSourceChapter,
  ManuscriptToEpubBookOptions,
} from './manuscript-source.js';
export { manuscriptToEpubBook } from './manuscript-source.js';
export { parseEpub } from './parser.js';
export type {
  EpubCollection,
  EpubContributor,
  EpubProjectAsset,
  EpubProjectMetadata,
  EpubProjectOptions,
  ManuscriptChapterInput,
  ManuscriptDialect,
  ParseManuscriptOptions,
  ProjectChapter,
} from './project.js';
export { EpubProject, parseManuscript, parseManuscriptRuby } from './project.js';
export { extractRubyContent } from './ruby-extractor.js';
export type {
  AnnotatedParagraph,
  EditableBlock,
  EditableEpubBook,
  EditableEpubChapter,
  EditableEpubImage,
  EditableImageAsset,
  EditableImageBlock,
  EditableParagraphBlock,
  EpubBook,
  EpubChapter,
  ParagraphKind,
} from './types.js';
