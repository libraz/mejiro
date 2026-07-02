/** All UI strings rendered by the bundled framework components. */
export interface MejiroMessages {
  readonly logoSubtitle: string;
  readonly openButton: string;
  readonly settingsButton: string;
  readonly imageButton: string;
  readonly imageRemoveButton: string;
  readonly loading: string;
  readonly prevSpread: string;
  readonly nextSpread: string;
  readonly settingsFont: string;
  readonly settingsSize: string;
  readonly settingsSizeDown: string;
  readonly settingsSizeUp: string;
  readonly settingsLayout: string;
  readonly settingsKinsoku: string;
  readonly settingsHanging: string;
  readonly settingsLineSpacing: string;
  readonly settingsStrict: string;
  readonly settingsLoose: string;
  readonly toggleOn: string;
  readonly toggleOff: string;
  readonly dropZoneTitle: string;
  readonly dropZoneHint: string;
  readonly tocTitle: string;
  readonly tocSearchPlaceholder: string;
  readonly tocEmpty: string;
  readonly shelfTitle: string;
  readonly chapterN: string;
  readonly spreadAnnouncement: string;
  readonly editorPreviewSubtitle: string;
  readonly editorTitle: string;
  readonly editorNoBookLoaded: string;
  readonly editorParagraphs: string;
  readonly editorProofread: string;
  readonly editorApplyText: string;
  readonly editorRuby: string;
  readonly editorRubyHint: string;
  readonly editorRubyRange: string;
  readonly editorRubyPlaceholder: string;
  readonly editorApplyRuby: string;
  readonly editorImages: string;
  readonly editorInsertImageAfterParagraph: string;
  readonly editorExportEpub: string;
  readonly manuscriptPreviewSubtitle: string;
  readonly manuscriptTitle: string;
  readonly manuscriptRubyHint: string;
  readonly manuscriptMetadata: string;
  readonly manuscriptChapters: string;
  readonly manuscriptDraft: string;
  readonly manuscriptChooseCoverImage: string;
  readonly manuscriptDefaultTitle: string;
  readonly manuscriptDefaultChapterTitle: string;
  readonly manuscriptDefaultBody: string;
  readonly untitled: string;
  readonly manuscriptAddChapter: string;
  readonly manuscriptRemove: string;
  readonly manuscriptEmphasisDots: string;
  readonly manuscriptTcy: string;
  readonly manuscriptEm: string;
  readonly manuscriptStrong: string;
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

export const messageCatalogs: Record<MejiroLocale, MejiroMessages> = {
  en: enMessages,
  ja: jaMessages,
};

/** Build a catalog without invoking a framework runtime. */
export function resolveMessages(
  locale: MejiroLocale | undefined,
  overrides: Partial<MejiroMessages> | undefined,
  fallback: MejiroMessages = enMessages,
): MejiroMessages {
  const base = locale != null ? messageCatalogs[locale] : fallback;
  return overrides ? { ...base, ...overrides } : base;
}

/** Replace `{name}` placeholders in a template. */
export function formatMessage(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    Object.hasOwn(vars, key) ? String(vars[key as keyof typeof vars]) : `{${key}}`,
  );
}
