import { formatDialogueLineBreaks } from '@libraz/mejiro';
import { DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import type { InlineAnnotation } from '@libraz/mejiro/browser';
import {
  type EpubProjectChapterDraft,
  type MejiroChapterNavMode,
  type MejiroLocale,
  MejiroNotationHighlighter,
  MejiroReader,
  type MejiroReaderMode,
  type MejiroSpreadMode,
  type MejiroThemeName,
  useEditableEpub,
  useEpubProject,
  useManuscriptDraft,
} from '@libraz/mejiro-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const FONTS = [
  { value: "'Shippori Mincho', serif", label: 'Shippori Mincho' },
  { value: "'Noto Serif JP', serif", label: 'Noto Serif JP' },
  { value: "'Zen Kaku Gothic New', sans-serif", label: 'Zen Kaku Gothic New' },
  { value: 'serif', label: 'System Serif' },
];

const OPTIONS = {
  fontFamily: FONTS[0].value,
  fontSize: 16,
  lineSpacing: 1.9,
  headingStyles: DEFAULT_HEADING_STYLES,
};

type DemoMode = 'viewer' | 'create' | 'edit' | 'custom';

type ReaderChromeOptions = {
  enableHeader: boolean;
  enableDropZone: boolean;
  enableChapterNav: boolean;
  enableSettings: boolean;
  enableImageOverlay: boolean;
  enableStats: boolean;
  enableKeyboard: boolean;
  enablePageIndicator: boolean;
};

const DEFAULT_CHROME_OPTIONS: ReaderChromeOptions = {
  enableHeader: true,
  enableDropZone: true,
  enableChapterNav: true,
  enableSettings: true,
  enableImageOverlay: true,
  enableStats: true,
  enableKeyboard: true,
  enablePageIndicator: true,
};

const HEADER_DEPENDENT_OPTIONS: (keyof ReaderChromeOptions)[] = [
  'enableSettings',
  'enableImageOverlay',
  'enableStats',
];

const CHAPTER_NAV_MODES: MejiroChapterNavMode[] = ['select', 'panel', 'both', 'none'];
const READER_MODES: MejiroReaderMode[] = ['paginated', 'scroll'];
const SPREAD_MODES: MejiroSpreadMode[] = ['double', 'single', 'auto'];
const THEMES: MejiroThemeName[] = ['light', 'dark', 'sepia', 'high-contrast', 'auto'];
const LOCALES: MejiroLocale[] = ['en', 'ja'];

const DEFAULT_DRAFT = `これは｜漢字《かんじ》のルビ例です。

小説投稿サイトから貼り付けた原稿を章に分け、EPUBとして整理します。`;

function defaultChapter(index = 0): EpubProjectChapterDraft {
  return {
    id: `chapter-${Date.now()}-${index}`,
    title: index === 0 ? '第一話' : `第${index + 1}話`,
    body: index === 0 ? DEFAULT_DRAFT : '',
  };
}

function downloadEpub(buffer: ArrayBuffer, title: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/epub+zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title || 'book'}.epub`;
  a.click();
  URL.revokeObjectURL(url);
}

function codePointIndexAtOffset(text: string, offset: number): number {
  return [...text.slice(0, offset)].length;
}

export default function App() {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<DemoMode>('viewer');
  const [chrome, setChrome] = useState(DEFAULT_CHROME_OPTIONS);
  const [chapterNavMode, setChapterNavMode] = useState<MejiroChapterNavMode>('panel');
  const [readerMode, setReaderMode] = useState<MejiroReaderMode>('paginated');
  const [spreadMode, setSpreadMode] = useState<MejiroSpreadMode>('double');
  const [theme, setTheme] = useState<MejiroThemeName>('light');
  const [locale, setLocale] = useState<MejiroLocale>('en');
  const [editText, setEditText] = useState('');
  const [rubyStart, setRubyStart] = useState(0);
  const [rubyEnd, setRubyEnd] = useState(0);
  const [rubyText, setRubyText] = useState('');
  const [paragraphFilter, setParagraphFilter] = useState('');

  const project = useEpubProject({
    metadata: { title: '新しい作品', author: '作者名' },
    chapters: [defaultChapter()],
  });
  const editable = useEditableEpub({ defaultUrl: '/neko.epub' });
  const customDraft = useManuscriptDraft({
    initialChapters: [
      {
        id: 'custom-1',
        title: '第一話',
        body:
          '｜縦書き《たてがき》は、漢字とかな、そして《《圏点》》までを一行に同居させたい体裁です。\n\n' +
          '〔20〕世紀の小説投稿サイトでは、原稿はテキストで貼り、組版は読み手側に委ねるのが普通でした。\n\n' +
          'いまや *em* も **strong** も [リンク](https://example.com) も、原稿の段階で見えるべきです。',
      },
      { id: 'custom-2', title: '第二話', body: '次の章の本文をここに書きます。' },
    ],
  });

  const setChromeOption = (key: keyof ReaderChromeOptions, value: boolean) => {
    setChrome((current) => ({ ...current, [key]: value }));
  };
  const optionDisabled = (key: keyof ReaderChromeOptions) =>
    HEADER_DEPENDENT_OPTIONS.includes(key) && !chrome.enableHeader;
  const effectiveOption = (key: keyof ReaderChromeOptions) =>
    optionDisabled(key) ? false : chrome[key];
  const modeDisabled = (modeValue: MejiroChapterNavMode) =>
    !chrome.enableChapterNav ||
    (!chrome.enableHeader && (modeValue === 'select' || modeValue === 'both'));
  const effectiveChapterNavMode: MejiroChapterNavMode = !chrome.enableChapterNav
    ? 'none'
    : !chrome.enableHeader && chapterNavMode === 'select'
      ? 'none'
      : !chrome.enableHeader && chapterNavMode === 'both'
        ? 'panel'
        : chapterNavMode;

  const editBook = editable.book;
  const editChapter = editBook?.chapters[editable.selection.chapter] ?? null;
  const editParagraph = editable.selectedParagraph;
  const selectedEditChapter = editable.selection.chapter;
  const filteredParagraphs = useMemo(() => {
    const query = paragraphFilter.trim();
    if (!editChapter) return [];
    return editChapter.paragraphs
      .map((paragraph, paragraphIndex) => ({ paragraph, paragraphIndex }))
      .filter(({ paragraph }) => !query || paragraph.text.includes(query));
  }, [editChapter, paragraphFilter]);

  useEffect(() => {
    setEditText(editParagraph?.text ?? '');
    setRubyStart(0);
    setRubyEnd(0);
    setRubyText('');
  }, [editParagraph]);

  function updateEditText(nextText: string): void {
    setEditText(nextText);
    editable.updateParagraph(nextText);
  }

  function adjustDialogueLineBreaks(): void {
    updateEditText(formatDialogueLineBreaks(editText));
  }

  function syncRubySelection(el: HTMLTextAreaElement): void {
    const start = codePointIndexAtOffset(el.value, el.selectionStart);
    const end = codePointIndexAtOffset(el.value, el.selectionEnd);
    setRubyStart(Math.min(start, end));
    setRubyEnd(Math.max(start, end));
  }

  function applyRuby(): void {
    if (!(editParagraph && rubyText.trim())) return;
    const len = [...editText].length;
    const start = Math.max(0, Math.min(rubyStart, len));
    const end = Math.max(start, Math.min(rubyEnd, len));
    if (end <= start) return;
    const newRuby: InlineAnnotation = {
      kind: 'ruby',
      startIndex: start,
      endIndex: end,
      rubyText: rubyText.trim(),
      type: end - start === 1 ? 'mono' : 'group',
    };
    const nextInline: InlineAnnotation[] = [
      ...editParagraph.inlineAnnotations.filter(
        (ann) => ann.endIndex <= start || ann.startIndex >= end,
      ),
      newRuby,
    ].sort((a, b) => a.startIndex - b.startIndex);
    editable.updateParagraph(editText, nextInline);
    setRubyText('');
  }

  async function addImage(file: File): Promise<void> {
    if (!editChapter) return;
    editable.addImage({
      filename: file.name,
      mediaType: file.type || 'application/octet-stream',
      data: await file.arrayBuffer(),
      alt: file.name,
      afterBlockId: paragraphBlockId(editChapter, editable.selection.paragraph),
    });
  }

  const previewBook =
    mode === 'create' ? project.previewBook : mode === 'edit' ? editable.previewBook : null;
  const previewChapter =
    mode === 'create'
      ? Math.min(project.selectedChapter, Math.max(0, (previewBook?.chapters.length ?? 1) - 1))
      : mode === 'edit'
        ? selectedEditChapter
        : undefined;
  const setPreviewChapter = (nextChapter: number): void => {
    if (mode === 'create') {
      project.setSelectedChapter(nextChapter);
      return;
    }
    if (mode === 'edit') {
      editable.setSelection({ chapter: nextChapter, paragraph: 0 });
    }
  };

  return (
    <div className="demo-shell">
      <main className="demo-preview">
        {mode === 'custom' ? (
          <MejiroReader
            key="custom"
            options={OPTIONS}
            fonts={FONTS}
            subtitle="Custom Editor Preview"
            chapterNavMode="panel"
            manuscript={customDraft.chapters.map((chapter) => ({
              id: chapter.id,
              title: chapter.title,
              body: chapter.body,
            }))}
            chapter={customDraft.selected}
            onChapterChange={customDraft.setSelected}
            enableImageOverlay={false}
          />
        ) : mode === 'viewer' ? (
          <MejiroReader
            key="viewer"
            options={OPTIONS}
            fonts={FONTS}
            epubUrl="/neko.epub"
            subtitle="React Viewer"
            mode={readerMode}
            spreadMode={spreadMode}
            theme={theme}
            locale={locale}
            fallback={<div className="demo-empty">Preparing vertical layout...</div>}
            enableHeader={chrome.enableHeader}
            enableDropZone={chrome.enableDropZone}
            enableChapterNav={chrome.enableChapterNav}
            chapterNavMode={effectiveChapterNavMode}
            enableSettings={effectiveOption('enableSettings')}
            enableImageOverlay={effectiveOption('enableImageOverlay')}
            enableStats={effectiveOption('enableStats')}
            enableKeyboard={chrome.enableKeyboard}
            enablePageIndicator={chrome.enablePageIndicator}
          />
        ) : previewBook ? (
          <MejiroReader
            key={mode}
            options={OPTIONS}
            fonts={FONTS}
            epub={previewBook}
            chapter={previewChapter}
            subtitle={mode === 'create' ? 'Create Preview' : 'Edit Preview'}
            chapterNavMode="panel"
            enableImageOverlay={false}
            onChapterChange={setPreviewChapter}
          />
        ) : (
          <div className="demo-empty">Loading preview...</div>
        )}
      </main>

      <aside className="demo-options" aria-label="Demo options">
        <div className="demo-tabs" role="tablist" aria-label="Demo modes">
          {(['viewer', 'create', 'edit', 'custom'] satisfies DemoMode[]).map((tab) => (
            <button
              type="button"
              key={tab}
              className={mode === tab ? 'is-active' : ''}
              onClick={() => setMode(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {mode === 'viewer' && (
          <>
            <div className="demo-options-head">
              <span>Reader props</span>
              <strong>Built-in chrome</strong>
            </div>
            <div className="demo-toggle-grid">
              {Object.keys(chrome).map((key) => (
                <label
                  className={`demo-toggle${optionDisabled(key as keyof ReaderChromeOptions) ? ' is-disabled' : ''}`}
                  key={key}
                >
                  <input
                    type="checkbox"
                    checked={effectiveOption(key as keyof ReaderChromeOptions)}
                    disabled={optionDisabled(key as keyof ReaderChromeOptions)}
                    onChange={(event) =>
                      setChromeOption(key as keyof ReaderChromeOptions, event.target.checked)
                    }
                  />
                  <span>{key}</span>
                </label>
              ))}
            </div>
            <div className="demo-option-group">
              <span className="demo-option-label">mode</span>
              <div className="demo-segments">
                {READER_MODES.map((modeValue) => (
                  <button
                    type="button"
                    key={modeValue}
                    className={readerMode === modeValue ? 'is-active' : ''}
                    onClick={() => setReaderMode(modeValue)}
                  >
                    {modeValue}
                  </button>
                ))}
              </div>
            </div>
            <div className="demo-option-group">
              <span className="demo-option-label">spreadMode</span>
              <div className="demo-segments">
                {SPREAD_MODES.map((modeValue) => (
                  <button
                    type="button"
                    key={modeValue}
                    className={spreadMode === modeValue ? 'is-active' : ''}
                    onClick={() => setSpreadMode(modeValue)}
                  >
                    {modeValue}
                  </button>
                ))}
              </div>
            </div>
            <div className="demo-option-group">
              <span className="demo-option-label">theme</span>
              <div className="demo-segments demo-segments-wrap">
                {THEMES.map((themeValue) => (
                  <button
                    type="button"
                    key={themeValue}
                    className={theme === themeValue ? 'is-active' : ''}
                    onClick={() => setTheme(themeValue)}
                  >
                    {themeValue}
                  </button>
                ))}
              </div>
            </div>
            <div className="demo-option-group">
              <span className="demo-option-label">locale</span>
              <div className="demo-segments">
                {LOCALES.map((localeValue) => (
                  <button
                    type="button"
                    key={localeValue}
                    className={locale === localeValue ? 'is-active' : ''}
                    onClick={() => setLocale(localeValue)}
                  >
                    {localeValue}
                  </button>
                ))}
              </div>
            </div>
            <div className="demo-option-group">
              <span className="demo-option-label">chapterNavMode</span>
              <div className="demo-segments">
                {CHAPTER_NAV_MODES.map((navMode) => (
                  <button
                    type="button"
                    key={navMode}
                    className={chapterNavMode === navMode ? 'is-active' : ''}
                    disabled={modeDisabled(navMode)}
                    onClick={() => setChapterNavMode(navMode)}
                  >
                    {navMode}
                  </button>
                ))}
              </div>
            </div>
            <pre>{`<MejiroReader
  mode="${readerMode}"
  spreadMode="${spreadMode}"
  theme="${theme}"
  locale="${locale}"
  enableHeader={${chrome.enableHeader}}
  enableDropZone={${chrome.enableDropZone}}
  enableChapterNav={${chrome.enableChapterNav}}
  chapterNavMode="${effectiveChapterNavMode}"
  enableSettings={${effectiveOption('enableSettings')}}
  enableImageOverlay={${effectiveOption('enableImageOverlay')}}
  enableStats={${effectiveOption('enableStats')}}
  enableKeyboard={${chrome.enableKeyboard}}
  enablePageIndicator={${chrome.enablePageIndicator}}
/>`}</pre>
          </>
        )}

        {mode === 'create' && (
          <>
            <div className="demo-options-head">
              <span>New EPUB</span>
              <strong>Manuscript workspace</strong>
            </div>
            <div className="demo-form">
              <label>
                <span>Title</span>
                <input
                  value={project.metadata.title}
                  onChange={(event) => project.setMetadata({ title: event.target.value })}
                />
              </label>
              <label>
                <span>Author</span>
                <input
                  value={project.metadata.author ?? ''}
                  onChange={(event) => project.setMetadata({ author: event.target.value })}
                />
              </label>
            </div>
            <div className="mejiro-editor-section">
              <div className="demo-section-title">
                <span className="demo-option-label">Chapters</span>
                <small>{project.chapters.length} items</small>
              </div>
              <div className="mejiro-editor-paragraphs demo-list">
                {project.chapters.map((chapter, index) => (
                  <button
                    type="button"
                    key={chapter.id}
                    className={project.selectedChapter === index ? 'is-active' : ''}
                    onClick={() => project.setSelectedChapter(index)}
                  >
                    <span>{`Chapter ${index + 1}`}</span>
                    <strong>{chapter.title || 'Untitled'}</strong>
                  </button>
                ))}
              </div>
              <div className="demo-action-row">
                <button type="button" onClick={() => project.addChapter()}>
                  Add chapter
                </button>
                <button type="button" onClick={() => project.removeChapter()}>
                  Remove
                </button>
              </div>
            </div>
            {project.currentChapter && (
              <div className="demo-form">
                <label>
                  <span>Chapter title</span>
                  <input
                    value={project.currentChapter.title}
                    onChange={(event) =>
                      project.patchChapter(project.selectedChapter, { title: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Draft</span>
                  <textarea
                    className="demo-manuscript"
                    value={project.currentChapter.body}
                    onChange={(event) =>
                      project.patchChapter(project.selectedChapter, { body: event.target.value })
                    }
                  />
                </label>
              </div>
            )}
            {project.previewError && (
              <div className="demo-error">{project.previewError.message}</div>
            )}
            <button
              type="button"
              className="mejiro-editor-export"
              onClick={() =>
                void project
                  .exportEpub()
                  .then((buffer) => downloadEpub(buffer, project.metadata.title))
              }
            >
              Export EPUB{project.previewing ? ' (previewing)' : ''}
            </button>
          </>
        )}

        {mode === 'edit' && (
          <>
            <div className="demo-options-head">
              <span>Existing EPUB</span>
              <strong>{editable.editor?.title ?? 'Loading sample'}</strong>
              {editable.editor?.author && <small>{editable.editor.author}</small>}
            </div>
            {editBook && (
              <>
                <div className="mejiro-editor-section">
                  <div className="demo-section-title">
                    <span className="demo-option-label">Chapter</span>
                    <small>
                      {editBook.chapters[selectedEditChapter]?.paragraphs.length ?? 0} paragraphs
                    </small>
                  </div>
                  <select
                    className="demo-select"
                    value={selectedEditChapter}
                    onChange={(event) =>
                      editable.setSelection({ chapter: Number(event.target.value), paragraph: 0 })
                    }
                  >
                    {editBook.chapters.map((chapter, chapterIndex) => (
                      <option key={chapter.href} value={chapterIndex}>
                        {chapter.title ?? `Chapter ${chapterIndex + 1}`}
                      </option>
                    ))}
                  </select>
                  <input
                    className="demo-search"
                    value={paragraphFilter}
                    placeholder="Filter paragraphs"
                    onChange={(event) => setParagraphFilter(event.target.value)}
                  />
                  <div className="mejiro-editor-paragraphs demo-list demo-list-compact">
                    {filteredParagraphs.map(({ paragraph, paragraphIndex }) => (
                      <button
                        type="button"
                        key={`${editChapter?.href}-${paragraphIndex}`}
                        className={
                          editable.selection.paragraph === paragraphIndex ? 'is-active' : ''
                        }
                        onClick={() =>
                          editable.setSelection({
                            chapter: selectedEditChapter,
                            paragraph: paragraphIndex,
                          })
                        }
                      >
                        <span>{`Paragraph ${paragraphIndex + 1}`}</span>
                        <strong>{paragraph.text.slice(0, 56)}</strong>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="demo-form">
                  <label>
                    <span>Proofread</span>
                    <textarea
                      value={editText}
                      onChange={(event) => updateEditText(event.target.value)}
                      onSelect={(event) => syncRubySelection(event.currentTarget)}
                      ref={editTextareaRef}
                    />
                  </label>
                  <div className="demo-sync-note">Preview updates automatically.</div>
                  <button
                    type="button"
                    className="mejiro-editor-primary"
                    onClick={adjustDialogueLineBreaks}
                  >
                    Adjust dialogue line breaks
                  </button>
                </div>
                <div className="mejiro-editor-section">
                  <span className="demo-option-label">Furigana</span>
                  <div className="demo-ruby-target">
                    {rubyEnd > rubyStart
                      ? [...editText].slice(rubyStart, rubyEnd).join('')
                      : 'Select text in the proofread field'}
                  </div>
                  <input
                    value={rubyText}
                    placeholder="よみがな"
                    onChange={(event) => setRubyText(event.target.value)}
                  />
                  <button type="button" className="mejiro-editor-primary" onClick={applyRuby}>
                    Add furigana to selection
                  </button>
                </div>
                <div className="mejiro-editor-section">
                  <span className="demo-option-label">Images</span>
                  <button type="button" onClick={() => imageInputRef.current?.click()}>
                    Insert image after paragraph
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void addImage(file);
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="mejiro-editor-export"
                  onClick={() =>
                    void editable
                      .exportEpub()
                      .then(
                        (buffer) =>
                          buffer && downloadEpub(buffer, editable.editor?.title || 'edited'),
                      )
                  }
                >
                  Export EPUB
                </button>
              </>
            )}
            {editable.loading && <div className="demo-empty">Loading editor...</div>}
            {editable.error && <div className="demo-error">{editable.error.message}</div>}
          </>
        )}

        {mode === 'custom' && (
          <>
            <div className="demo-options-head">
              <span>Fully custom editor</span>
              <strong>
                useManuscriptDraft + MejiroReader (manuscript source) + MejiroNotationHighlighter
              </strong>
              <small>
                Skips the EPUB round-trip entirely — the Reader on the left is driven straight from
                the chapter array on the right.
              </small>
            </div>
            <div className="mejiro-editor-section">
              <span className="demo-option-label">Chapters</span>
              <div className="mejiro-editor-paragraphs demo-list demo-list-compact">
                {customDraft.chapters.map((chapter, index) => (
                  <button
                    type="button"
                    key={chapter.id}
                    className={customDraft.selected === index ? 'is-active' : ''}
                    onClick={() => customDraft.setSelected(index)}
                  >
                    <span>{`#${index + 1}`}</span>
                    <strong>{chapter.title || 'Untitled'}</strong>
                  </button>
                ))}
              </div>
              <div className="demo-button-row">
                <button
                  type="button"
                  onClick={() =>
                    customDraft.addChapter({ title: `第${customDraft.chapters.length + 1}話` })
                  }
                >
                  Add chapter
                </button>
                <button
                  type="button"
                  onClick={() => customDraft.removeChapter(customDraft.selected)}
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="mejiro-editor-section">
              <span className="demo-option-label">Chapter title</span>
              <input
                className="demo-search"
                value={customDraft.chapters[customDraft.selected]?.title ?? ''}
                onChange={(event) =>
                  customDraft.patchChapter(customDraft.selected, { title: event.target.value })
                }
              />
              <span className="demo-option-label">Body (with notation highlight)</span>
              <MejiroNotationHighlighter
                value={customDraft.chapters[customDraft.selected]?.body ?? ''}
                onChange={(next) => customDraft.patchChapter(customDraft.selected, { body: next })}
                dialect="mejiro"
              />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function paragraphBlockId(
  chapter: NonNullable<ReturnType<typeof useEditableEpub>['book']>['chapters'][number],
  paragraphIndex: number,
): string | undefined {
  let current = 0;
  for (const block of chapter.blocks) {
    if (block.kind !== 'paragraph') continue;
    if (current === paragraphIndex) return block.id;
    current++;
  }
  return undefined;
}
