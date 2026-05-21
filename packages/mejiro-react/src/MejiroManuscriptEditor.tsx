import { type AssetResolver, type EpubBook, EpubProject, parseEpub } from '@libraz/mejiro/epub';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { MejiroMessages } from './i18n.js';
import { format, useI18n } from './i18n.js';
import { MejiroReader } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';

export interface ManuscriptEditorChapter {
  id: string;
  title: string;
  body: string;
}

/**
 * Subset of {@link MejiroReader} props that the manuscript editor passes
 * through to the live preview. Properties driven by the editor itself
 * (`epub`, `fonts`) are ignored if supplied here.
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
  bare?: boolean;
}

export interface MejiroManuscriptEditorProps {
  /** Font choices passed to the preview reader. */
  fonts?: FontChoice[];
  /** Initial title. */
  title?: string;
  /** Initial author. */
  author?: string;
  /** Initial chapters. */
  chapters?: ManuscriptEditorChapter[];
  /**
   * Props forwarded to the embedded {@link MejiroReader} preview. Lets
   * hosts customize subtitle / chapterNavMode / etc.; `epub` and `fonts`
   * remain driven by the editor.
   */
  previewProps?: ManuscriptPreviewProps;
  /**
   * Resolves URL-only project assets (e.g. covers/illustrations registered as
   * `{ url, ... }`) into bytes at export time. Forwarded to `project.export()`
   * so authors can register signed-URL references without holding raw bytes
   * client-side until publish.
   */
  assetResolver?: AssetResolver;
  /** Called after export completes. */
  onExport?: (buffer: ArrayBuffer) => void;
}

function defaultChapter(messages: MejiroMessages, index = 0): ManuscriptEditorChapter {
  return {
    id: `chapter-${Date.now()}-${index}`,
    title: format(messages.manuscriptDefaultChapterTitle, { n: index + 1 }),
    body: index === 0 ? messages.manuscriptDefaultBody : '',
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

/** Manuscript-to-EPUB editor for author drafts from posting sites. */
export function MejiroManuscriptEditor({
  fonts,
  title: initialTitle,
  author: initialAuthor = '',
  chapters: initialChapters,
  previewProps,
  assetResolver,
  onExport,
}: MejiroManuscriptEditorProps): ReactNode {
  const messages = useI18n();
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [title, setTitle] = useState(initialTitle ?? messages.manuscriptDefaultTitle);
  const [author, setAuthor] = useState(initialAuthor);
  const [chapters, setChapters] = useState<ManuscriptEditorChapter[]>(
    initialChapters?.length ? initialChapters : [defaultChapter(messages)],
  );
  const [selected, setSelected] = useState(0);
  const [cover, setCover] = useState<File | null>(null);
  const [preview, setPreview] = useState<EpubBook | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const current = chapters[selected] ?? chapters[0];

  const buildProject = useCallback((): EpubProject => {
    const project = EpubProject.fromManuscript({
      metadata: { title, author: author || undefined },
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
        data: new Uint8Array(),
      });
    }
    return project;
  }, [title, author, chapters, cover, messages.untitled]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const buffer = await buildProject().export();
          const book = await parseEpub(buffer);
          if (!cancelled) {
            setPreview(book);
            setError(null);
          }
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [buildProject]);

  function patchChapter(index: number, patch: Partial<ManuscriptEditorChapter>): void {
    setChapters((currentChapters) =>
      currentChapters.map((chapter, i) => (i === index ? { ...chapter, ...patch } : chapter)),
    );
  }

  function addChapter(): void {
    setChapters((currentChapters) => {
      const next = [...currentChapters, defaultChapter(messages, currentChapters.length)];
      setSelected(next.length - 1);
      return next;
    });
  }

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
    // Restore selection on next tick.
    requestAnimationFrame(() => {
      if (!bodyTextareaRef.current) return;
      const caret = start + open.length + middle.length;
      bodyTextareaRef.current.focus();
      bodyTextareaRef.current.setSelectionRange(start + open.length, caret);
    });
  }

  function removeChapter(index: number): void {
    setChapters((currentChapters) => {
      if (currentChapters.length <= 1) return currentChapters;
      const next = currentChapters.filter((_, i) => i !== index);
      setSelected(Math.max(0, Math.min(index, next.length - 1)));
      return next;
    });
  }

  async function exportEpub(): Promise<void> {
    const project = buildProject();
    if (cover) {
      project.assets.length = 0;
      project.setCover({
        href: coverAssetHref(cover),
        mediaType: cover.type || undefined,
        data: await cover.arrayBuffer(),
      });
    }
    const buffer = await project.export(assetResolver ? { assetResolver } : undefined);
    onExport?.(buffer);
    downloadEpub(buffer, title);
  }

  return (
    <div className="mejiro-editor mejiro-manuscript-editor">
      <main className="mejiro-editor-preview">
        {preview && (
          <MejiroReader
            subtitle={messages.manuscriptPreviewSubtitle}
            chapterNavMode="panel"
            {...previewProps}
            epub={preview}
            fonts={fonts}
            enableImageOverlay={false}
          />
        )}
        {error && <div className="mejiro-editor-error">{error.message}</div>}
      </main>
      <aside className="mejiro-editor-panel">
        <div className="mejiro-editor-head">
          <span>{messages.manuscriptTitle}</span>
          <strong>{title}</strong>
          <small>{messages.manuscriptRubyHint}</small>
        </div>
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
                onClick={() => setSelected(index)}
              >
                <span>{format(messages.chapterN, { n: index + 1 })}</span>
                <strong>{chapter.title || messages.untitled}</strong>
              </button>
            ))}
          </div>
          <div className="mejiro-editor-grid">
            <button type="button" onClick={addChapter}>
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
            <textarea
              ref={bodyTextareaRef}
              className="mejiro-editor-manuscript"
              value={current.body}
              onChange={(event) => patchChapter(selected, { body: event.target.value })}
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
