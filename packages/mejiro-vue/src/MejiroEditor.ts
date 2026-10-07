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
import {
  computed,
  defineComponent,
  h,
  onMounted,
  type PropType,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { fetchEpubBuffer, readEpubFile, toError, withErrorReporting } from './errors.js';
import { format, useI18n } from './i18n.js';
import { MejiroDropZone } from './MejiroDropZone.js';
import { MejiroReader, type MejiroReaderHandle } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';

/**
 * EPUB editor UI for proofreading, ruby edits, image insertion, and export.
 * Emits `load`, `export`, and `error` (load, image-insert and export failures).
 */
export const MejiroEditor = defineComponent({
  name: 'MejiroEditor',
  props: {
    /** URL fetched and loaded on mount. */
    epubUrl: { type: String, default: undefined },
    /** Font choices passed to the preview reader. */
    fonts: { type: Array as PropType<FontChoice[]>, default: undefined },
    /**
     * Allow editing paragraph text (the "Proofread" section).
     * @defaultValue true
     */
    enableProofread: { type: Boolean, default: true },
    /**
     * Allow editing ruby annotations (the "Ruby" section).
     * @defaultValue true
     */
    enableRuby: { type: Boolean, default: true },
    /**
     * Allow inserting images into the EPUB (the "Images" section).
     * @defaultValue true
     */
    enableImages: { type: Boolean, default: true },
    /**
     * Allow exporting the edited EPUB. SaaS publishers can disable this to
     * restrict downloads (e.g. server-side export only).
     * @defaultValue true
     */
    enableExport: { type: Boolean, default: true },
    /**
     * Called before the export buffer is offered as a download. Return `false`
     * (or a `Promise<false>`) to suppress the browser download — useful for
     * uploading the buffer to a backend instead.
     */
    onBeforeExport: {
      type: Function as PropType<
        (buffer: ArrayBuffer) => boolean | undefined | Promise<boolean | undefined>
      >,
      default: undefined,
    },
    /**
     * Declarative export policy. When set, supersedes `onBeforeExport` for
     * download control and threads watermark / encrypt transforms through
     * the export pipeline.
     */
    exportPolicy: {
      type: Object as PropType<MejiroExportPolicy>,
      default: undefined,
    },
    /**
     * Resolves URL-only image assets ({@link EditableImageAsset.url} set,
     * `data` unset) into bytes at export time. Forwarded to `editor.export()`.
     */
    assetResolver: {
      type: Function as PropType<AssetResolver>,
      default: undefined,
    },
    /**
     * Archive resource limits applied while opening an EPUB. Raise them for
     * trusted, image-heavy books; tighten them for a public drop zone. Omitted
     * fields keep their `DEFAULT_EPUB_PARSE_LIMITS` value.
     */
    limits: {
      type: Object as PropType<Partial<EpubParseLimits>>,
      default: undefined,
    },
  },
  emits: ['load', 'export', 'error'],
  setup(props, { emit }) {
    const messages = useI18n();
    const imageInput = ref<HTMLInputElement | null>(null);
    const textareaEl = ref<HTMLTextAreaElement | null>(null);
    const readerEl = shallowRef<MejiroReaderHandle | null>(null);
    // The parsed EPUB is held shallowly (as in `useEditableEpub`): edits are
    // published through the `revision` counter below, so deep reactivity over
    // the whole document tree would be pure overhead.
    const editor = shallowRef<EditableEpub | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);
    const revision = ref(0);
    const chapterIndex = ref(0);
    const paragraphIndex = ref(0);
    const text = ref('');
    const rubyStart = ref(0);
    const rubyEnd = ref(1);
    const rubyText = ref('');
    let loadRequestId = 0;

    const book = computed(() => editor.value?.book ?? null);
    const chapter = computed(() => book.value?.chapters[chapterIndex.value] ?? null);
    const paragraph = computed(() => {
      // Editor commands replace the paragraph mirror, so the revision counter
      // is what re-evaluates this computed.
      void revision.value;
      return chapter.value?.paragraphs[paragraphIndex.value] ?? null;
    });
    // A scene break exports as a bare divider, so it carries no editable text.
    const sceneBreak = computed(() => {
      void revision.value;
      return chapter.value
        ? paragraphBlock(chapter.value, paragraphIndex.value)?.paragraphKind === 'sceneBreak'
        : false;
    });
    const rubyRange = computed(() =>
      clampRubyRange(rubyStart.value, rubyEnd.value, [...text.value].length),
    );
    const previewBook = computed(() => {
      void revision.value;
      return book.value ? cloneEditableEpubBook(book.value) : null;
    });

    /** Shows `nextError` in the editor and emits it as `error`. */
    function reportError(nextError: Error): void {
      error.value = nextError;
      emit('error', nextError);
    }

    async function loadBufferForRequest(buffer: ArrayBuffer, requestId: number): Promise<void> {
      loading.value = true;
      error.value = null;
      try {
        const next = await EditableEpub.load(buffer, { limits: props.limits });
        if (requestId !== loadRequestId) return;
        editor.value = next;
        chapterIndex.value = 0;
        paragraphIndex.value = 0;
        revision.value++;
        emit('load', next);
      } catch (err) {
        if (requestId === loadRequestId) reportError(toError(err));
      } finally {
        if (requestId === loadRequestId) loading.value = false;
      }
    }

    async function loadFile(file: File): Promise<void> {
      const requestId = ++loadRequestId;
      loading.value = true;
      error.value = null;
      try {
        await loadBufferForRequest(await readEpubFile(file, props.limits), requestId);
      } catch (err) {
        if (requestId === loadRequestId) {
          reportError(toError(err));
          loading.value = false;
        }
      }
    }

    // Deferred to mount so server-side setup never fetches.
    onMounted(() => {
      watch(
        () => props.epubUrl,
        (url, _previous, onCleanup) => {
          const requestId = ++loadRequestId;
          let cancelled = false;
          onCleanup(() => {
            cancelled = true;
          });
          if (!url) {
            loading.value = false;
            return;
          }
          void (async () => {
            loading.value = true;
            error.value = null;
            try {
              const buffer = await fetchEpubBuffer(url);
              if (cancelled || requestId !== loadRequestId) return;
              await loadBufferForRequest(buffer, requestId);
            } catch (err) {
              if (!cancelled && requestId === loadRequestId) reportError(toError(err));
            } finally {
              if (!cancelled && requestId === loadRequestId) loading.value = false;
            }
          })();
        },
        { immediate: true },
      );
    });

    // The proofread buffer resets only when the edit target moves. A document
    // regenerated under the same target (image insert, apply) keeps unapplied text.
    let synced: { editor: EditableEpub | null; target: string; text: string } | null = null;
    watch(
      [editor, chapterIndex, paragraphIndex, paragraph],
      () => {
        const nextText = paragraph.value?.text ?? '';
        const target = `${chapterIndex.value}:${paragraphIndex.value}`;
        const prev = synced;
        synced = { editor: editor.value, target, text: nextText };
        if (prev && prev.editor === editor.value && prev.target === target) {
          if (text.value === prev.text) text.value = nextText;
          return;
        }
        text.value = nextText;
        rubyStart.value = 0;
        rubyEnd.value = Math.min(1, [...nextText].length);
        rubyText.value = '';
      },
      { immediate: true },
    );

    // Keep the preview on the selected paragraph, including after each edit
    // re-clones the preview book.
    watch(
      [previewBook, chapterIndex, paragraphIndex, readerEl],
      () => {
        if (!previewBook.value) return;
        void readerEl.value?.goToAnchor({
          chapter: chapterIndex.value,
          paragraph: paragraphIndex.value,
          charIndex: 0,
        });
      },
      { flush: 'post' },
    );

    /**
     * Moves the edit target. A pending proofread edit is committed before the
     * switch, so changing paragraphs never drops unsaved text.
     */
    function selectParagraph(ci: number, pi: number): void {
      if (ci === chapterIndex.value && pi === paragraphIndex.value) return;
      commitEdit();
      chapterIndex.value = ci;
      paragraphIndex.value = pi;
    }

    /** Flushes the proofread buffer, plus `ruby` when given, into the document. */
    function commitEdit(ruby?: PendingRuby): void {
      if (!editor.value) return;
      if (
        commitPendingEdit(editor.value, chapterIndex.value, paragraphIndex.value, text.value, ruby)
      ) {
        revision.value++;
      }
    }

    function captureRubyRange(): void {
      const el = textareaEl.value;
      if (!el) return;
      const utf16Start = el.selectionStart ?? 0;
      const utf16End = el.selectionEnd ?? utf16Start;
      const start = utf16ToCodepoint(text.value, utf16Start);
      const end = utf16ToCodepoint(text.value, Math.max(utf16End, utf16Start + 1));
      rubyStart.value = start;
      rubyEnd.value = Math.max(start + 1, end);
    }

    function applyRuby(): void {
      if (!(rubyRange.value && rubyText.value.trim())) return;
      commitEdit({ start: rubyStart.value, end: rubyEnd.value, rubyText: rubyText.value });
      rubyText.value = '';
    }

    async function addImage(file: File): Promise<void> {
      await withErrorReporting(async () => {
        const target = editor.value;
        if (!(target && chapter.value)) return;
        const ci = chapterIndex.value;
        const afterBlockId = paragraphBlock(chapter.value, paragraphIndex.value)?.id;
        const data = await file.arrayBuffer();
        target.addImage(ci, {
          filename: file.name,
          mediaType: file.type || 'application/octet-stream',
          data,
          alt: file.name,
          afterBlockId,
        });
        revision.value++;
      }, reportError);
    }

    async function exportEpub(): Promise<void> {
      await withErrorReporting(async () => {
        const target = editor.value;
        if (!target) return;
        commitEdit();
        const policy = props.exportPolicy;
        const source = policy?.watermark
          ? watermarkedBook(target.book, policy.watermark)
          : target.book;
        const resolver = props.assetResolver;
        let buffer = await exportEditableEpub(
          source,
          resolver ? { assetResolver: resolver } : undefined,
        );
        if (policy?.encrypt) buffer = await policy.encrypt(buffer);
        const decision = await props.onBeforeExport?.(buffer);
        emit('export', buffer);
        // An export policy supersedes onBeforeExport for download control.
        const allowDownload = policy ? policy.allowDownload !== false : decision !== false;
        if (!allowDownload) return;
        downloadEpub(buffer, `${target.title || 'edited'}.epub`);
      }, reportError);
    }

    return () =>
      h('div', { class: 'mejiro-editor' }, [
        h('main', { class: 'mejiro-editor-preview' }, [
          previewBook.value
            ? h(MejiroReader, {
                ref: (el: unknown) => {
                  readerEl.value = el as MejiroReaderHandle | null;
                },
                epub: previewBook.value,
                chapter: chapterIndex.value,
                onChapterChange: (index: number) => selectParagraph(index, 0),
                fonts: props.fonts ?? undefined,
                subtitle: messages.value.editorPreviewSubtitle,
                chapterNavMode: 'panel',
                enableImageOverlay: false,
                enableSurfaceTap: false,
              })
            : h(MejiroDropZone, {
                onFile: (file: File) => void loadFile(file),
              }),
          loading.value
            ? h('div', { class: 'mejiro-editor-loading' }, messages.value.loading)
            : null,
          error.value ? h('div', { class: 'mejiro-editor-error' }, error.value.message) : null,
        ]),
        h('aside', { class: 'mejiro-editor-panel' }, [
          h('div', { class: 'mejiro-editor-head' }, [
            h('span', messages.value.editorTitle),
            h('strong', editor.value?.title ?? messages.value.editorNoBookLoaded),
            editor.value?.author ? h('small', editor.value.author) : null,
          ]),
          book.value ? renderControls() : null,
        ]),
      ]);

    function renderControls() {
      return [
        h('div', { class: 'mejiro-editor-section' }, [
          h('span', { class: 'mejiro-editor-label' }, messages.value.editorParagraphs),
          h(
            'div',
            { class: 'mejiro-editor-paragraphs' },
            book.value?.chapters.flatMap((ch, ci) =>
              ch.blocks
                .filter((b) => b.kind === 'paragraph')
                .map((block, pi) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      key: `${ch.href}-${block.id}`,
                      class: {
                        'is-active': chapterIndex.value === ci && paragraphIndex.value === pi,
                      },
                      onClick: () => selectParagraph(ci, pi),
                    },
                    [
                      h('span', ch.title ?? format(messages.value.chapterN, { n: ci + 1 })),
                      h('strong', block.text.slice(0, 42)),
                    ],
                  ),
                ),
            ),
          ),
        ]),
        props.enableProofread
          ? h('div', { class: 'mejiro-editor-section' }, [
              h('span', { class: 'mejiro-editor-label' }, messages.value.editorProofread),
              h('textarea', {
                ref: (el: unknown) => {
                  textareaEl.value = el as HTMLTextAreaElement | null;
                },
                value: text.value,
                readOnly: sceneBreak.value,
                onInput: (event: Event) => {
                  text.value = (event.target as HTMLTextAreaElement).value;
                },
                onSelect: captureRubyRange,
              }),
              h(
                'button',
                {
                  type: 'button',
                  class: 'mejiro-editor-primary',
                  disabled: sceneBreak.value,
                  onClick: () => commitEdit(),
                },
                messages.value.editorApplyText,
              ),
            ])
          : null,
        props.enableRuby
          ? h('div', { class: 'mejiro-editor-section' }, [
              h('span', { class: 'mejiro-editor-label' }, messages.value.editorRuby),
              h('p', { class: 'mejiro-editor-hint' }, messages.value.editorRubyHint),
              h(
                'p',
                { class: 'mejiro-editor-range' },
                format(messages.value.editorRubyRange, {
                  start: rubyRange.value?.start ?? 0,
                  end: rubyRange.value?.end ?? 0,
                  count: rubyRange.value ? rubyRange.value.end - rubyRange.value.start : 0,
                }),
              ),
              h('input', {
                value: rubyText.value,
                placeholder: messages.value.editorRubyPlaceholder,
                onInput: (event: Event) => {
                  rubyText.value = (event.target as HTMLInputElement).value;
                },
              }),
              h(
                'button',
                {
                  type: 'button',
                  class: 'mejiro-editor-primary',
                  disabled: !(rubyRange.value && rubyText.value.trim()),
                  onClick: applyRuby,
                },
                messages.value.editorApplyRuby,
              ),
            ])
          : null,
        props.enableImages
          ? h('div', { class: 'mejiro-editor-section' }, [
              h('span', { class: 'mejiro-editor-label' }, messages.value.editorImages),
              h(
                'button',
                { type: 'button', onClick: () => imageInput.value?.click() },
                messages.value.editorInsertImageAfterParagraph,
              ),
              h('input', {
                ref: imageInput,
                type: 'file',
                accept: 'image/*',
                hidden: true,
                onChange: (event: Event) => {
                  const target = event.target as HTMLInputElement;
                  const file = target.files?.[0];
                  // Cleared so picking the same file again still fires `change`.
                  target.value = '';
                  if (file) void addImage(file);
                },
              }),
            ])
          : null,
        props.enableExport
          ? h(
              'button',
              { type: 'button', class: 'mejiro-editor-export', onClick: () => void exportEpub() },
              messages.value.editorExportEpub,
            )
          : null,
      ];
    }
  },
});

/** Props accepted by {@link MejiroEditor}. */
export type MejiroEditorProps = InstanceType<typeof MejiroEditor>['$props'];

/**
 * Declarative restrictions on the export pipeline. Mejiro applies the
 * transforms in this order: `watermark` (applied to an export-only copy of the
 * book, never to the edited document) → `encrypt` (replaces the buffer with the
 * result) → `allowDownload` (skips the browser download when `false`).
 */
export interface MejiroExportPolicy {
  /**
   * If `false`, the EPUB buffer is still produced (and the `export` event
   * still fires) but no browser download is triggered. Use when shipping the
   * buffer elsewhere (e.g. uploading to a backend).
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
