import type { BookOptions } from '@libraz/mejiro/book';
import { type AssetResolver, EpubProject, type ManuscriptDialect } from '@libraz/mejiro/epub';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { MejiroMessages } from './i18n.js';
import { format, useI18n } from './i18n.js';
import { MejiroNotationHighlighter } from './MejiroNotationHighlighter.js';
import { MejiroReader, type MejiroReaderSettingsSlot, type MejiroTheme } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';
import { useManuscriptDraft } from './useManuscriptDraft.js';

export interface ManuscriptEditorChapter {
  id: string;
  title: string;
  body: string;
}

/** Autosave payload emitted by {@link MejiroManuscriptEditor}. */
export interface ManuscriptAutosaveDraft {
  title: string;
  author: string;
  cover: File | null;
  chapters: ManuscriptEditorChapter[];
}

/**
 * Subset of {@link MejiroReader} props that the manuscript editor passes
 * through to the live preview. Properties driven by the editor itself
 * (`manuscript`, `fonts`, `chapter`, `onChapterChange`) are ignored if
 * supplied here.
 */
export interface ManuscriptPreviewProps {
  subtitle?: string;
  title?: string;
  chapterNavMode?: 'select' | 'panel' | 'both' | 'none';
  enableHeader?: boolean;
  enableChapterNav?: boolean;
  enableSettings?: boolean;
  enableStats?: boolean;
  enableKeyboard?: boolean;
  enablePageIndicator?: boolean;
  /** Book options forwarded to the embedded reader preview. */
  options?: Partial<BookOptions>;
  /** Theme forwarded to the embedded reader preview. */
  theme?: MejiroTheme;
  /** Custom settings controls forwarded to the embedded reader preview. */
  renderSettings?: (slot: MejiroReaderSettingsSlot) => ReactNode;
  /**
   * Toggle the surface-tap chrome-hide behavior of the embedded reader.
   * Defaults to `false` here (the editor's preview is part of a side-by-side
   * authoring workflow where tap-to-hide would surprise the author). Set
   * to `true` to demo the fullscreen-reader behavior.
   */
  enableSurfaceTap?: boolean;
  bare?: boolean;
}

/** Props for {@link MejiroManuscriptEditor}. */
export interface MejiroManuscriptEditorProps {
  /** Font choices passed to the preview reader. */
  fonts?: FontChoice[];
  /**
   * Title. When `onTitleChange` is supplied, this is the controlled value
   * (changes propagate from parent to the input). Otherwise it is the
   * initial value and the editor manages its own title state.
   */
  title?: string;
  /** Called whenever the title input changes. Enables controlled mode. */
  onTitleChange?: (title: string) => void;
  /**
   * Author. Controlled when `onAuthorChange` is supplied; otherwise treated
   * as the initial value.
   */
  author?: string;
  /** Called whenever the author input changes. Enables controlled mode. */
  onAuthorChange?: (author: string) => void;
  /**
   * Cover image. Controlled when `onCoverChange` is supplied; otherwise
   * treated as the initial cover. Setting `null` clears the cover.
   */
  cover?: File | null;
  /** Called whenever the cover changes. Enables controlled mode. */
  onCoverChange?: (cover: File | null) => void;
  /** Initial chapters. */
  chapters?: ManuscriptEditorChapter[];
  /**
   * Manuscript notation dialect. Drives the notation highlighter, the live
   * preview, and the exported EPUB alike, so the whole editor interprets one
   * dialect. @defaultValue `'mejiro'`
   */
  dialect?: ManuscriptDialect;
  /**
   * Called whenever the chapter draft settles (debounced by
   * {@link MejiroManuscriptEditorProps.autosaveDelay}). Use to persist drafts
   * to localStorage, IndexedDB, or upload to a server.
   */
  onAutosave?: (draft: ManuscriptAutosaveDraft) => void | Promise<void>;
  /** Autosave debounce in milliseconds. @defaultValue 800 */
  autosaveDelay?: number;
  /**
   * Props forwarded to the embedded {@link MejiroReader} preview. Lets
   * hosts customize subtitle / chapterNavMode / etc.; `manuscript`, `fonts`,
   * `chapter`, and `onChapterChange` remain driven by the editor.
   */
  previewProps?: ManuscriptPreviewProps;
  /**
   * Resolver for URL-only assets, forwarded to `project.export()`. This editor
   * owns a `File` cover and manuscript text only, and embeds the cover bytes
   * itself, so nothing it registers is URL-only — build the project through
   * `useEpubProject` (`setCover` / `setAssets`) to author `{ url }` asset
   * references that must be fetched at export time.
   */
  assetResolver?: AssetResolver;
  /** Called after export completes. */
  onExport?: (buffer: ArrayBuffer) => void;
  /**
   * Called when the EPUB export fails (asset resolution, cover reading, or
   * packaging). The same error is shown in the editor panel, so hosts only
   * need this to log or report it.
   */
  onError?: (error: Error) => void;
  /**
   * Which side of the editor the manuscript panel sits on. `'right'` (the
   * default) puts the preview on the left; `'left'` mirrors the layout.
   * @defaultValue 'right'
   */
  panelSide?: 'left' | 'right';
}

function downloadEpub(buffer: ArrayBuffer, title: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/epub+zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title || 'book'}.epub`;
  a.click();
  URL.revokeObjectURL(url);
}

function coverExtension(mediaType: string): string {
  switch (mediaType) {
    case 'image/gif':
      return '.gif';
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/svg+xml':
      return '.svg';
    case 'image/webp':
      return '.webp';
    default:
      return '.bin';
  }
}

function coverAssetHref(file: File): string {
  const filename = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `OPS/Images/${filename && !/^\.+$/u.test(filename) ? filename : `cover${coverExtension(file.type)}`}`;
}

function defaultChapter(messages: MejiroMessages): ManuscriptEditorChapter {
  return {
    id: `chapter-${Date.now()}-0`,
    title: format(messages.manuscriptDefaultChapterTitle, { n: 1 }),
    body: messages.manuscriptDefaultBody,
  };
}

/** Manuscript-to-EPUB editor for author drafts from posting sites. */
export function MejiroManuscriptEditor({
  fonts,
  title: titleProp,
  onTitleChange,
  author: authorProp,
  onAuthorChange,
  cover: coverProp,
  onCoverChange,
  chapters: initialChapters,
  dialect = 'mejiro',
  onAutosave,
  autosaveDelay,
  previewProps,
  assetResolver,
  onExport,
  onError,
  panelSide = 'right',
}: MejiroManuscriptEditorProps): ReactNode {
  const messages = useI18n();
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const titleControlled = onTitleChange !== undefined;
  const authorControlled = onAuthorChange !== undefined;
  const coverControlled = onCoverChange !== undefined;
  const [titleState, setTitleState] = useState(titleProp ?? messages.manuscriptDefaultTitle);
  const [authorState, setAuthorState] = useState(authorProp ?? '');
  const [coverState, setCoverState] = useState<File | null>(coverProp ?? null);
  const title = titleControlled ? (titleProp ?? '') : titleState;
  const author = authorControlled ? (authorProp ?? '') : authorState;
  const cover = coverControlled ? (coverProp ?? null) : coverState;

  // Sync internal state when the parent updates an uncontrolled prop from
  // outside (rare, but harmless if the parent occasionally swaps values).
  useEffect(() => {
    if (!titleControlled && titleProp !== undefined) setTitleState(titleProp);
  }, [titleControlled, titleProp]);
  useEffect(() => {
    if (!authorControlled && authorProp !== undefined) setAuthorState(authorProp);
  }, [authorControlled, authorProp]);
  useEffect(() => {
    if (!coverControlled && coverProp !== undefined) setCoverState(coverProp);
  }, [coverControlled, coverProp]);

  const setTitle = useCallback(
    (next: string) => {
      if (!titleControlled) setTitleState(next);
      onTitleChange?.(next);
    },
    [titleControlled, onTitleChange],
  );
  const setAuthor = useCallback(
    (next: string) => {
      if (!authorControlled) setAuthorState(next);
      onAuthorChange?.(next);
    },
    [authorControlled, onAuthorChange],
  );
  const setCover = useCallback(
    (next: File | null) => {
      if (!coverControlled) setCoverState(next);
      onCoverChange?.(next);
    },
    [coverControlled, onCoverChange],
  );

  const draft = useManuscriptDraft({
    initialChapters: initialChapters?.length ? initialChapters : [defaultChapter(messages)],
    onAutosave,
    autosavePayload: (savedChapters) => ({ title, author, cover, chapters: savedChapters }),
    autosaveKey: `${title}\u0000${author}\u0000${cover?.name ?? ''}\u0000${cover?.size ?? 0}\u0000${
      cover?.lastModified ?? 0
    }`,
    autosaveDelay,
    defaultChapterTitle: (index) =>
      format(messages.manuscriptDefaultChapterTitle, { n: index + 1 }),
  });
  const {
    chapters,
    selected,
    setSelected,
    patchChapter,
    addChapter,
    removeChapter,
    reorderChapters,
  } = draft;
  const current = chapters[selected] ?? chapters[0];
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [exportError, setExportError] = useState<Error | null>(null);

  /**
   * Wraps the current textarea selection in the given notation. When no
   * range is selected, the markers are inserted at the caret with the caret
   * placed between them.
   */
  function wrapSelection(open: string, close: string): void {
    const el = bodyTextareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.slice(0, start);
    const middle = el.value.slice(start, end);
    const after = el.value.slice(end);
    const next = `${before}${open}${middle}${close}${after}`;
    patchChapter(selected, { body: next });
    requestAnimationFrame(() => {
      if (!bodyTextareaRef.current) return;
      const caret = start + open.length + middle.length;
      bodyTextareaRef.current.focus();
      bodyTextareaRef.current.setSelectionRange(start + open.length, caret);
    });
  }

  // Every way an export can fail — cover bytes, asset resolution, packaging —
  // reports through the same channel the panel already uses for autosave.
  const exportEpub = useCallback(async () => {
    try {
      const project = EpubProject.fromManuscript({
        metadata: { title, author: author || undefined },
        dialect,
        chapters: chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title || messages.untitled,
          body: chapter.body,
        })),
      });
      if (cover) {
        project.setCover({
          href: coverAssetHref(cover),
          mediaType: cover.type || undefined,
          data: await cover.arrayBuffer(),
        });
      }
      const buffer = await project.export(assetResolver ? { assetResolver } : undefined);
      setExportError(null);
      onExport?.(buffer);
      downloadEpub(buffer, title);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      setExportError(error);
      onError?.(error);
    }
  }, [
    assetResolver,
    author,
    chapters,
    cover,
    dialect,
    messages.untitled,
    onError,
    onExport,
    title,
  ]);

  return (
    <div className="mejiro-editor mejiro-manuscript-editor" data-panel-side={panelSide}>
      <main className="mejiro-editor-preview">
        <MejiroReader
          subtitle={messages.manuscriptPreviewSubtitle}
          chapterNavMode="panel"
          enableSurfaceTap={false}
          {...previewProps}
          manuscript={chapters.map((chapter) => ({
            id: chapter.id,
            title: chapter.title || messages.untitled,
            body: chapter.body,
          }))}
          dialect={dialect}
          fonts={fonts}
          chapter={selected}
          onChapterChange={setSelected}
          enableImageOverlay={false}
        />
      </main>
      <aside className="mejiro-editor-panel">
        <div className="mejiro-editor-head">
          <span>{messages.manuscriptTitle}</span>
          <strong>{title}</strong>
          <small>{messages.manuscriptRubyHint}</small>
        </div>
        {draft.autosaveError && (
          <div className="mejiro-editor-error">{draft.autosaveError.message}</div>
        )}
        {exportError && <div className="mejiro-editor-error">{exportError.message}</div>}
        <div className="mejiro-editor-section">
          <span className="mejiro-editor-label">{messages.manuscriptMetadata}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
          <input value={author} onChange={(event) => setAuthor(event.target.value)} />
          <button type="button" onClick={() => coverInputRef.current?.click()}>
            {cover ? cover.name : messages.manuscriptChooseCoverImage}
          </button>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => setCover(event.target.files?.[0] ?? null)}
          />
        </div>
        <div className="mejiro-editor-section">
          <span className="mejiro-editor-label">{messages.manuscriptChapters}</span>
          <div className="mejiro-editor-paragraphs">
            {chapters.map((chapter, index) => (
              <button
                type="button"
                key={chapter.id}
                className={selected === index ? 'is-active' : ''}
                draggable
                aria-label={format(messages.manuscriptReorderHandle, {
                  title: chapter.title || messages.untitled,
                })}
                onClick={() => setSelected(index)}
                onDragStart={(event) => {
                  setDraggingIndex(index);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDraggingIndex(null)}
                onDragOver={(event) => {
                  if (draggingIndex === null || draggingIndex === index) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingIndex !== null && draggingIndex !== index) {
                    reorderChapters(draggingIndex, index);
                  }
                  setDraggingIndex(null);
                }}
                data-dragging={draggingIndex === index ? '' : undefined}
              >
                <span>{format(messages.chapterN, { n: index + 1 })}</span>
                <strong>{chapter.title || messages.untitled}</strong>
              </button>
            ))}
          </div>
          <div className="mejiro-editor-grid">
            <button
              type="button"
              onClick={() =>
                addChapter({
                  title: format(messages.manuscriptDefaultChapterTitle, {
                    n: chapters.length + 1,
                  }),
                })
              }
            >
              {messages.manuscriptAddChapter}
            </button>
            <button type="button" onClick={() => removeChapter(selected)}>
              {messages.manuscriptRemove}
            </button>
          </div>
        </div>
        {current && (
          <div className="mejiro-editor-section">
            <span className="mejiro-editor-label">{messages.manuscriptDraft}</span>
            <input
              value={current.title}
              onChange={(event) => patchChapter(selected, { title: event.target.value })}
            />
            <div className="mejiro-editor-grid mejiro-editor-notation">
              <button type="button" onClick={() => wrapSelection('《《', '》》')}>
                {messages.manuscriptEmphasisDots}
              </button>
              <button type="button" onClick={() => wrapSelection('〔', '〕')}>
                {messages.manuscriptTcy}
              </button>
              <button type="button" onClick={() => wrapSelection('*', '*')}>
                {messages.manuscriptEm}
              </button>
              <button type="button" onClick={() => wrapSelection('**', '**')}>
                {messages.manuscriptStrong}
              </button>
            </div>
            <MejiroNotationHighlighter
              ref={bodyTextareaRef}
              className="mejiro-editor-manuscript"
              dialect={dialect}
              value={current.body}
              onChange={(body) => patchChapter(selected, { body })}
            />
          </div>
        )}
        <button type="button" className="mejiro-editor-export" onClick={() => void exportEpub()}>
          {messages.editorExportEpub}
        </button>
      </aside>
    </div>
  );
}
