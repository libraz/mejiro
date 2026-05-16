import { createContext, type ReactNode, useContext, useMemo } from 'react';

/** All UI strings rendered by the bundled React components. */
export interface MejiroMessages {
  /** Logo subtitle. */
  readonly logoSubtitle: string;
  /** Header "Open" button label. */
  readonly openButton: string;
  /** Header "Settings" button label. */
  readonly settingsButton: string;
  /** Header "Image" overlay button label. */
  readonly imageButton: string;
  /** ARIA label for removing an image overlay. */
  readonly imageRemoveButton: string;
  /** Loading-state body text. */
  readonly loading: string;
  /** ARIA label for the previous-spread nav zone. */
  readonly prevSpread: string;
  /** ARIA label for the next-spread nav zone. */
  readonly nextSpread: string;
  /** Settings panel group title — Font. */
  readonly settingsFont: string;
  /** Settings panel font-size label. */
  readonly settingsSize: string;
  /** Settings panel "decrease font size" button. */
  readonly settingsSizeDown: string;
  /** Settings panel "increase font size" button. */
  readonly settingsSizeUp: string;
  /** Settings panel group title — Layout. */
  readonly settingsLayout: string;
  /** Settings panel kinsoku label. */
  readonly settingsKinsoku: string;
  /** Settings panel hanging-punctuation label. */
  readonly settingsHanging: string;
  /** Settings panel line-spacing label. */
  readonly settingsLineSpacing: string;
  /** Settings panel "strict" kinsoku option. */
  readonly settingsStrict: string;
  /** Settings panel "loose" kinsoku option. */
  readonly settingsLoose: string;
  /** Settings panel "on" toggle option. */
  readonly toggleOn: string;
  /** Settings panel "off" toggle option. */
  readonly toggleOff: string;
  /** Drop zone primary text. */
  readonly dropZoneTitle: string;
  /** Drop zone secondary hint. */
  readonly dropZoneHint: string;
  /** TOC heading. */
  readonly tocTitle: string;
  /** TOC search placeholder. */
  readonly tocSearchPlaceholder: string;
  /** TOC empty-results template. Placeholder `{query}` is replaced. */
  readonly tocEmpty: string;
  /** Shelf heading. */
  readonly shelfTitle: string;
  /** Generic chapter-N template. Placeholder `{n}` is replaced. */
  readonly chapterN: string;
  /** Aria-live announcement template. Placeholders: `{spread}`, `{total}`. */
  readonly spreadAnnouncement: string;
  /** Embedded EPUB editor preview subtitle. */
  readonly editorPreviewSubtitle: string;
  /** EPUB editor panel title. */
  readonly editorTitle: string;
  /** EPUB editor empty-state title. */
  readonly editorNoBookLoaded: string;
  /** EPUB editor paragraph list section label. */
  readonly editorParagraphs: string;
  /** EPUB editor proofread section label. */
  readonly editorProofread: string;
  /** EPUB editor apply-text button label. */
  readonly editorApplyText: string;
  /** EPUB editor ruby section label. */
  readonly editorRuby: string;
  /** EPUB editor ruby usage hint. */
  readonly editorRubyHint: string;
  /** EPUB editor ruby selected-range template. Placeholders: `{start}`, `{end}`, `{count}`. */
  readonly editorRubyRange: string;
  /** EPUB editor ruby input placeholder. */
  readonly editorRubyPlaceholder: string;
  /** EPUB editor apply-ruby button label. */
  readonly editorApplyRuby: string;
  /** EPUB editor image section label. */
  readonly editorImages: string;
  /** EPUB editor insert-image button label. */
  readonly editorInsertImageAfterParagraph: string;
  /** EPUB editor export button label. */
  readonly editorExportEpub: string;
  /** Manuscript editor preview subtitle. */
  readonly manuscriptPreviewSubtitle: string;
  /** Manuscript editor panel title. */
  readonly manuscriptTitle: string;
  /** Manuscript editor ruby notation hint. */
  readonly manuscriptRubyHint: string;
  /** Manuscript editor metadata section label. */
  readonly manuscriptMetadata: string;
  /** Manuscript editor chapters section label. */
  readonly manuscriptChapters: string;
  /** Manuscript editor draft section label. */
  readonly manuscriptDraft: string;
  /** Manuscript editor cover chooser label. */
  readonly manuscriptChooseCoverImage: string;
  /** Manuscript editor default book title. */
  readonly manuscriptDefaultTitle: string;
  /** Manuscript editor default chapter title template. Placeholder `{n}` is replaced. */
  readonly manuscriptDefaultChapterTitle: string;
  /** Manuscript editor default draft body. */
  readonly manuscriptDefaultBody: string;
  /** Generic untitled fallback. */
  readonly untitled: string;
  /** Manuscript editor add-chapter button label. */
  readonly manuscriptAddChapter: string;
  /** Manuscript editor remove-chapter button label. */
  readonly manuscriptRemove: string;
  /** Manuscript editor emphasis-dots button label. */
  readonly manuscriptEmphasisDots: string;
  /** Manuscript editor tate-chu-yoko button label. */
  readonly manuscriptTcy: string;
  /** Manuscript editor emphasis button label. */
  readonly manuscriptEm: string;
  /** Manuscript editor strong button label. */
  readonly manuscriptStrong: string;
}

/** Built-in English catalog (the default). */
export const enMessages: MejiroMessages = {
  logoSubtitle: 'Vertical Reader',
  openButton: 'Open',
  settingsButton: 'Settings',
  imageButton: 'Image',
  imageRemoveButton: 'Remove image',
  loading: 'Loading...',
  prevSpread: 'Previous spread',
  nextSpread: 'Next spread',
  settingsFont: 'Font',
  settingsSize: 'Size',
  settingsSizeDown: 'Decrease font size',
  settingsSizeUp: 'Increase font size',
  settingsLayout: 'Layout',
  settingsKinsoku: 'Kinsoku',
  settingsHanging: 'Hanging',
  settingsLineSpacing: 'Line spacing',
  settingsStrict: 'Strict',
  settingsLoose: 'Loose',
  toggleOn: 'On',
  toggleOff: 'Off',
  dropZoneTitle: 'Drop an EPUB here or click to open',
  dropZoneHint: '.epub files only',
  tocTitle: 'Contents',
  tocSearchPlaceholder: 'Search chapters…',
  tocEmpty: 'No chapters match "{query}".',
  shelfTitle: 'Library',
  chapterN: 'Chapter {n}',
  spreadAnnouncement: 'Spread {spread} of {total}',
  editorPreviewSubtitle: 'Editor Preview',
  editorTitle: 'EPUB Editor',
  editorNoBookLoaded: 'No book loaded',
  editorParagraphs: 'Paragraphs',
  editorProofread: 'Proofread',
  editorApplyText: 'Apply text',
  editorRuby: 'Ruby',
  editorRubyHint: 'Select base text in the textarea, then type the ruby reading below.',
  editorRubyRange: 'Base: {start}-{end} ({count} chars)',
  editorRubyPlaceholder: 'furigana',
  editorApplyRuby: 'Apply ruby',
  editorImages: 'Images',
  editorInsertImageAfterParagraph: 'Insert image after paragraph',
  editorExportEpub: 'Export EPUB',
  manuscriptPreviewSubtitle: 'Manuscript Preview',
  manuscriptTitle: 'Manuscript EPUB',
  manuscriptRubyHint: 'Use ｜漢字《かんじ》 or 漢字《かんじ》 for ruby.',
  manuscriptMetadata: 'Metadata',
  manuscriptChapters: 'Chapters',
  manuscriptDraft: 'Draft',
  manuscriptChooseCoverImage: 'Choose cover image',
  manuscriptDefaultTitle: 'New work',
  manuscriptDefaultChapterTitle: 'Chapter {n}',
  manuscriptDefaultBody: 'This is a ruby example: ｜kanji《reading》.\n\nPaste your draft here.',
  untitled: 'Untitled',
  manuscriptAddChapter: 'Add chapter',
  manuscriptRemove: 'Remove',
  manuscriptEmphasisDots: 'Emphasis dots',
  manuscriptTcy: 'Tate-chu-yoko',
  manuscriptEm: 'Em',
  manuscriptStrong: 'Strong',
};

/** Built-in Japanese catalog. */
export const jaMessages: MejiroMessages = {
  logoSubtitle: '縦書きリーダー',
  openButton: '開く',
  settingsButton: '設定',
  imageButton: '画像',
  imageRemoveButton: '画像を削除',
  loading: '読み込み中…',
  prevSpread: '前の見開き',
  nextSpread: '次の見開き',
  settingsFont: 'フォント',
  settingsSize: 'サイズ',
  settingsSizeDown: 'フォントサイズを下げる',
  settingsSizeUp: 'フォントサイズを上げる',
  settingsLayout: 'レイアウト',
  settingsKinsoku: '禁則',
  settingsHanging: 'ぶら下げ',
  settingsLineSpacing: '行間',
  settingsStrict: '厳格',
  settingsLoose: '緩和',
  toggleOn: 'オン',
  toggleOff: 'オフ',
  dropZoneTitle: 'EPUB をドロップまたはクリックで開く',
  dropZoneHint: '.epub ファイルのみ',
  tocTitle: '目次',
  tocSearchPlaceholder: '章を検索…',
  tocEmpty: '「{query}」に一致する章はありません。',
  shelfTitle: '本棚',
  chapterN: '第{n}章',
  spreadAnnouncement: '{total}見開き中{spread}見開き目',
  editorPreviewSubtitle: '編集プレビュー',
  editorTitle: 'EPUB エディター',
  editorNoBookLoaded: '本が読み込まれていません',
  editorParagraphs: '段落',
  editorProofread: '校正',
  editorApplyText: '本文を適用',
  editorRuby: 'ルビ',
  editorRubyHint: 'テキストエリアで親文字を選択してから、下にルビを入力します。',
  editorRubyRange: '親文字: {start}-{end}（{count}文字）',
  editorRubyPlaceholder: 'ふりがな',
  editorApplyRuby: 'ルビを適用',
  editorImages: '画像',
  editorInsertImageAfterParagraph: '段落の後に画像を挿入',
  editorExportEpub: 'EPUB を書き出す',
  manuscriptPreviewSubtitle: '原稿プレビュー',
  manuscriptTitle: '原稿 EPUB',
  manuscriptRubyHint: 'ルビには ｜漢字《かんじ》 または 漢字《かんじ》 を使います。',
  manuscriptMetadata: 'メタデータ',
  manuscriptChapters: '章',
  manuscriptDraft: '原稿',
  manuscriptChooseCoverImage: '表紙画像を選択',
  manuscriptDefaultTitle: '新しい作品',
  manuscriptDefaultChapterTitle: '第{n}話',
  manuscriptDefaultBody: 'これは｜漢字《かんじ》のルビ例です。\n\n本文をここに貼り付けます。',
  untitled: '無題',
  manuscriptAddChapter: '章を追加',
  manuscriptRemove: '削除',
  manuscriptEmphasisDots: '傍点',
  manuscriptTcy: '縦中横',
  manuscriptEm: '強調',
  manuscriptStrong: '太字',
};

/** Built-in locale identifiers. */
export type MejiroLocale = 'en' | 'ja';

const CATALOGS: Record<MejiroLocale, MejiroMessages> = {
  en: enMessages,
  ja: jaMessages,
};

const I18nContext = createContext<MejiroMessages>(enMessages);

/** Provider that scopes a message catalog to its descendants. */
export function MejiroI18nProvider({
  locale,
  messages,
  children,
}: {
  locale?: MejiroLocale;
  messages?: Partial<MejiroMessages>;
  children: ReactNode;
}): ReactNode {
  const fromContext = useContext(I18nContext);
  const value = useMemo(() => {
    const base = locale != null ? CATALOGS[locale] : fromContext;
    return messages ? { ...base, ...messages } : base;
  }, [locale, messages, fromContext]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Options for {@link useI18n}. */
export interface UseI18nOptions {
  /** Built-in locale to use as the base catalog. @defaultValue 'en' */
  locale?: MejiroLocale;
  /** Overrides merged on top of the built-in catalog. */
  messages?: Partial<MejiroMessages>;
}

/**
 * Returns the resolved `MejiroMessages` catalog. With no arguments the
 * catalog provided by the nearest {@link MejiroI18nProvider} is returned;
 * passing `locale` / `messages` resolves a catalog without context.
 */
export function useI18n(options: UseI18nOptions = {}): MejiroMessages {
  const fromContext = useContext(I18nContext);
  const { locale, messages } = options;
  return useMemo(() => {
    if (locale == null && messages == null) return fromContext;
    const base = locale != null ? CATALOGS[locale] : fromContext;
    return messages ? { ...base, ...messages } : base;
  }, [locale, messages, fromContext]);
}

/** Build a catalog without invoking React (useful in plain modules). */
export function resolveMessages(
  locale: MejiroLocale | undefined,
  overrides: Partial<MejiroMessages> | undefined,
): MejiroMessages {
  const base = locale != null ? CATALOGS[locale] : enMessages;
  return overrides ? { ...base, ...overrides } : base;
}

/** Replace `{name}` placeholders in a template. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    Object.hasOwn(vars, k) ? String(vars[k as keyof typeof vars]) : `{${k}}`,
  );
}
