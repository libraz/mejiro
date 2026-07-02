import { type AssetResolver, EpubProject } from '@libraz/mejiro/epub';
import { computed, defineComponent, h, type PropType, ref, watch } from 'vue';
import type { MejiroMessages } from './i18n.js';
import { format, useI18n } from './i18n.js';
import { MejiroReader } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';
import { useManuscriptDraft } from './useManuscriptDraft.js';

export interface ManuscriptEditorChapter {
  id: string;
  title: string;
  body: string;
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
  /**
   * Toggle the surface-tap chrome-hide behavior of the embedded reader.
   * Defaults to `false` here (the editor's preview is part of a side-by-side
   * authoring workflow where tap-to-hide would surprise the author). Set
   * to `true` to demo the fullscreen-reader behavior.
   */
  enableSurfaceTap?: boolean;
  bare?: boolean;
}

export const MejiroManuscriptEditor = defineComponent({
  name: 'MejiroManuscriptEditor',
  props: {
    fonts: { type: Array as PropType<FontChoice[]>, default: undefined },
    /**
     * Title. When `onUpdate:title` is listened to (`v-model:title="…"`),
     * this is the controlled value. Otherwise it is the initial value and
     * the editor manages its own title state.
     */
    title: { type: String, default: undefined },
    /**
     * Author. Controlled via `v-model:author="…"`; otherwise treated as
     * the initial value.
     */
    author: { type: String, default: undefined },
    /**
     * Cover image. Controlled via `v-model:cover="…"`; otherwise treated
     * as the initial cover. Setting `null` clears the cover.
     */
    cover: { type: Object as PropType<File | null>, default: null },
    chapters: { type: Array as PropType<ManuscriptEditorChapter[]>, default: undefined },
    /**
     * Called whenever the chapter draft settles (debounced by `autosaveDelay`).
     * Use to persist drafts to localStorage, IndexedDB, or upload to a server.
     */
    onAutosave: {
      type: Function as PropType<(chapters: ManuscriptEditorChapter[]) => void | Promise<void>>,
      default: undefined,
    },
    /** Autosave debounce in milliseconds. @defaultValue 800 */
    autosaveDelay: { type: Number, default: undefined },
    /**
     * Props forwarded to the embedded {@link MejiroReader} preview. Lets
     * hosts customize subtitle / chapterNavMode / etc.; `manuscript`, `fonts`,
     * `chapter`, and `onChapterChange` remain driven by the editor.
     */
    previewProps: {
      type: Object as PropType<ManuscriptPreviewProps>,
      default: undefined,
    },
    /**
     * Resolves URL-only project assets (cover / illustration registered as
     * `{ url, ... }`) into bytes at export time. Forwarded to
     * `project.export()`.
     */
    assetResolver: {
      type: Function as PropType<AssetResolver>,
      default: undefined,
    },
  },
  emits: {
    export: (_buffer: ArrayBuffer) => true,
    'update:title': (_next: string) => true,
    'update:author': (_next: string) => true,
    'update:cover': (_next: File | null) => true,
  },
  setup(props, { emit }) {
    const messages = useI18n();
    const coverInput = ref<HTMLInputElement | null>(null);
    const title = ref(props.title ?? messages.value.manuscriptDefaultTitle);
    const author = ref(props.author ?? '');
    const cover = ref<File | null>(props.cover ?? null);
    const bodyTextareaRef = ref<HTMLTextAreaElement | null>(null);

    // Sync internal refs when the parent updates the prop — covers both
    // uncontrolled (parent occasionally resets) and controlled (v-model).
    watch(
      () => props.title,
      (next) => {
        if (next !== undefined) title.value = next;
      },
    );
    watch(
      () => props.author,
      (next) => {
        if (next !== undefined) author.value = next;
      },
    );
    watch(
      () => props.cover,
      (next) => {
        cover.value = next;
      },
    );

    function setTitle(next: string): void {
      title.value = next;
      emit('update:title', next);
    }
    function setAuthor(next: string): void {
      author.value = next;
      emit('update:author', next);
    }
    function setCover(next: File | null): void {
      cover.value = next;
      emit('update:cover', next);
    }

    const draft = useManuscriptDraft({
      initialChapters: props.chapters?.length
        ? [...props.chapters]
        : [defaultChapter(messages.value)],
      onAutosave: props.onAutosave,
      autosaveDelay: props.autosaveDelay,
      defaultChapterTitle: (index) =>
        format(messages.value.manuscriptDefaultChapterTitle, { n: index + 1 }),
    });
    const chapters = draft.chapters;
    const selected = draft.selected;
    const draggingIndex = ref<number | null>(null);
    const current = computed(() => chapters.value[selected.value] ?? chapters.value[0]);
    const manuscript = computed(() =>
      chapters.value.map((chapter) => ({
        id: chapter.id,
        title: chapter.title || messages.value.untitled,
        body: chapter.body,
      })),
    );

    function wrapSelection(open: string, close: string): void {
      const el = bodyTextareaRef.value;
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const before = el.value.slice(0, start);
      const middle = el.value.slice(start, end);
      const after = el.value.slice(end);
      draft.patchChapter(selected.value, {
        body: `${before}${open}${middle}${close}${after}`,
      });
      requestAnimationFrame(() => {
        const target = bodyTextareaRef.value;
        if (!target) return;
        target.focus();
        target.setSelectionRange(start + open.length, start + open.length + middle.length);
      });
    }

    async function exportEpub(): Promise<void> {
      const project = EpubProject.fromManuscript({
        metadata: { title: title.value, author: author.value || undefined },
        chapters: chapters.value.map((chapter) => ({
          id: chapter.id,
          title: chapter.title || messages.value.untitled,
          body: chapter.body,
        })),
      });
      if (cover.value) {
        project.setCover({
          href: coverAssetHref(cover.value),
          mediaType: cover.value.type || undefined,
          data: await cover.value.arrayBuffer(),
        });
      }
      const resolver = props.assetResolver;
      const buffer = await project.export(resolver ? { assetResolver: resolver } : undefined);
      emit('export', buffer);
      downloadEpub(buffer, title.value);
    }

    return () =>
      h('div', { class: 'mejiro-editor mejiro-manuscript-editor' }, [
        h('main', { class: 'mejiro-editor-preview' }, [
          h(MejiroReader, {
            subtitle: messages.value.manuscriptPreviewSubtitle,
            chapterNavMode: 'panel',
            enableSurfaceTap: false,
            ...(props.previewProps ?? {}),
            // Editor-driven, always overrides any previewProps.
            manuscript: manuscript.value,
            fonts: props.fonts ?? undefined,
            chapter: selected.value,
            'onChapter-change': draft.setSelected,
            enableImageOverlay: false,
          }),
        ]),
        h('aside', { class: 'mejiro-editor-panel' }, [
          h('div', { class: 'mejiro-editor-head' }, [
            h('span', messages.value.manuscriptTitle),
            h('strong', title.value),
            h('small', messages.value.manuscriptRubyHint),
          ]),
          h('div', { class: 'mejiro-editor-section' }, [
            h('span', { class: 'mejiro-editor-label' }, messages.value.manuscriptMetadata),
            h('input', {
              value: title.value,
              onInput: (event: Event) => {
                setTitle((event.target as HTMLInputElement).value);
              },
            }),
            h('input', {
              value: author.value,
              onInput: (event: Event) => {
                setAuthor((event.target as HTMLInputElement).value);
              },
            }),
            h(
              'button',
              { type: 'button', onClick: () => coverInput.value?.click() },
              cover.value ? cover.value.name : messages.value.manuscriptChooseCoverImage,
            ),
            h('input', {
              ref: coverInput,
              type: 'file',
              accept: 'image/*',
              hidden: true,
              onChange: (event: Event) => {
                setCover((event.target as HTMLInputElement).files?.[0] ?? null);
              },
            }),
          ]),
          h('div', { class: 'mejiro-editor-section' }, [
            h('span', { class: 'mejiro-editor-label' }, messages.value.manuscriptChapters),
            h(
              'div',
              { class: 'mejiro-editor-paragraphs' },
              chapters.value.map((chapter, index) =>
                h(
                  'button',
                  {
                    type: 'button',
                    key: chapter.id,
                    class: { 'is-active': selected.value === index },
                    draggable: true,
                    'aria-label': format(messages.value.manuscriptReorderHandle, {
                      title: chapter.title || messages.value.untitled,
                    }),
                    'data-dragging': draggingIndex.value === index ? '' : undefined,
                    onClick: () => draft.setSelected(index),
                    onDragstart: (event: DragEvent) => {
                      draggingIndex.value = index;
                      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                    },
                    onDragend: () => {
                      draggingIndex.value = null;
                    },
                    onDragover: (event: DragEvent) => {
                      if (draggingIndex.value === null || draggingIndex.value === index) return;
                      event.preventDefault();
                      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                    },
                    onDrop: (event: DragEvent) => {
                      event.preventDefault();
                      if (draggingIndex.value !== null && draggingIndex.value !== index) {
                        draft.reorderChapters(draggingIndex.value, index);
                      }
                      draggingIndex.value = null;
                    },
                  },
                  [
                    h('span', format(messages.value.chapterN, { n: index + 1 })),
                    h('strong', chapter.title || messages.value.untitled),
                  ],
                ),
              ),
            ),
            h('div', { class: 'mejiro-editor-grid' }, [
              h(
                'button',
                {
                  type: 'button',
                  onClick: () =>
                    draft.addChapter({
                      title: format(messages.value.manuscriptDefaultChapterTitle, {
                        n: chapters.value.length + 1,
                      }),
                    }),
                },
                messages.value.manuscriptAddChapter,
              ),
              h(
                'button',
                { type: 'button', onClick: () => draft.removeChapter(selected.value) },
                messages.value.manuscriptRemove,
              ),
            ]),
          ]),
          current.value
            ? h('div', { class: 'mejiro-editor-section' }, [
                h('span', { class: 'mejiro-editor-label' }, messages.value.manuscriptDraft),
                h('input', {
                  value: current.value.title,
                  onInput: (event: Event) => {
                    draft.patchChapter(selected.value, {
                      title: (event.target as HTMLInputElement).value,
                    });
                  },
                }),
                h('div', { class: 'mejiro-editor-grid mejiro-editor-notation' }, [
                  h(
                    'button',
                    { type: 'button', onClick: () => wrapSelection('《《', '》》') },
                    messages.value.manuscriptEmphasisDots,
                  ),
                  h(
                    'button',
                    { type: 'button', onClick: () => wrapSelection('〔', '〕') },
                    messages.value.manuscriptTcy,
                  ),
                  h(
                    'button',
                    { type: 'button', onClick: () => wrapSelection('*', '*') },
                    messages.value.manuscriptEm,
                  ),
                  h(
                    'button',
                    { type: 'button', onClick: () => wrapSelection('**', '**') },
                    messages.value.manuscriptStrong,
                  ),
                ]),
                h('textarea', {
                  ref: (el: unknown) => {
                    bodyTextareaRef.value = el as HTMLTextAreaElement | null;
                  },
                  class: 'mejiro-editor-manuscript',
                  value: current.value.body,
                  onInput: (event: Event) => {
                    draft.patchChapter(selected.value, {
                      body: (event.target as HTMLTextAreaElement).value,
                    });
                  },
                }),
              ])
            : null,
          h(
            'button',
            { type: 'button', class: 'mejiro-editor-export', onClick: () => void exportEpub() },
            messages.value.editorExportEpub,
          ),
        ]),
      ]);
  },
});

export type MejiroManuscriptEditorProps = InstanceType<typeof MejiroManuscriptEditor>['$props'];

function defaultChapter(messages: MejiroMessages): ManuscriptEditorChapter {
  return {
    id: `chapter-${Date.now()}-0`,
    title: format(messages.manuscriptDefaultChapterTitle, { n: 1 }),
    body: messages.manuscriptDefaultBody,
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
