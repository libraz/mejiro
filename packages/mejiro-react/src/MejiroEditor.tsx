import type { InlineAnnotation } from '@libraz/mejiro/browser';
import { type AssetResolver, EditableEpub, type EditableEpubBook } from '@libraz/mejiro/epub';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { format, useI18n } from './i18n.js';
import { MejiroDropZone } from './MejiroDropZone.js';
import { MejiroReader } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';

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
  /** Called after an EPUB is loaded into the editor. */
  onLoad?: (editor: EditableEpub) => void;
  /** Called after export completes. */
  onExport?: (buffer: ArrayBuffer) => void;
  /** Called when loading or parsing an EPUB fails. */
  onError?: (error: Error) => void;
}

/**
 * Declarative restrictions on the export pipeline. Mejiro applies the
 * transforms in this order: `watermark` (modifies the EPUB in-place) →
 * `encrypt` (replaces the buffer with the result) → `allowDownload` (skips
 * the browser download when `false`).
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
   * Embeds a visible watermark string into the EPUB. Implemented by writing
   * the text as XHTML metadata; renderers may surface it differently.
   */
  watermark?: { text: string; opacity?: number };
}

type Selection = {
  chapter: number;
  paragraph: number;
};

function cloneBook(book: EditableEpubBook): EditableEpubBook {
  return {
    ...book,
    chapters: book.chapters.map((chapter) => ({
      ...chapter,
      blocks: chapter.blocks.map((block) =>
        block.kind === 'paragraph'
          ? { ...block, inlineAnnotations: [...block.inlineAnnotations] }
          : { ...block },
      ),
      imageAssets: new Map(chapter.imageAssets),
      originalImageHrefs: chapter.originalImageHrefs ? [...chapter.originalImageHrefs] : undefined,
      paragraphs: chapter.paragraphs.map((paragraph) => ({
        ...paragraph,
        inlineAnnotations: [...paragraph.inlineAnnotations],
      })),
      paragraphRefs: chapter.paragraphRefs ? [...chapter.paragraphRefs] : undefined,
    })),
    packageData: {
      ...book.packageData,
      files: new Map(book.packageData.files),
    },
  };
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

/**
 * Inserts a watermark paragraph at the top of every chapter. The marker is a
 * `[mejiro-watermark]` block so a downstream renderer can theme it; opacity
 * is left to the consumer's CSS.
 */
function applyWatermark(editor: EditableEpub, watermark: { text: string; opacity?: number }): void {
  editor.transaction(() => {
    for (let i = 0; i < editor.chapters.length; i++) {
      editor.insertParagraph(i, 0, {
        text: `[mejiro-watermark] ${watermark.text}`,
        inlineAnnotations: [],
      });
    }
  });
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
  onLoad,
  onExport,
  onError,
}: MejiroEditorProps): ReactNode {
  const messages = useI18n();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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

  const book = editor?.book ?? null;
  const chapter = book?.chapters[selection.chapter] ?? null;
  const paragraph = chapter?.paragraphs[selection.paragraph] ?? null;
  const previewBook = book ? cloneBook(book) : null;
  void revision;

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const loadBufferForRequest = useCallback(async (buffer: ArrayBuffer, requestId: number) => {
    setLoading(true);
    setError(null);
    try {
      const next = await EditableEpub.load(buffer);
      if (requestId !== loadRequestIdRef.current) return;
      setEditor(next);
      setSelection({ chapter: 0, paragraph: 0 });
      setRevision((value) => value + 1);
      onLoadRef.current?.(next);
    } catch (err) {
      if (requestId === loadRequestIdRef.current) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        onErrorRef.current?.(nextError);
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, []);

  async function loadFile(file: File): Promise<void> {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await loadBufferForRequest(await file.arrayBuffer(), requestId);
    } catch (err) {
      if (requestId === loadRequestIdRef.current) {
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        onErrorRef.current?.(nextError);
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
        const res = await fetch(epubUrl);
        if (!res.ok) throw new Error(`Failed to load EPUB: ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (cancelled || requestId !== loadRequestIdRef.current) return;
        await loadBufferForRequest(buffer, requestId);
      } catch (err) {
        if (!cancelled && requestId === loadRequestIdRef.current) {
          const nextError = err instanceof Error ? err : new Error(String(err));
          setError(nextError);
          onErrorRef.current?.(nextError);
        }
      } finally {
        if (!cancelled && requestId === loadRequestIdRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [epubUrl, loadBufferForRequest]);

  useEffect(() => {
    setText(paragraph?.text ?? '');
    setRubyStart(0);
    setRubyEnd(Math.min(1, [...(paragraph?.text ?? '')].length));
    setRubyText('');
  }, [paragraph]);

  function selectParagraph(chapterIndex: number, paragraphIndex: number): void {
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

  function applyText(): void {
    if (!editor) return;
    editor.updateParagraph(selection.chapter, selection.paragraph, { text });
    setRevision((value) => value + 1);
  }

  function applyRuby(): void {
    if (!(editor && paragraph && rubyText.trim())) return;
    const len = [...text].length;
    const start = Math.max(0, Math.min(rubyStart, len));
    const end = Math.max(start + 1, Math.min(rubyEnd, len));
    const newRuby: InlineAnnotation = {
      kind: 'ruby',
      startIndex: start,
      endIndex: end,
      rubyText: rubyText.trim(),
      type: end - start === 1 ? 'mono' : 'group',
    };
    const nextInline: InlineAnnotation[] = [
      ...paragraph.inlineAnnotations.filter(
        (ann) => ann.endIndex <= start || ann.startIndex >= end,
      ),
      newRuby,
    ].sort((a, b) => a.startIndex - b.startIndex);
    editor.updateParagraph(selection.chapter, selection.paragraph, {
      text,
      inlineAnnotations: nextInline,
    });
    setRubyText('');
    setRevision((value) => value + 1);
  }

  async function addImage(file: File): Promise<void> {
    if (!(editor && chapter)) return;
    editor.addImage(selection.chapter, {
      filename: file.name,
      mediaType: file.type || 'application/octet-stream',
      data: await file.arrayBuffer(),
      alt: file.name,
      afterBlockId: paragraphBlockId(chapter, selection.paragraph),
    });
    setRevision((value) => value + 1);
  }

  async function exportEpub(): Promise<void> {
    if (!editor) return;
    if (exportPolicy?.watermark) applyWatermark(editor, exportPolicy.watermark);
    let buffer = await editor.export(assetResolver ? { assetResolver } : undefined);
    if (exportPolicy?.encrypt) buffer = await exportPolicy.encrypt(buffer);
    const decision = await onBeforeExport?.(buffer);
    onExport?.(buffer);
    if (decision === false) return;
    if (exportPolicy?.allowDownload === false) return;
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/epub+zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editor.title || 'edited'}.epub`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mejiro-editor">
      <main className="mejiro-editor-preview">
        {previewBook ? (
          <MejiroReader
            epub={previewBook}
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
                  onChange={(event) => setText(event.target.value)}
                  onSelect={captureRubyRange}
                />
                <button type="button" className="mejiro-editor-primary" onClick={applyText}>
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
                    start: rubyStart,
                    end: rubyEnd,
                    count: Math.max(0, rubyEnd - rubyStart),
                  })}
                </p>
                <input
                  value={rubyText}
                  placeholder={messages.editorRubyPlaceholder}
                  onChange={(event) => setRubyText(event.target.value)}
                />
                <button type="button" className="mejiro-editor-primary" onClick={applyRuby}>
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

function paragraphBlockId(
  chapter: EditableEpubBook['chapters'][number],
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
