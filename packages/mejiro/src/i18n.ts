/**
 * All UI strings rendered by the bundled framework components.
 *
 * Every key is required, so a host supplying a whole catalog cannot silently
 * leave part of the UI untranslated; supply a partial catalog through the
 * `overrides` argument of {@link resolveMessages} instead.
 *
 * Keys whose doc comment names `{placeholder}` tokens are templates expanded by
 * {@link formatMessage} at render time. A translation must keep every token
 * spelled exactly as documented — an unknown or misspelled token is left in the
 * output verbatim (braces included) rather than throwing, so a typo surfaces as
 * literal `{n}` text in the UI.
 */
export interface MejiroMessages {
  /** Subtitle shown next to the reader wordmark, unless the host passes its own `subtitle`. */
  readonly logoSubtitle: string;
  /** Label of the reader toolbar button that opens the EPUB file picker. */
  readonly openButton: string;
  /** Label of the reader toolbar button that toggles the settings panel. */
  readonly settingsButton: string;
  /** Label of the reader toolbar button that inserts an image, and the default caption inside the image overlay. */
  readonly imageButton: string;
  /** Accessible name and tooltip of the image overlay's remove control. */
  readonly imageRemoveButton: string;
  /** Placeholder shown while an EPUB is being parsed and laid out. */
  readonly loading: string;
  /** Accessible name of the control that turns back one spread. */
  readonly prevSpread: string;
  /** Accessible name of the control that turns forward one spread. */
  readonly nextSpread: string;
  /** Heading of the font group in the settings panel. */
  readonly settingsFont: string;
  /** Label of the font-size control in the settings panel. */
  readonly settingsSize: string;
  /** Accessible name of the button that decreases the font size. */
  readonly settingsSizeDown: string;
  /** Accessible name of the button that increases the font size. */
  readonly settingsSizeUp: string;
  /** Heading of the layout group in the settings panel. */
  readonly settingsLayout: string;
  /** Label of the kinsoku-mode selector. Its options are {@link settingsStrict} and {@link settingsLoose}. */
  readonly settingsKinsoku: string;
  /** Label of the hanging-punctuation selector. Its options are {@link toggleOn} and {@link toggleOff}. */
  readonly settingsHanging: string;
  /** Label of the line-spacing control in the settings panel. */
  readonly settingsLineSpacing: string;
  /** Option label for strict kinsoku mode. */
  readonly settingsStrict: string;
  /** Option label for loose kinsoku mode. */
  readonly settingsLoose: string;
  /** Option label for an enabled boolean setting. */
  readonly toggleOn: string;
  /** Option label for a disabled boolean setting. */
  readonly toggleOff: string;
  /** Primary prompt of the EPUB drop zone. */
  readonly dropZoneTitle: string;
  /** Secondary line of the drop zone stating which files are accepted. */
  readonly dropZoneHint: string;
  /** Heading of the table of contents, and the accessible name of the chapter navigation region. */
  readonly tocTitle: string;
  /** Placeholder of the chapter search field in the table of contents. */
  readonly tocSearchPlaceholder: string;
  /** Empty-state text when a chapter search matches nothing. Template: `{query}` — the current search text. */
  readonly tocEmpty: string;
  /** Accessible name of the bookshelf region. */
  readonly shelfTitle: string;
  /** Fallback chapter title when the EPUB gives none. Template: `{n}` — the 1-based chapter number. */
  readonly chapterN: string;
  /**
   * Live-region text announcing the current position to screen readers.
   * Template: `{spread}` — the 1-based spread number, `{total}` — the spread count.
   */
  readonly spreadAnnouncement: string;
  /** Subtitle of the preview pane inside the EPUB editor. */
  readonly editorPreviewSubtitle: string;
  /** Heading of the EPUB editor. */
  readonly editorTitle: string;
  /** Text shown in place of the book title before an EPUB has been loaded. */
  readonly editorNoBookLoaded: string;
  /** Heading of the editor's paragraph list. */
  readonly editorParagraphs: string;
  /** Heading of the editor's proofreading section. */
  readonly editorProofread: string;
  /** Label of the button that commits edited paragraph text to the book. */
  readonly editorApplyText: string;
  /** Heading of the editor's ruby section. */
  readonly editorRuby: string;
  /** Instructions explaining how to select base text before entering a reading. */
  readonly editorRubyHint: string;
  /**
   * Readout of the current ruby base selection.
   * Template: `{start}` / `{end}` — the selection bounds, `{count}` — the number of selected characters.
   */
  readonly editorRubyRange: string;
  /** Placeholder of the input that receives the ruby reading. */
  readonly editorRubyPlaceholder: string;
  /** Label of the button that applies the entered ruby to the selected base text. */
  readonly editorApplyRuby: string;
  /** Heading of the editor's image section. */
  readonly editorImages: string;
  /** Label of the control that inserts an image after the selected paragraph. */
  readonly editorInsertImageAfterParagraph: string;
  /** Label of the button that exports the edited book, shared by the EPUB and manuscript editors. */
  readonly editorExportEpub: string;
  /** Subtitle of the preview pane inside the manuscript editor. */
  readonly manuscriptPreviewSubtitle: string;
  /** Heading of the manuscript editor. */
  readonly manuscriptTitle: string;
  /** Instructions describing the manuscript ruby notation. Translations should keep the notation samples verbatim. */
  readonly manuscriptRubyHint: string;
  /** Heading of the manuscript metadata section. */
  readonly manuscriptMetadata: string;
  /** Heading of the manuscript chapter list. */
  readonly manuscriptChapters: string;
  /** Label of the manuscript body textarea. */
  readonly manuscriptDraft: string;
  /** Label of the cover picker, shown until a cover file has been chosen. */
  readonly manuscriptChooseCoverImage: string;
  /** Initial book title of a manuscript the host did not pre-populate. */
  readonly manuscriptDefaultTitle: string;
  /**
   * Title given to a newly added manuscript chapter.
   * Template: `{n}` — the 1-based position of the chapter.
   */
  readonly manuscriptDefaultChapterTitle: string;
  /** Body text of the starter chapter. Doubles as notation documentation, so translations should keep a ruby sample. */
  readonly manuscriptDefaultBody: string;
  /** Stand-in for a chapter whose title the author left blank. */
  readonly untitled: string;
  /** Label of the button that appends a manuscript chapter. */
  readonly manuscriptAddChapter: string;
  /** Label of the button that deletes the selected manuscript chapter. */
  readonly manuscriptRemove: string;
  /** Label of the control that wraps the selection in emphasis dots. */
  readonly manuscriptEmphasisDots: string;
  /** Label of the control that wraps the selection in tate-chu-yoko. */
  readonly manuscriptTcy: string;
  /** Label of the control that wraps the selection in emphasis (`em`). */
  readonly manuscriptEm: string;
  /** Label of the control that wraps the selection in strong emphasis (`strong`). */
  readonly manuscriptStrong: string;
  /**
   * Accessible name of a chapter's drag handle in the reorder list.
   * Template: `{title}` — the chapter title, or {@link untitled} when blank.
   */
  readonly manuscriptReorderHandle: string;
}

/** Built-in locale identifiers. */
export type MejiroLocale = 'en' | 'ja';

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
  manuscriptReorderHandle: 'Reorder {title}',
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
  manuscriptReorderHandle: '{title} の順番を変更',
};

/**
 * The built-in catalogs keyed by {@link MejiroLocale}.
 *
 * Exhaustive over `MejiroLocale`, so indexing it with any valid locale always
 * yields a catalog — {@link resolveMessages} relies on that to skip a fallback
 * check. The catalogs are shared, not copied: treat the returned object as
 * read-only, since mutating it changes what every reader on the page renders.
 */
export const messageCatalogs: Record<MejiroLocale, MejiroMessages> = {
  en: enMessages,
  ja: jaMessages,
};

/**
 * Builds a catalog without invoking a framework runtime.
 *
 * @param locale - Built-in locale to start from. When omitted, `fallback` is
 *   used instead, which is how a host keeps a previously resolved catalog while
 *   still applying overrides.
 * @param overrides - Partial catalog merged over the base. Absent keys keep the
 *   base string, so a host only needs to list what it wants to change.
 * @param fallback - Base used when `locale` is omitted. @defaultValue {@link enMessages}
 * @returns The merged catalog. When `overrides` is absent the base object is
 *   returned as-is rather than copied, so callers must not mutate the result.
 */
export function resolveMessages(
  locale: MejiroLocale | undefined,
  overrides: Partial<MejiroMessages> | undefined,
  fallback: MejiroMessages = enMessages,
): MejiroMessages {
  const base = locale != null ? messageCatalogs[locale] : fallback;
  return overrides ? { ...base, ...overrides } : base;
}

/**
 * Replaces `{name}` placeholders in a template.
 *
 * Placeholder names match `\w+`. A placeholder with no matching entry in `vars`
 * is left in the output verbatim, braces included, rather than becoming an empty
 * string or throwing — a mistranslated token stays visible instead of silently
 * dropping information. Numbers are stringified with the default locale-less
 * conversion, so a caller wanting grouped digits must pass a formatted string.
 * Substitution is single-pass: braces introduced by a substituted value are not
 * expanded again.
 *
 * @param template - Message string, typically a {@link MejiroMessages} entry.
 * @param vars - Values keyed by placeholder name.
 * @returns The expanded string.
 */
export function formatMessage(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    Object.hasOwn(vars, key) ? String(vars[key as keyof typeof vars]) : `{${key}}`,
  );
}
