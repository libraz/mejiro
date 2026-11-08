import type { ManuscriptChapter } from '@libraz/mejiro';
import { type AssetResolver, EpubProject, type ManuscriptDialect } from '@libraz/mejiro/epub';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withErrorReporting } from './errors.js';
import { formatMessage, useI18n } from './i18n.js';
import { downloadEpub } from './MejiroEditor.js';
import { MejiroNotationHighlighter } from './MejiroNotationHighlighter.js';
import { MejiroReader, type MejiroReaderCommonProps } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';
import { mergeDefined, uniqueChapterId } from './persistence.js';
import { createPackageIdentifier } from './useEpubProject.js';
import { useManuscriptDraft } from './useManuscriptDraft.js';

/** Autosave payload emitted by {@link MejiroManuscriptEditor}. */
export interface ManuscriptAutosaveDraft {
  /** Book title as currently entered. */
  title: string;
  /** Author name as currently entered. */
  author: string;
  /** Selected cover image, or `null` when none is set. */
  cover: File | null;
  /** Chapters in reading order, as plain (non-reactive) copies. */
  chapters: readonly ManuscriptChapter[];
}

/**
 * The {@link MejiroReader} props an editor forwards to its live preview. The
 * book, the chapter and its change handler, `fonts` and `onError` are driven
 * by the editor itself.
 */
export type ManuscriptPreviewProps = Pick<
  MejiroReaderCommonProps,
  | 'title'
  | 'subtitle'
  | 'logo'
  | 'theme'
  | 'options'
  | 'pageGeometry'
  | 'mode'
  | 'spreadMode'
  | 'fit'
  | 'chapterNavMode'
  | 'pageNumbers'
  | 'showSettings'
  | 'renderSettings'
  | 'showStats'
  | 'showPageIndicator'
  | 'enableKeyboard'
  | 'enableSurfaceTap'
  | 'locale'
  | 'messages'
  | 'fallback'
>;

/** Props for {@link MejiroManuscriptEditor}. */
export interface MejiroManuscriptEditorProps {
  /** Font choices passed to the preview reader. */
  fonts?: readonly FontChoice[];
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
  /**
   * Chapters. Controlled when `onChaptersChange` is supplied; otherwise the
   * initial chapters. Without any, the editor starts with one chapter titled
   * and filled from the active message catalog.
   */
  chapters?: readonly ManuscriptChapter[];
  /**
   * Called with the whole chapter list after each chapter edit, addition,
   * removal or reorder. Enables controlled mode for `chapters`.
   */
  onChaptersChange?: (chapters: readonly ManuscriptChapter[]) => void;
  /**
   * Manuscript notation dialect. Drives the notation highlighter, the live
   * preview, and the exported EPUB alike, so the whole editor interprets one
   * dialect. @defaultValue `'mejiro'`
   */
  dialect?: ManuscriptDialect;
  /**
   * Called whenever the draft settles (debounced by
   * {@link MejiroManuscriptEditorProps.autosaveDebounceMs}). Use to persist
   * drafts to localStorage, IndexedDB, or upload to a server.
   */
  onAutosave?: (draft: ManuscriptAutosaveDraft) => void | Promise<void>;
  /** Autosave debounce in milliseconds. @defaultValue 800 */
  autosaveDebounceMs?: number;
  /**
   * Props forwarded to the embedded {@link MejiroReader} preview. The preview
   * header shows the work's title unless `title` is given here.
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
  /** Called with the exported bytes, before the download. */
  onExport?: (bytes: Uint8Array<ArrayBuffer>) => void;
  /**
   * Called when the EPUB export fails (asset resolution, cover reading, or
   * packaging) or the preview reader fails. The same error is shown in the editor panel, so hosts only
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

/** File name the cover is stored under in `OPS/Images/`: the upload name made safe, else `cover.<ext>`. */
function coverFilename(file: File): string {
  const filename = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return filename && !/^\.+$/u.test(filename) ? filename : `cover${coverExtension(file.type)}`;
}

/** Content key of a chapter list: equal chapters give an equal key whatever the array identity. */
function chaptersKey(chapters: readonly ManuscriptChapter[]): string {
  return JSON.stringify(chapters.map(({ id, title, body }) => [id ?? null, title, body]));
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
  chapters: chaptersProp,
  onChaptersChange,
  dialect = 'mejiro',
  onAutosave,
  autosaveDebounceMs,
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

  const draft = useManuscriptDraft<ManuscriptAutosaveDraft>({
    initialChapters: chaptersProp?.length
      ? chaptersProp
      : [
          {
            id: uniqueChapterId([]),
            title: formatMessage(messages.manuscriptDefaultChapterTitle, { n: 1 }),
            body: messages.manuscriptDefaultBody,
          },
        ],
    onAutosave,
    autosavePayload: (savedChapters) => ({ title, author, cover, chapters: savedChapters }),
    autosaveDeps: [title, author, cover],
    autosaveDebounceMs,
    defaultChapterTitle: (index) =>
      formatMessage(messages.manuscriptDefaultChapterTitle, { n: index + 1 }),
  });
  const {
    chapters,
    selectedChapterIndex: selected,
    setSelectedChapterIndex: setSelected,
    updateChapter,
    addChapter,
    removeChapter,
    reorderChapters,
    setChapters,
  } = draft;
  const current = chapters[selected] ?? chapters[0];

  // Controlled chapters: an edit is reported and kept only once the host passes
  // it back; a host that keeps its list gets it shown again one commit later.
  // An empty list cannot be shown, so it pins nothing.
  const chaptersControlled = onChaptersChange !== undefined;
  const propKey = chaptersProp ? chaptersKey(chaptersProp) : null;
  const onChaptersChangeRef = useRef(onChaptersChange);
  onChaptersChangeRef.current = onChaptersChange;
  const chaptersPropRef = useRef(chaptersProp);
  chaptersPropRef.current = chaptersProp;
  const chaptersSyncRef = useRef({ prop: propKey, draft: chapters });
  const [hostTurn, setHostTurn] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: hostTurn re-runs the reconcile one commit later.
  useEffect(() => {
    if (!chaptersControlled) return;
    const previous = chaptersSyncRef.current;
    chaptersSyncRef.current = { prop: propKey, draft: chapters };
    const given = chaptersPropRef.current;
    const draftChanged = previous.draft !== chapters;
    if (!given?.length) {
      if (draftChanged) onChaptersChangeRef.current?.(chapters);
      return;
    }
    if (chaptersKey(chapters) === propKey) return;
    if (previous.prop !== propKey) setChapters(given);
    else if (draftChanged) {
      onChaptersChangeRef.current?.(chapters);
      setHostTurn((n) => n + 1);
    } else setChapters(given);
  }, [chaptersControlled, propKey, chapters, hostTurn, setChapters]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [exportError, setExportError] = useState<Error | null>(null);

  /** Shows `error` in the panel and forwards it to `onError`. */
  const reportError = useCallback(
    (error: Error) => {
      setExportError(error);
      onError?.(error);
    },
    [onError],
  );
  const clearError = useCallback(() => setExportError(null), []);

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
    updateChapter(selected, { body: next });
    requestAnimationFrame(() => {
      if (!bodyTextareaRef.current) return;
      const caret = start + open.length + middle.length;
      bodyTextareaRef.current.focus();
      bodyTextareaRef.current.setSelectionRange(start + open.length, caret);
    });
  }

  // One package identifier per editor instance, so re-exports stay one publication.
  const [identifier] = useState(createPackageIdentifier);

  // Every way an export can fail — cover bytes, asset resolution, packaging —
  // reports through the same channel the panel already uses for autosave.
  const exportEpub = useCallback(async () => {
    await withErrorReporting(async () => {
      const project = EpubProject.fromManuscript({
        metadata: {
          title,
          identifier,
          ...(author ? { creators: [{ name: author, role: 'aut' }] } : {}),
        },
        dialect,
        chapters: chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title || messages.untitled,
          body: chapter.body,
        })),
      });
      if (cover) {
        project.setCover({
          filename: coverFilename(cover),
          mediaType: cover.type || 'application/octet-stream',
          data: await cover.arrayBuffer(),
        });
      }
      const bytes = await project.export(assetResolver ? { assetResolver } : undefined);
      clearError();
      onExport?.(bytes);
      downloadEpub(bytes, `${title || 'book'}.epub`);
    }, reportError);
  }, [
    assetResolver,
    author,
    chapters,
    cover,
    dialect,
    identifier,
    messages.untitled,
    onExport,
    clearError,
    reportError,
    title,
  ]);

  const previewManuscript = useMemo(
    () =>
      chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title || messages.untitled,
        body: chapter.body,
      })),
    [chapters, messages.untitled],
  );

  return (
    <div className="mejiro-editor mejiro-manuscript-editor" data-panel-side={panelSide}>
      <main className="mejiro-editor-preview">
        <MejiroReader
          {...mergeDefined<ManuscriptPreviewProps>(
            {
              title,
              subtitle: messages.manuscriptPreviewSubtitle,
              chapterNavMode: 'panel',
              enableSurfaceTap: false,
            },
            previewProps ?? {},
          )}
          manuscript={previewManuscript}
          dialect={dialect}
          fonts={fonts}
          chapterIndex={selected}
          onChapterIndexChange={setSelected}
          onError={reportError}
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
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              // Cleared so picking the same path again still fires `change`.
              event.target.value = '';
              setCover(file);
            }}
          />
        </div>
        <div className="mejiro-editor-section">
          <span className="mejiro-editor-label">{messages.manuscriptChapters}</span>
          <div className="mejiro-editor-paragraphs">
            {chapters.map((chapter, index) => (
              <button
                type="button"
                key={chapter.id ?? index}
                className={selected === index ? 'is-active' : ''}
                draggable
                aria-label={formatMessage(messages.manuscriptReorderHandle, {
                  title: chapter.title || messages.untitled,
                })}
                onClick={() => setSelected(index)}
                onDragStart={(event) => {
                  setDraggingIndex(index);
                  event.dataTransfer.effectAllowed = 'move';
                  // Firefox starts a drag only when the transfer carries data.
                  event.dataTransfer.setData('text/plain', chapter.id ?? String(index));
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
                <span>{formatMessage(messages.chapterN, { n: index + 1 })}</span>
                <strong>{chapter.title || messages.untitled}</strong>
              </button>
            ))}
          </div>
          <div className="mejiro-editor-grid">
            <button type="button" onClick={() => addChapter()}>
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
              onChange={(event) => updateChapter(selected, { title: event.target.value })}
            />
            {/* These markers are recognized by the 'mejiro' dialect only. */}
            {dialect === 'mejiro' && (
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
            )}
            <MejiroNotationHighlighter
              ref={bodyTextareaRef}
              className="mejiro-editor-manuscript"
              dialect={dialect}
              value={current.body}
              onValueChange={(body) => updateChapter(selected, { body })}
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
