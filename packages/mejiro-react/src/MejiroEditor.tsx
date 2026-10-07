import type { InlineAnnotation } from '@libraz/mejiro/browser';
import {
  type AssetResolver,
  cloneEditableEpubBook,
  EditableEpub,
  type EditableEpubBook,
  type EditableParagraphBlock,
  type EpubParseLimits,
  exportEditableEpub,
} from '@libraz/mejiro/epub';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchEpubBuffer, readEpubFile, toError, withErrorReporting } from './errors.js';
import { format, useI18n } from './i18n.js';
import { MejiroDropZone } from './MejiroDropZone.js';
import { MejiroReader, type MejiroReaderHandle } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';

/** Props for {@link MejiroEditor}. */
export interface MejiroEditorProps {
  /** URL fetched and loaded on mount. */
  epubUrl?: string;
  /** Font choices passed to the preview reader. */
  fonts?: FontChoice[];
  /**
   * Allow editing paragraph text (the "Proofread" section).
   * @defaultValue true
   */
  enableProofread?: boolean;
  /**
   * Allow editing ruby annotations (the "Ruby" section).
   * @defaultValue true
   */
  enableRuby?: boolean;
  /**
   * Allow inserting images into the EPUB (the "Images" section).
   * @defaultValue true
   */
  enableImages?: boolean;
  /**
   * Allow exporting the edited EPUB. SaaS publishers can disable this to
   * restrict downloads (e.g. server-side export only).
   * @defaultValue true
   */
  enableExport?: boolean;
  /**
   * Called before the export buffer is offered as a download. Return `false`
   * (or a `Promise<false>`) to suppress the browser download — useful for
   * uploading the buffer to a backend instead.
   */
  onBeforeExport?: (buffer: ArrayBuffer) => boolean | undefined | Promise<boolean | undefined>;
  /**
   * Declarative export policy. When set, supersedes `onBeforeExport` for
   * download control and threads watermark / encrypt transforms through the
   * export pipeline.
   */
  exportPolicy?: MejiroExportPolicy;
  /**
   * Resolves URL-only image assets ({@link EditableImageAsset.url} set, `data`
   * unset) into bytes at export time. Forwarded to `editor.export()`. Use this
   * to keep large image bytes off the client during editing and only fetch
   * them once when the EPUB is assembled — e.g. signed S3 URLs that require
   * custom auth headers.
   */
  assetResolver?: AssetResolver;
  /**
   * Archive resource limits applied while opening an EPUB. Raise them for
   * trusted, image-heavy books; tighten them for a public drop zone. Omitted
   * fields keep their `DEFAULT_EPUB_PARSE_LIMITS` value.
   */
  limits?: Partial<EpubParseLimits>;
  /** Called after an EPUB is loaded into the editor. */
  onLoad?: (editor: EditableEpub) => void;
  /** Called after export completes. */
  onExport?: (buffer: ArrayBuffer) => void;
  /**
   * Called when loading, image insertion or export fails. The error is also
   * shown in the editor.
   */
  onError?: (error: Error) => void;
}

/**
 * Declarative restrictions on the export pipeline. Mejiro applies the
 * transforms in this order: `watermark` (applied to an export-only copy of the
 * book, never to the edited document) → `encrypt` (replaces the buffer with the
 * result) → `allowDownload` (skips the browser download when `false`).
 */
export interface MejiroExportPolicy {
  /**
   * If `false`, the EPUB buffer is still produced (and `onExport` still fires)
   * but no browser download is triggered. Use when shipping the buffer
   * elsewhere (e.g. uploading to a backend).
   * @defaultValue true
   */
  allowDownload?: boolean;
  /**
   * Transforms the EPUB buffer before it is offered for download. Typically
   * a server round-trip that returns a DRM-wrapped EPUB.
   */
  encrypt?: (buffer: ArrayBuffer) => ArrayBuffer | Promise<ArrayBuffer>;
  /**
   * Embeds a visible watermark string into the exported EPUB. Implemented as a
   * paragraph block prefixed with `[mejiro-watermark]` at the top of every
   * chapter, so a downstream renderer can theme it by that prefix. The block
   * only exists in the exported file — the edited document is unchanged.
   */
  watermark?: { text: string };
}

type Selection = {
  chapter: number;
  paragraph: number;
};

/** A ruby to add on commit, as a codepoint range into the proofread buffer. */
type PendingRuby = { start: number; end: number; rubyText: string };

/**
 * Clamps a ruby base range to a paragraph of `length` codepoints, resolving a
 * caret at the end of the text to the last character. Returns `null` when the
 * paragraph is empty and has no base character.
 */
function clampRubyRange(
  start: number,
  end: number,
  length: number,
): { start: number; end: number } | null {
  if (length <= 0) return null;
  const from = Math.max(0, Math.min(start, length - 1));
  return { start: from, end: Math.max(from + 1, Math.min(end, length)) };
}

/**
 * Commits the editor's pending edit to one paragraph: the proofread buffer
 * first, re-anchoring existing annotations onto it, then `ruby` clamped onto
 * the committed text. A new ruby replaces only the ruby it overlaps. Returns
 * whether the document changed.
 */
function commitPendingEdit(
  editor: EditableEpub,
  chapterIndex: number,
  paragraphIndex: number,
  text: string,
  ruby?: PendingRuby,
): boolean {
  const paragraphs = editor.book.chapters[chapterIndex]?.paragraphs;
  if (!paragraphs?.[paragraphIndex]) return false;
  const textChanged = text !== paragraphs[paragraphIndex].text;
  const rubyText = ruby?.rubyText.trim();
  const range = ruby ? clampRubyRange(ruby.start, ruby.end, [...text].length) : null;
  if (!(rubyText && range)) {
    if (textChanged) editor.updateParagraph(chapterIndex, paragraphIndex, { text });
    return textChanged;
  }
  editor.transaction(() => {
    if (textChanged) editor.updateParagraph(chapterIndex, paragraphIndex, { text });
    const committed = editor.book.chapters[chapterIndex].paragraphs[paragraphIndex];
    const newRuby: InlineAnnotation = {
      kind: 'ruby',
      startIndex: range.start,
      endIndex: range.end,
      rubyText,
      type: range.end - range.start === 1 ? 'mono' : 'group',
    };
    const inlineAnnotations = [
      ...committed.inlineAnnotations.filter(
        (ann) => ann.kind !== 'ruby' || ann.endIndex <= range.start || ann.startIndex >= range.end,
      ),
      newRuby,
    ].sort((a, b) => a.startIndex - b.startIndex);
    editor.updateParagraph(chapterIndex, paragraphIndex, { inlineAnnotations });
  });
  return true;
}

/**
 * Offers `buffer` as a browser download named `filename`. The object URL is
 * revoked on the next task, after the browser has started consuming it, and
 * exactly once even when `click()` throws.
 */
export function downloadEpub(buffer: ArrayBuffer, filename: string): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/epub+zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Maps a UTF-16 code-unit offset to a codepoint offset. */
function utf16ToCodepoint(text: string, utf16Offset: number): number {
  let cp = 0;
  let i = 0;
  while (i < utf16Offset && i < text.length) {
    const ch = text.codePointAt(i);
    if (ch === undefined) break;
    i += ch > 0xffff ? 2 : 1;
    cp++;
  }
  return cp;
}

/** Marker prefix a renderer can key off to style the watermark paragraph. */
const WATERMARK_PREFIX = '[mejiro-watermark]';

/** Preferred block id of the watermark paragraph. */
const WATERMARK_BLOCK_ID = 'mejiro-watermark';

/**
 * Returns an export-only copy of `book` carrying a watermark paragraph at the
 * top of every chapter. The editor's own document is left untouched, so the
 * watermark cannot accumulate across repeated exports.
 */
function watermarkedBook(book: EditableEpubBook, watermark: { text: string }): EditableEpubBook {
  const copy = cloneEditableEpubBook(book);
  const text = `${WATERMARK_PREFIX} ${watermark.text}`;
  for (const chapter of copy.chapters) {
    chapter.blocks.unshift({
      kind: 'paragraph',
      id: watermarkBlockId(chapter),
      text,
      inlineAnnotations: [],
    });
    chapter.paragraphs.unshift({ text, inlineAnnotations: [] });
    chapter.isDirty = true;
  }
  return copy;
}

/** Picks a block id for the watermark paragraph that the chapter does not use. */
function watermarkBlockId(chapter: EditableEpubBook['chapters'][number]): string {
  const used = new Set(chapter.blocks.map((block) => block.id));
  let id = WATERMARK_BLOCK_ID;
  let suffix = 2;
  while (used.has(id)) id = `${WATERMARK_BLOCK_ID}-${suffix++}`;
  return id;
}

/** EPUB editor UI for proofreading, ruby edits, image insertion, and export. */
export function MejiroEditor({
  epubUrl,
  fonts,
  enableProofread = true,
  enableRuby = true,
  enableImages = true,
  enableExport = true,
  onBeforeExport,
  exportPolicy,
  assetResolver,
  limits,
  onLoad,
  onExport,
  onError,
}: MejiroEditorProps): ReactNode {
  const messages = useI18n();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const readerRef = useRef<MejiroReaderHandle | null>(null);
  const [editor, setEditor] = useState<EditableEpub | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<Selection>({ chapter: 0, paragraph: 0 });
  const [text, setText] = useState('');
  const [rubyStart, setRubyStart] = useState(0);
  const [rubyEnd, setRubyEnd] = useState(1);
  const [rubyText, setRubyText] = useState('');
  const loadRequestIdRef = useRef(0);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const limitsRef = useRef(limits);
  limitsRef.current = limits;

  const book = editor?.book ?? null;
  const chapter = book?.chapters[selection.chapter] ?? null;
  const paragraph = chapter?.paragraphs[selection.paragraph] ?? null;
  // A scene break exports as a bare divider, so it carries no editable text.
  const sceneBreak = chapter
    ? paragraphBlock(chapter, selection.paragraph)?.paragraphKind === 'sceneBreak'
    : false;
  const rubyRange = clampRubyRange(rubyStart, rubyEnd, [...text].length);
  const previewBook = useMemo(() => {
    void revision;
    return book ? cloneEditableEpubBook(book) : null;
  }, [book, revision]);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  /** Shows `nextError` in the editor and forwards it to `onError`. */
  const reportError = useCallback((nextError: Error) => {
    setError(nextError);
    onErrorRef.current?.(nextError);
  }, []);

  const loadBufferForRequest = useCallback(
    async (buffer: ArrayBuffer, requestId: number) => {
      setLoading(true);
      setError(null);
      try {
        const next = await EditableEpub.load(buffer, { limits: limitsRef.current });
        if (requestId !== loadRequestIdRef.current) return;
        setEditor(next);
        setSelection({ chapter: 0, paragraph: 0 });
        setRevision((value) => value + 1);
        onLoadRef.current?.(next);
      } catch (err) {
        if (requestId === loadRequestIdRef.current) reportError(toError(err));
      } finally {
        if (requestId === loadRequestIdRef.current) setLoading(false);
      }
    },
    [reportError],
  );

  async function loadFile(file: File): Promise<void> {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await loadBufferForRequest(await readEpubFile(file, limitsRef.current), requestId);
    } catch (err) {
      if (requestId === loadRequestIdRef.current) {
        reportError(toError(err));
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!epubUrl) return;
    let cancelled = false;
    const requestId = ++loadRequestIdRef.current;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const buffer = await fetchEpubBuffer(epubUrl);
        if (cancelled || requestId !== loadRequestIdRef.current) return;
        await loadBufferForRequest(buffer, requestId);
      } catch (err) {
        if (!cancelled && requestId === loadRequestIdRef.current) reportError(toError(err));
      } finally {
        if (!cancelled && requestId === loadRequestIdRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [epubUrl, loadBufferForRequest, reportError]);

  // The proofread buffer resets only when the edit target moves. A document
  // regenerated under the same target (image insert, apply) keeps unapplied text.
  const syncedRef = useRef<{ editor: EditableEpub | null; target: string; text: string } | null>(
    null,
  );
  useEffect(() => {
    const nextText = paragraph?.text ?? '';
    const target = `${selection.chapter}:${selection.paragraph}`;
    const prev = syncedRef.current;
    syncedRef.current = { editor, target, text: nextText };
    if (prev && prev.editor === editor && prev.target === target) {
      setText((current) => (current === prev.text ? nextText : current));
      return;
    }
    setText(nextText);
    setRubyStart(0);
    setRubyEnd(Math.min(1, [...nextText].length));
    setRubyText('');
  }, [editor, selection.chapter, selection.paragraph, paragraph]);

  // Keep the preview on the selected paragraph, including after each edit
  // re-clones the preview book.
  useEffect(() => {
    if (!previewBook) return;
    void readerRef.current?.goToAnchor({
      chapter: selection.chapter,
      paragraph: selection.paragraph,
      charIndex: 0,
    });
  }, [previewBook, selection.chapter, selection.paragraph]);

  /**
   * Moves the edit target. A pending proofread edit is committed before the
   * switch, so changing paragraphs never drops unsaved text.
   */
  function selectParagraph(chapterIndex: number, paragraphIndex: number): void {
    if (chapterIndex === selection.chapter && paragraphIndex === selection.paragraph) return;
    commitEdit();
    setSelection({ chapter: chapterIndex, paragraph: paragraphIndex });
  }

  /**
   * Captures the textarea's current selection as a codepoint range and stores
   * it on the ruby form. Falls back to a one-character span at the caret when
   * nothing is selected.
   */
  function captureRubyRange(): void {
    const el = textareaRef.current;
    if (!el) return;
    const utf16Start = el.selectionStart ?? 0;
    const utf16End = el.selectionEnd ?? utf16Start;
    const start = utf16ToCodepoint(text, utf16Start);
    const end = utf16ToCodepoint(text, Math.max(utf16End, utf16Start + 1));
    setRubyStart(start);
    setRubyEnd(Math.max(start + 1, end));
  }

  /** Flushes the proofread buffer, plus `ruby` when given, into the document. */
  function commitEdit(ruby?: PendingRuby): void {
    if (!editor) return;
    if (commitPendingEdit(editor, selection.chapter, selection.paragraph, text, ruby)) {
      setRevision((value) => value + 1);
    }
  }

  function applyRuby(): void {
    if (!(rubyRange && rubyText.trim())) return;
    commitEdit({ start: rubyStart, end: rubyEnd, rubyText });
    setRubyText('');
  }

  async function addImage(file: File): Promise<void> {
    await withErrorReporting(async () => {
      if (!(editor && chapter)) return;
      const chapterIndex = selection.chapter;
      const afterBlockId = paragraphBlock(chapter, selection.paragraph)?.id;
      const data = await file.arrayBuffer();
      editor.addImage(chapterIndex, {
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        data,
        alt: file.name,
        afterBlockId,
      });
      setRevision((value) => value + 1);
    }, reportError);
  }

  async function exportEpub(): Promise<void> {
    await withErrorReporting(async () => {
      if (!editor) return;
      commitEdit();
      const watermark = exportPolicy?.watermark;
      const source = watermark ? watermarkedBook(editor.book, watermark) : editor.book;
      let buffer = await exportEditableEpub(source, assetResolver ? { assetResolver } : undefined);
      if (exportPolicy?.encrypt) buffer = await exportPolicy.encrypt(buffer);
      const decision = await onBeforeExport?.(buffer);
      onExport?.(buffer);
      // An export policy supersedes onBeforeExport for download control.
      const allowDownload = exportPolicy
        ? exportPolicy.allowDownload !== false
        : decision !== false;
      if (!allowDownload) return;
      downloadEpub(buffer, `${editor.title || 'edited'}.epub`);
    }, reportError);
  }

  return (
    <div className="mejiro-editor">
      <main className="mejiro-editor-preview">
        {previewBook ? (
          <MejiroReader
            ref={readerRef}
            epub={previewBook}
            chapter={selection.chapter}
            onChapterChange={(index) => selectParagraph(index, 0)}
            fonts={fonts}
            subtitle={messages.editorPreviewSubtitle}
            chapterNavMode="panel"
            enableImageOverlay={false}
            enableSurfaceTap={false}
          />
        ) : (
          <MejiroDropZone onFile={(file) => void loadFile(file)} />
        )}
        {loading && <div className="mejiro-editor-loading">{messages.loading}</div>}
        {error && <div className="mejiro-editor-error">{error.message}</div>}
      </main>
      <aside className="mejiro-editor-panel">
        <div className="mejiro-editor-head">
          <span>{messages.editorTitle}</span>
          <strong>{editor?.title ?? messages.editorNoBookLoaded}</strong>
          {editor?.author && <small>{editor.author}</small>}
        </div>
        {book && (
          <>
            <div className="mejiro-editor-section">
              <span className="mejiro-editor-label">{messages.editorParagraphs}</span>
              <div className="mejiro-editor-paragraphs">
                {book.chapters.map((ch, ci) =>
                  ch.blocks
                    .filter((b) => b.kind === 'paragraph')
                    .map((block, pi) => (
                      <button
                        type="button"
                        key={`${ch.href}-${block.id}`}
                        className={
                          selection.chapter === ci && selection.paragraph === pi ? 'is-active' : ''
                        }
                        onClick={() => selectParagraph(ci, pi)}
                      >
                        <span>{ch.title ?? format(messages.chapterN, { n: ci + 1 })}</span>
                        <strong>{block.text.slice(0, 42)}</strong>
                      </button>
                    )),
                )}
              </div>
            </div>
            {enableProofread && (
              <div className="mejiro-editor-section">
                <span className="mejiro-editor-label">{messages.editorProofread}</span>
                <textarea
                  ref={textareaRef}
                  value={text}
                  readOnly={sceneBreak}
                  onChange={(event) => setText(event.target.value)}
                  onSelect={captureRubyRange}
                />
                <button
                  type="button"
                  className="mejiro-editor-primary"
                  disabled={sceneBreak}
                  onClick={() => commitEdit()}
                >
                  {messages.editorApplyText}
                </button>
              </div>
            )}
            {enableRuby && (
              <div className="mejiro-editor-section">
                <span className="mejiro-editor-label">{messages.editorRuby}</span>
                <p className="mejiro-editor-hint">{messages.editorRubyHint}</p>
                <p className="mejiro-editor-range">
                  {format(messages.editorRubyRange, {
                    start: rubyRange?.start ?? 0,
                    end: rubyRange?.end ?? 0,
                    count: rubyRange ? rubyRange.end - rubyRange.start : 0,
                  })}
                </p>
                <input
                  value={rubyText}
                  placeholder={messages.editorRubyPlaceholder}
                  onChange={(event) => setRubyText(event.target.value)}
                />
                <button
                  type="button"
                  className="mejiro-editor-primary"
                  disabled={!(rubyRange && rubyText.trim())}
                  onClick={applyRuby}
                >
                  {messages.editorApplyRuby}
                </button>
              </div>
            )}
            {enableImages && (
              <div className="mejiro-editor-section">
                <span className="mejiro-editor-label">{messages.editorImages}</span>
                <button type="button" onClick={() => imageInputRef.current?.click()}>
                  {messages.editorInsertImageAfterParagraph}
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
            )}
            {enableExport && (
              <button
                type="button"
                className="mejiro-editor-export"
                onClick={() => void exportEpub()}
              >
                {messages.editorExportEpub}
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function paragraphBlock(
  chapter: EditableEpubBook['chapters'][number],
  paragraphIndex: number,
): EditableParagraphBlock | undefined {
  let current = 0;
  for (const block of chapter.blocks) {
    if (block.kind !== 'paragraph') continue;
    if (current === paragraphIndex) return block;
    current++;
  }
  return undefined;
}
