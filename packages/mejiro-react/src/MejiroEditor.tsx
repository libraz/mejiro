import type { BinaryInput, InlineAnnotation } from '@libraz/mejiro';
import {
  type AssetResolver,
  type EditableEpub,
  type EditableEpubChapter,
  type EditableEpubExportOptions,
  type EditableParagraphBlock,
  type EpubParseLimits,
  editableEpubToEpubBook,
  parseEditableEpub,
} from '@libraz/mejiro/epub';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { markBookIdentity } from './bookIdentity.js';
import { fetchEpubBytes, readEpubFile, toError, withErrorReporting } from './errors.js';
import { formatMessage, useI18n } from './i18n.js';
import { MejiroDropZone } from './MejiroDropZone.js';
import type { ManuscriptPreviewProps } from './MejiroManuscriptEditor.js';
import { MejiroReader, type MejiroReaderHandle } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';
import { mergeDefined } from './persistence.js';
import type { FetchEpubOptions } from './useEpub.js';
import { useRequestToken } from './useRequestToken.js';

/** Props for {@link MejiroEditor}. */
export interface MejiroEditorProps {
  /** EPUB URL, loaded on mount and whenever it changes. */
  epubUrl?: string;
  /**
   * Extra options merged into the `fetch` call that loads `epubUrl`. Useful
   * for sending bearer tokens or cookies (`credentials: 'include'`).
   */
  fetchOptions?: RequestInit;
  /**
   * Custom EPUB fetcher used in place of the global `fetch`; resolves to the
   * raw bytes. `options.signal` aborts when the load is superseded or the
   * editor unmounts. Overrides {@link MejiroEditorProps.fetchOptions} when set.
   */
  fetchEpub?: (url: string, options: FetchEpubOptions) => Promise<BinaryInput>;
  /** Font choices passed to the preview reader. */
  fonts?: readonly FontChoice[];
  /**
   * Allow editing paragraph text (the "Proofread" section). When `false` and
   * `enableRuby` is on, the paragraph text stays visible read-only so a ruby
   * base range can still be selected.
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
   * Show the export button. SaaS publishers can hide it to restrict downloads
   * (e.g. server-side export only).
   * @defaultValue true
   */
  showExportButton?: boolean;
  /** What the export button produces and whether it is offered as a download. */
  exportPolicy?: ExportPolicy;
  /**
   * Resolves URL-only image assets (`url` set, `data` unset) into bytes at
   * export time. Forwarded to `editor.export()`. Use this to keep large image
   * bytes off the client during editing and only fetch them once when the
   * EPUB is assembled — e.g. signed S3 URLs that require custom auth headers.
   */
  assetResolver?: AssetResolver;
  /**
   * Archive resource limits applied while opening an EPUB. Raise them for
   * trusted, image-heavy books; tighten them for a public drop zone. Omitted
   * fields keep their `DEFAULT_EPUB_PARSE_LIMITS` value.
   */
  limits?: Partial<EpubParseLimits>;
  /**
   * Props forwarded to the embedded {@link MejiroReader} preview (theme,
   * options, chrome). The book, the chapter and its change handler, `fonts`
   * and `onError` remain driven by the editor.
   */
  previewProps?: ManuscriptPreviewProps;
  /** Called after an EPUB is loaded into the editor. */
  onLoad?: (editor: EditableEpub) => void;
  /** Called with the exported bytes, after `exportPolicy.transform`, before any download. */
  onExport?: (bytes: Uint8Array<ArrayBuffer>) => void;
  /**
   * Called when loading, image insertion, export or the preview reader fails.
   * The error is also shown in the editor until a later load, image insertion
   * or export succeeds.
   */
  onError?: (error: Error) => void;
}

/**
 * Restrictions on what {@link MejiroEditor}'s export produces. Applied in
 * this order: `watermark` (written into the exported copy only, never into the
 * edited document) → `transform` (replaces the bytes with its result) →
 * `download`.
 */
export interface ExportPolicy {
  /**
   * Offer the exported bytes as a browser download. With `false` the bytes are
   * still produced and `onExport` still fires — use it to ship the bytes
   * elsewhere (e.g. uploading to a backend).
   * @defaultValue true
   */
  download?: boolean;
  /**
   * Transforms the exported bytes before `onExport` and the download.
   * Typically a server round-trip that returns a DRM-wrapped EPUB.
   */
  transform?: (
    bytes: Uint8Array<ArrayBuffer>,
  ) => Uint8Array<ArrayBuffer> | Promise<Uint8Array<ArrayBuffer>>;
  /**
   * Visible watermark text. Each exported chapter starts with a paragraph
   * holding it after a `[mejiro-watermark]` prefix, so a downstream renderer
   * can theme it by that prefix. An empty string adds nothing.
   */
  watermark?: string;
}

/** The paragraph the editor is editing: a chapter and one of its paragraph blocks. */
interface Selection {
  chapterIndex: number;
  blockId: string | null;
}

/** A ruby to add on commit, as a codepoint range into the proofread buffer. */
type PendingRuby = { start: number; end: number; rubyText: string };

/** Marker prefix a renderer can key off to style the watermark paragraph. */
const WATERMARK_PREFIX = '[mejiro-watermark]';

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

/** The paragraph block `blockId` of `chapter`, if it has one. */
function paragraphBlock(
  chapter: EditableEpubChapter | undefined,
  blockId: string | null,
): EditableParagraphBlock | undefined {
  if (!(chapter && blockId)) return undefined;
  const block = chapter.blocks.find((candidate) => candidate.id === blockId);
  return block?.kind === 'paragraph' ? block : undefined;
}

/** First paragraph block of `chapter`, as the selection a chapter opens on. */
function firstParagraphId(chapter: EditableEpubChapter | undefined): string | null {
  return chapter?.blocks.find((block) => block.kind === 'paragraph')?.id ?? null;
}

/**
 * Index of the preview paragraph block `blockId` lands on: the paragraphs
 * `editableEpubToEpubBook` derives from the blocks before it.
 */
function previewParagraphIndex(
  chapter: EditableEpubChapter | undefined,
  blockId: string | null,
): number {
  let index = 0;
  for (const block of chapter?.blocks ?? []) {
    if (block.id === blockId) break;
    if (block.kind === 'image' ? Boolean(block.caption) : block.text !== '') index++;
  }
  return index;
}

/**
 * Commits the editor's pending edit to one paragraph: the proofread buffer
 * first, re-anchoring existing annotations onto it, then `ruby` clamped onto
 * the committed text. A new ruby replaces only the ruby it overlaps. Returns
 * whether the document changed.
 */
function commitPendingEdit(
  editor: EditableEpub,
  selection: Selection,
  text: string,
  ruby?: PendingRuby,
): boolean {
  const { chapterIndex, blockId } = selection;
  const block = paragraphBlock(editor.epub.chapters[chapterIndex], blockId);
  if (!(block && blockId)) return false;
  const textChanged = text !== block.text;
  const rubyText = ruby?.rubyText.trim();
  const range = ruby ? clampRubyRange(ruby.start, ruby.end, [...text].length) : null;
  if (!(rubyText && range)) {
    if (textChanged) editor.updateParagraph(chapterIndex, blockId, { text });
    return textChanged;
  }
  editor.transaction(() => {
    if (textChanged) editor.updateParagraph(chapterIndex, blockId, { text });
    const committed =
      paragraphBlock(editor.epub.chapters[chapterIndex], blockId)?.inlineAnnotations ?? [];
    const newRuby: InlineAnnotation = {
      type: 'ruby',
      startIndex: range.start,
      endIndex: range.end,
      rubyText,
      rubyType: range.end - range.start === 1 ? 'mono' : 'group',
    };
    const inlineAnnotations = [
      ...committed.filter(
        (ann) => ann.type !== 'ruby' || ann.endIndex <= range.start || ann.startIndex >= range.end,
      ),
      newRuby,
    ].sort((a, b) => a.startIndex - b.startIndex);
    editor.updateParagraph(chapterIndex, blockId, { inlineAnnotations });
  });
  return true;
}

/**
 * Offers `bytes` as a browser download named `filename`. The object URL is
 * revoked on the next task, after the browser has started consuming it, and
 * exactly once even when `click()` throws.
 */
export function downloadEpub(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/epub+zip' }));
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

/** EPUB editor UI for proofreading, ruby edits, image insertion, and export. */
export function MejiroEditor({
  epubUrl,
  fetchOptions,
  fetchEpub,
  fonts,
  enableProofread = true,
  enableRuby = true,
  enableImages = true,
  showExportButton = true,
  exportPolicy,
  assetResolver,
  limits,
  previewProps,
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
  const [selection, setSelection] = useState<Selection>({ chapterIndex: 0, blockId: null });
  const [text, setText] = useState('');
  const [rubyStart, setRubyStart] = useState(0);
  const [rubyEnd, setRubyEnd] = useState(1);
  const [rubyText, setRubyText] = useState('');
  const request = useRequestToken();
  const abortRef = useRef<AbortController | null>(null);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  const fetchSourceRef = useRef({ fetchEpub, fetchOptions });
  fetchSourceRef.current = { fetchEpub, fetchOptions };

  const epub = editor?.epub ?? null;
  const chapter = epub?.chapters[selection.chapterIndex];
  const paragraph = paragraphBlock(chapter, selection.blockId) ?? null;
  // A scene break exports as a bare divider, so it carries no editable text.
  const sceneBreak = paragraph?.paragraphKind === 'sceneBreak';
  const rubyRange = clampRubyRange(rubyStart, rubyEnd, [...text].length);
  // Each copy is tagged with the loaded editor, so an edit is not a book swap to the reader.
  const previewEpub = useMemo(() => {
    void revision;
    return epub && editor ? markBookIdentity(editableEpubToEpubBook(epub), editor) : null;
  }, [epub, editor, revision]);

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

  /** Removes the error banner once a later operation has succeeded or started. */
  const clearError = useCallback(() => setError(null), []);

  /** Starts a load request, aborting the one in flight; returns its token and signal. */
  const beginLoad = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return { token: request.begin(), signal: controller.signal };
  }, [request]);

  // A load in flight at unmount is abandoned and its download stopped.
  useEffect(() => () => abortRef.current?.abort(), []);

  const loadBytesForRequest = useCallback(
    async (bytes: BinaryInput, token: number, signal: AbortSignal) => {
      setLoading(true);
      clearError();
      try {
        const next = await parseEditableEpub(bytes, { limits: limitsRef.current, signal });
        if (!request.isCurrent(token)) return;
        setEditor(next);
        setSelection({ chapterIndex: 0, blockId: firstParagraphId(next.epub.chapters[0]) });
        setRevision((value) => value + 1);
        onLoadRef.current?.(next);
      } catch (err) {
        if (request.isCurrent(token)) reportError(toError(err));
      } finally {
        if (request.isCurrent(token)) setLoading(false);
      }
    },
    [clearError, reportError, request],
  );

  async function loadFile(file: File): Promise<void> {
    const { token, signal } = beginLoad();
    setLoading(true);
    clearError();
    try {
      await loadBytesForRequest(await readEpubFile(file, limitsRef.current), token, signal);
    } catch (err) {
      if (request.isCurrent(token)) {
        reportError(toError(err));
        setLoading(false);
      }
    }
  }

  // A URL load still in flight when the URL changes or clears, or the editor
  // unmounts, is abandoned.
  useEffect(() => {
    if (!epubUrl) return;
    const { token, signal } = beginLoad();
    void (async () => {
      setLoading(true);
      clearError();
      try {
        const bytes = await fetchEpubBytes(epubUrl, fetchSourceRef.current, signal);
        if (!request.isCurrent(token)) return;
        await loadBytesForRequest(bytes, token, signal);
      } catch (err) {
        if (request.isCurrent(token)) reportError(toError(err));
      } finally {
        if (request.isCurrent(token)) setLoading(false);
      }
    })();
    return () => {
      if (!request.isCurrent(token)) return;
      request.invalidate();
      abortRef.current?.abort();
      setLoading(false);
    };
  }, [epubUrl, beginLoad, clearError, loadBytesForRequest, reportError, request]);

  // The proofread buffer resets only when the edit target moves. A document
  // regenerated under the same target (image insert, apply) keeps unapplied text.
  const syncedRef = useRef<{ editor: EditableEpub | null; target: string; text: string } | null>(
    null,
  );
  useEffect(() => {
    const nextText = paragraph?.text ?? '';
    const target = `${selection.chapterIndex}:${selection.blockId}`;
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
  }, [editor, selection.chapterIndex, selection.blockId, paragraph]);

  // Keep the preview on the selected paragraph, including after each edit
  // re-derives the preview book.
  useEffect(() => {
    if (!(previewEpub && epub)) return;
    void readerRef.current?.goToAnchor({
      chapterIndex: selection.chapterIndex,
      paragraphIndex: previewParagraphIndex(
        epub.chapters[selection.chapterIndex],
        selection.blockId,
      ),
      charIndex: 0,
    });
  }, [previewEpub, epub, selection.chapterIndex, selection.blockId]);

  /**
   * Moves the edit target. A pending proofread edit is committed before the
   * switch, so changing paragraphs never drops unsaved text.
   */
  function selectParagraph(chapterIndex: number, blockId: string | null): void {
    if (chapterIndex === selection.chapterIndex && blockId === selection.blockId) return;
    commitEdit();
    setSelection({ chapterIndex, blockId });
  }

  /** Moves the edit target to the first paragraph of another chapter. */
  function selectChapter(chapterIndex: number): void {
    if (chapterIndex === selection.chapterIndex) return;
    selectParagraph(chapterIndex, firstParagraphId(epub?.chapters[chapterIndex]));
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
    if (commitPendingEdit(editor, selection, text, ruby)) {
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
      const chapterIndex = selection.chapterIndex;
      const afterBlockId = selection.blockId ?? undefined;
      const data = await file.arrayBuffer();
      editor.addImage(chapterIndex, {
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        data,
        alt: file.name,
        afterBlockId,
      });
      setRevision((value) => value + 1);
      clearError();
    }, reportError);
  }

  async function exportEpub(): Promise<void> {
    await withErrorReporting(async () => {
      if (!editor) return;
      commitEdit();
      const options: EditableEpubExportOptions = {};
      if (assetResolver) options.assetResolver = assetResolver;
      if (exportPolicy?.watermark) {
        options.watermark = `${WATERMARK_PREFIX} ${exportPolicy.watermark}`;
      }
      let bytes = await editor.export(options);
      if (exportPolicy?.transform) bytes = await exportPolicy.transform(bytes);
      onExport?.(bytes);
      if (exportPolicy?.download !== false) {
        downloadEpub(bytes, `${editor.title || 'edited'}.epub`);
      }
      clearError();
    }, reportError);
  }

  // Shown by the Proofread section, or read-only in the Ruby section so a base range can still be selected.
  const paragraphText = (
    <textarea
      ref={textareaRef}
      value={text}
      readOnly={sceneBreak || !enableProofread}
      onChange={(event) => setText(event.target.value)}
      onSelect={captureRubyRange}
    />
  );

  return (
    <div className="mejiro-editor">
      <main className="mejiro-editor-preview">
        {previewEpub ? (
          <MejiroReader
            {...mergeDefined<ManuscriptPreviewProps>(
              {
                title: previewEpub.title,
                subtitle: messages.editorPreviewSubtitle,
                chapterNavMode: 'panel',
                enableSurfaceTap: false,
              },
              previewProps ?? {},
            )}
            ref={readerRef}
            epub={previewEpub}
            chapterIndex={selection.chapterIndex}
            onChapterIndexChange={selectChapter}
            onError={reportError}
            fonts={fonts}
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
        {epub && (
          <>
            <div className="mejiro-editor-section">
              <span className="mejiro-editor-label">{messages.editorParagraphs}</span>
              <div className="mejiro-editor-paragraphs">
                {epub.chapters.map((ch, ci) =>
                  ch.blocks
                    .filter((b) => b.kind === 'paragraph')
                    .map((block) => (
                      <button
                        type="button"
                        key={`${ch.href}-${block.id}`}
                        className={
                          selection.chapterIndex === ci && selection.blockId === block.id
                            ? 'is-active'
                            : ''
                        }
                        onClick={() => selectParagraph(ci, block.id)}
                      >
                        <span>{ch.title ?? formatMessage(messages.chapterN, { n: ci + 1 })}</span>
                        <strong>{block.text.slice(0, 42)}</strong>
                      </button>
                    )),
                )}
              </div>
            </div>
            {enableProofread && (
              <div className="mejiro-editor-section">
                <span className="mejiro-editor-label">{messages.editorProofread}</span>
                {paragraphText}
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
                {!enableProofread && paragraphText}
                <p className="mejiro-editor-range">
                  {formatMessage(messages.editorRubyRange, {
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
                    // Cleared so picking the same file again still fires `change`.
                    event.target.value = '';
                    if (file) void addImage(file);
                  }}
                />
              </div>
            )}
            {showExportButton && (
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
