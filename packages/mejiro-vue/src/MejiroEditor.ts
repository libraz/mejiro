import type { InlineAnnotation } from '@libraz/mejiro/browser';
import {
  type AssetResolver,
  cloneEditableEpubBook,
  EditableEpub,
  type EditableEpubBook,
  type EpubParseLimits,
  exportEditableEpub,
} from '@libraz/mejiro/epub';
import { computed, defineComponent, h, type PropType, ref, shallowRef, watch } from 'vue';
import { format, useI18n } from './i18n.js';
import { MejiroDropZone } from './MejiroDropZone.js';
import { MejiroReader } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';

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
    const textDirty = computed(() =>
      paragraph.value ? text.value !== paragraph.value.text : false,
    );
    const previewBook = computed(() => {
      void revision.value;
      return book.value ? cloneEditableEpubBook(book.value) : null;
    });

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
        if (requestId === loadRequestId) {
          error.value = err instanceof Error ? err : new Error(String(err));
          emit('error', error.value);
        }
      } finally {
        if (requestId === loadRequestId) loading.value = false;
      }
    }

    async function loadFile(file: File): Promise<void> {
      const requestId = ++loadRequestId;
      loading.value = true;
      error.value = null;
      try {
        await loadBufferForRequest(await file.arrayBuffer(), requestId);
      } catch (err) {
        if (requestId === loadRequestId) {
          error.value = err instanceof Error ? err : new Error(String(err));
          emit('error', error.value);
          loading.value = false;
        }
      }
    }

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
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to load EPUB: ${res.status}`);
            const buffer = await res.arrayBuffer();
            if (cancelled || requestId !== loadRequestId) return;
            await loadBufferForRequest(buffer, requestId);
          } catch (err) {
            if (!cancelled && requestId === loadRequestId) {
              error.value = err instanceof Error ? err : new Error(String(err));
              emit('error', error.value);
            }
          } finally {
            if (!cancelled && requestId === loadRequestId) loading.value = false;
          }
        })();
      },
      { immediate: true },
    );

    watch(
      paragraph,
      (next) => {
        text.value = next?.text ?? '';
        rubyStart.value = 0;
        rubyEnd.value = Math.min(1, [...(next?.text ?? '')].length);
        rubyText.value = '';
      },
      { immediate: true },
    );

    /**
     * Moves the edit target. A pending proofread edit is committed before the
     * switch, so changing paragraphs never drops unsaved text.
     */
    function selectParagraph(ci: number, pi: number): void {
      if (ci === chapterIndex.value && pi === paragraphIndex.value) return;
      if (textDirty.value) applyText();
      chapterIndex.value = ci;
      paragraphIndex.value = pi;
    }

    function applyText(): void {
      if (!editor.value) return;
      editor.value.updateParagraph(chapterIndex.value, paragraphIndex.value, { text: text.value });
      revision.value++;
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
      // Ruby offsets are computed against the proofread buffer, so they may only
      // be committed while that buffer still matches the saved paragraph text.
      if (!(editor.value && paragraph.value && rubyText.value.trim()) || textDirty.value) return;
      const len = [...text.value].length;
      const start = Math.max(0, Math.min(rubyStart.value, len));
      const end = Math.max(start + 1, Math.min(rubyEnd.value, len));
      const newRuby: InlineAnnotation = {
        kind: 'ruby',
        startIndex: start,
        endIndex: end,
        rubyText: rubyText.value.trim(),
        type: end - start === 1 ? 'mono' : 'group',
      };
      const nextInline: InlineAnnotation[] = [
        ...paragraph.value.inlineAnnotations.filter(
          (ann) => ann.endIndex <= start || ann.startIndex >= end,
        ),
        newRuby,
      ].sort((a, b) => a.startIndex - b.startIndex);
      editor.value.updateParagraph(chapterIndex.value, paragraphIndex.value, {
        text: text.value,
        inlineAnnotations: nextInline,
      });
      rubyText.value = '';
      revision.value++;
    }

    async function addImage(file: File): Promise<void> {
      if (!(editor.value && chapter.value)) return;
      editor.value.addImage(chapterIndex.value, {
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        data: await file.arrayBuffer(),
        alt: file.name,
        afterBlockId: paragraphBlockId(chapter.value, paragraphIndex.value),
      });
      revision.value++;
    }

    async function exportEpub(): Promise<void> {
      if (!editor.value) return;
      const policy = props.exportPolicy;
      const book = (editor.value as EditableEpub).book;
      const source = policy?.watermark ? watermarkedBook(book, policy.watermark) : book;
      const resolver = props.assetResolver;
      let buffer = await exportEditableEpub(
        source,
        resolver ? { assetResolver: resolver } : undefined,
      );
      if (policy?.encrypt) buffer = await policy.encrypt(buffer);
      const decision = await props.onBeforeExport?.(buffer);
      emit('export', buffer);
      if (decision === false) return;
      if (policy?.allowDownload === false) return;
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/epub+zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${editor.value.title || 'edited'}.epub`;
      a.click();
      URL.revokeObjectURL(url);
    }

    return () =>
      h('div', { class: 'mejiro-editor' }, [
        h('main', { class: 'mejiro-editor-preview' }, [
          previewBook.value
            ? h(MejiroReader, {
                epub: previewBook.value,
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
                onInput: (event: Event) => {
                  text.value = (event.target as HTMLTextAreaElement).value;
                },
                onSelect: captureRubyRange,
              }),
              h(
                'button',
                { type: 'button', class: 'mejiro-editor-primary', onClick: applyText },
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
                  start: rubyStart.value,
                  end: rubyEnd.value,
                  count: Math.max(0, rubyEnd.value - rubyStart.value),
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
                  disabled: textDirty.value || !rubyText.value.trim(),
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
                  const file = (event.target as HTMLInputElement).files?.[0];
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
