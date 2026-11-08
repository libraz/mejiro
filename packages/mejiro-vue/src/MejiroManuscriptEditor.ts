import type { ManuscriptChapter } from '@libraz/mejiro';
import { type AssetResolver, EpubProject, type ManuscriptDialect } from '@libraz/mejiro/epub';
import {
  type ComponentPublicInstance,
  computed,
  defineComponent,
  getCurrentInstance,
  h,
  nextTick,
  type PropType,
  ref,
  watch,
} from 'vue';
import { withErrorReporting } from './errors.js';
import type { MejiroMessages } from './i18n.js';
import { formatMessage, useI18n } from './i18n.js';
import { downloadEpub } from './MejiroEditor.js';
import { MejiroNotationHighlighter } from './MejiroNotationHighlighter.js';
import { MejiroReader, type MejiroReaderCommonProps } from './MejiroReader.js';
import type { FontChoice } from './MejiroSettingsPanel.js';
import { mergeDefined } from './persistence.js';
import { createPackageIdentifier } from './useEpubProject.js';
import { useManuscriptDraft } from './useManuscriptDraft.js';

/** Autosave payload emitted by {@link MejiroManuscriptEditor}. */
export interface ManuscriptAutosaveDraft {
  /** Book title as currently entered. */
  readonly title: string;
  /** Author name as currently entered. */
  readonly author: string;
  /** Selected cover image, or `null` when none is set. */
  readonly cover: File | null;
  /** Chapters in reading order, as plain (non-reactive) copies. */
  readonly chapters: readonly ManuscriptChapter[];
}

/**
 * Props of the embedded {@link MejiroReader} preview that the editors pass
 * through (`previewProps` on {@link MejiroManuscriptEditor} and `MejiroEditor`).
 * The book, the chapter and the fonts stay driven by the editor.
 */
export type ManuscriptPreviewProps = Pick<
  MejiroReaderCommonProps,
  | 'title'
  | 'subtitle'
  | 'theme'
  | 'options'
  | 'pageGeometry'
  | 'mode'
  | 'spreadMode'
  | 'fit'
  | 'chapterNavMode'
  | 'pageNumbers'
  | 'showSettings'
  | 'showStats'
  | 'showPageIndicator'
  | 'enableKeyboard'
  | 'enableSurfaceTap'
>;

/** Chapter content compared by value: ids, titles and bodies in order. */
function chaptersKey(chapters: readonly ManuscriptChapter[] | undefined): string | undefined {
  if (chapters === undefined) return undefined;
  return JSON.stringify(chapters.map(({ id, title, body }) => [id ?? null, title, body]));
}

/** Manuscript-to-EPUB editor for author drafts from posting sites. */
export const MejiroManuscriptEditor = defineComponent({
  name: 'MejiroManuscriptEditor',
  props: {
    /** Font choices passed to the preview reader. */
    fonts: { type: Array as PropType<readonly FontChoice[]>, default: undefined },
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
    /**
     * Chapters. Controlled via `v-model:chapters="…"`; otherwise treated as
     * the initial chapters, and a later change replaces the draft.
     */
    chapters: { type: Array as PropType<readonly ManuscriptChapter[]>, default: undefined },
    /**
     * Manuscript notation dialect. Drives the notation highlighter, the live
     * preview, and the exported EPUB alike, so the whole editor interprets one
     * dialect. @defaultValue `'mejiro'`
     */
    dialect: { type: String as PropType<ManuscriptDialect>, default: 'mejiro' },
    /**
     * Called whenever the draft settles (debounced by `autosaveDebounceMs`).
     * Use to persist drafts to localStorage, IndexedDB, or upload to a server.
     */
    onAutosave: {
      type: Function as PropType<(draft: ManuscriptAutosaveDraft) => void | Promise<void>>,
      default: undefined,
    },
    /** Autosave debounce in milliseconds. @defaultValue 800 */
    autosaveDebounceMs: { type: Number, default: undefined },
    /**
     * Props forwarded to the embedded {@link MejiroReader} preview. The
     * manuscript, the chapter and the fonts stay driven by the editor.
     */
    previewProps: {
      type: Object as PropType<ManuscriptPreviewProps>,
      default: undefined,
    },
    /**
     * Resolver for URL-only assets, forwarded to `project.export()`. This
     * editor owns a `File` cover and manuscript text only, and embeds the
     * cover bytes itself, so nothing it registers is URL-only — build the
     * project through `useEpubProject` (`setCover` / `setAssets`) to author
     * `{ url }` asset references that must be fetched at export time.
     */
    assetResolver: {
      type: Function as PropType<AssetResolver>,
      default: undefined,
    },
    /**
     * Which side of the editor the manuscript panel sits on. `'right'` (the
     * default) puts the preview on the left; `'left'` mirrors the layout.
     * @defaultValue 'right'
     */
    panelSide: { type: String as PropType<'left' | 'right'>, default: 'right' },
  },
  emits: {
    /** An export completed; carries the EPUB bytes. */
    export: (_bytes: Uint8Array<ArrayBuffer>) => true,
    /** An export or the preview failed. */
    error: (_error: Error) => true,
    /** The title was edited. */
    'update:title': (_title: string) => true,
    /** The author was edited. */
    'update:author': (_author: string) => true,
    /** A cover was picked or cleared. */
    'update:cover': (_cover: File | null) => true,
    /** The chapters were edited, added, removed or reordered. */
    'update:chapters': (_chapters: readonly ManuscriptChapter[]) => true,
  },
  setup(props, { emit, slots }) {
    const messages = useI18n();
    const instance = getCurrentInstance();
    const coverInput = ref<HTMLInputElement | null>(null);
    const titleState = ref(props.title ?? messages.value.manuscriptDefaultTitle);
    const authorState = ref(props.author ?? '');
    const coverState = ref<File | null>(props.cover ?? null);
    const highlighterRef = ref<ComponentPublicInstance | null>(null);

    /**
     * A field is controlled when the parent listens to its `update:` event
     * (`v-model:title="…"`). Declared emits are stripped from `attrs`, so the
     * raw vnode props are the only place the listener is observable.
     */
    function isControlled(event: string): boolean {
      return Boolean(instance?.vnode.props?.[event]);
    }

    // In controlled mode the rendered value is a pure function of the prop, so
    // a parent that rejects an edit keeps the input showing its own truth.
    const title = computed(() =>
      isControlled('onUpdate:title') ? (props.title ?? '') : titleState.value,
    );
    const author = computed(() =>
      isControlled('onUpdate:author') ? (props.author ?? '') : authorState.value,
    );
    const cover = computed(() =>
      isControlled('onUpdate:cover') ? (props.cover ?? null) : coverState.value,
    );

    // Sync internal state when the parent updates an uncontrolled prop from
    // outside (rare, but harmless if the parent occasionally swaps values).
    watch(
      () => props.title,
      (next) => {
        if (!isControlled('onUpdate:title') && next !== undefined) titleState.value = next;
      },
    );
    watch(
      () => props.author,
      (next) => {
        if (!isControlled('onUpdate:author') && next !== undefined) authorState.value = next;
      },
    );
    watch(
      () => props.cover,
      (next) => {
        if (!isControlled('onUpdate:cover')) coverState.value = next;
      },
    );

    /**
     * Restores a controlled input whose DOM value drifted from the rendered
     * value. Vue only patches `value` when the vnode changes, so an edit the
     * parent declines would otherwise stay visible in the field.
     */
    function resyncInput(el: HTMLInputElement, read: () => string): void {
      void nextTick().then(() => {
        if (el.value !== read()) el.value = read();
      });
    }

    function setTitle(next: string, el?: HTMLInputElement): void {
      if (!isControlled('onUpdate:title')) titleState.value = next;
      emit('update:title', next);
      if (el) resyncInput(el, () => title.value);
    }
    function setAuthor(next: string, el?: HTMLInputElement): void {
      if (!isControlled('onUpdate:author')) authorState.value = next;
      emit('update:author', next);
      if (el) resyncInput(el, () => author.value);
    }
    function setCover(next: File | null): void {
      if (!isControlled('onUpdate:cover')) coverState.value = next;
      emit('update:cover', next);
    }

    const draft = useManuscriptDraft<ManuscriptAutosaveDraft>({
      initialChapters: props.chapters?.length
        ? [...props.chapters]
        : [defaultChapter(messages.value)],
      // A getter, so the hook's flush always calls the latest prop value.
      get onAutosave() {
        return props.onAutosave;
      },
      autosavePayload: (savedChapters) => ({
        title: title.value,
        author: author.value,
        cover: cover.value,
        chapters: savedChapters,
      }),
      // Any metadata the host can edit through this component has to schedule
      // an autosave and travel in its payload, exactly like the chapter list.
      autosaveDeps: () => [title.value, author.value, cover.value],
      autosaveDebounceMs: props.autosaveDebounceMs,
      // Generated chapters take their title from the catalog in effect.
      defaultChapterTitle: (index) =>
        formatMessage(messages.value.manuscriptDefaultChapterTitle, { n: index + 1 }),
    });
    const chapters = draft.chapters;
    const selected = draft.selectedChapterIndex;
    const draggingIndex = ref<number | null>(null);
    const exportError = ref<Error | null>(null);
    const current = computed(() => chapters.value[selected.value] ?? chapters.value[0]);
    // A chapters prop of new content replaces the draft, controlled or not.
    watch(
      () => chaptersKey(props.chapters),
      (key) => {
        if (key === undefined || key === chaptersKey(chapters.value)) return;
        draft.setChapters(props.chapters ?? []);
      },
    );
    // Every draft change is reported; under `v-model:chapters` a change the
    // parent declines is rolled back to the prop once it has had its say.
    watch(
      () => chaptersKey(chapters.value),
      (key) => {
        if (key === chaptersKey(props.chapters)) return;
        emit('update:chapters', chapters.value);
        if (!isControlled('onUpdate:chapters')) return;
        void nextTick().then(() => {
          const held = chaptersKey(props.chapters);
          if (held !== undefined && held !== chaptersKey(chapters.value)) {
            draft.setChapters(props.chapters ?? []);
          }
        });
      },
    );
    const manuscript = computed(() =>
      chapters.value.map((chapter) => ({
        id: chapter.id,
        title: chapter.title || messages.value.untitled,
        body: chapter.body,
      })),
    );

    /**
     * The notation highlighter owns the body textarea, so the notation buttons
     * reach it through the highlighter's root element rather than a ref of
     * their own.
     */
    function bodyTextarea(): HTMLTextAreaElement | null {
      const root = highlighterRef.value?.$el as HTMLElement | undefined;
      return root?.querySelector('textarea') ?? null;
    }

    function wrapSelection(open: string, close: string): void {
      const el = bodyTextarea();
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const before = el.value.slice(0, start);
      const middle = el.value.slice(start, end);
      const after = el.value.slice(end);
      draft.updateChapter(selected.value, {
        body: `${before}${open}${middle}${close}${after}`,
      });
      requestAnimationFrame(() => {
        const target = bodyTextarea();
        if (!target) return;
        target.focus();
        target.setSelectionRange(start + open.length, start + open.length + middle.length);
      });
    }

    // One package identifier per editor instance, so re-exports stay one publication.
    const identifier = createPackageIdentifier();

    /** Shows `error` in the panel and emits it as `error`. */
    function reportError(error: Error): void {
      exportError.value = error;
      emit('error', error);
    }

    /** Removes the error banner once a later export has succeeded. */
    function clearError(): void {
      exportError.value = null;
    }

    // Every way an export can fail — cover bytes, asset resolution, packaging —
    // reports through the same channel the panel already uses for autosave.
    async function exportEpub(): Promise<void> {
      await withErrorReporting(async () => {
        const project = EpubProject.fromManuscript({
          metadata: {
            title: title.value,
            identifier,
            ...(author.value ? { creators: [{ name: author.value, role: 'aut' }] } : {}),
          },
          dialect: props.dialect,
          chapters: chapters.value.map((chapter) => ({
            id: chapter.id,
            title: chapter.title || messages.value.untitled,
            body: chapter.body,
          })),
        });
        if (cover.value) {
          project.setCover({
            filename: coverFilename(cover.value),
            mediaType: cover.value.type || 'application/octet-stream',
            data: new Uint8Array(await cover.value.arrayBuffer()),
          });
        }
        const resolver = props.assetResolver;
        const bytes = await project.export(resolver ? { assetResolver: resolver } : undefined);
        clearError();
        emit('export', bytes);
        downloadEpub(bytes, `${title.value || 'book'}.epub`);
      }, reportError);
    }

    /** Root attributes, including the panel-side switch the stylesheet reads. */
    function rootProps(): Record<string, string> {
      return {
        class: 'mejiro-editor mejiro-manuscript-editor',
        'data-panel-side': props.panelSide,
      };
    }

    return () =>
      h('div', rootProps(), [
        h('main', { class: 'mejiro-editor-preview' }, [
          h(
            MejiroReader,
            {
              ...mergeDefined<ManuscriptPreviewProps>(
                {
                  title: title.value,
                  subtitle: messages.value.manuscriptPreviewSubtitle,
                  chapterNavMode: 'panel',
                  enableSurfaceTap: false,
                },
                props.previewProps ?? {},
              ),
              // Editor-driven, always overrides any previewProps.
              manuscript: manuscript.value,
              dialect: props.dialect,
              fonts: props.fonts ?? undefined,
              chapterIndex: selected.value,
              'onUpdate:chapterIndex': draft.setSelectedChapterIndex,
              onError: reportError,
              showImageOverlayButton: false,
            },
            // Custom preview settings controls, the Vue counterpart of the
            // React preview's `renderSettings`.
            slots.settings ? { settings: slots.settings } : undefined,
          ),
        ]),
        h('aside', { class: 'mejiro-editor-panel' }, [
          h('div', { class: 'mejiro-editor-head' }, [
            h('span', messages.value.manuscriptTitle),
            h('strong', title.value),
            h('small', messages.value.manuscriptRubyHint),
          ]),
          draft.autosaveError.value
            ? h('div', { class: 'mejiro-editor-error' }, draft.autosaveError.value.message)
            : null,
          exportError.value
            ? h('div', { class: 'mejiro-editor-error' }, exportError.value.message)
            : null,
          h('div', { class: 'mejiro-editor-section' }, [
            h('span', { class: 'mejiro-editor-label' }, messages.value.manuscriptMetadata),
            h('input', {
              value: title.value,
              onInput: (event: Event) => {
                const el = event.target as HTMLInputElement;
                setTitle(el.value, el);
              },
            }),
            h('input', {
              value: author.value,
              onInput: (event: Event) => {
                const el = event.target as HTMLInputElement;
                setAuthor(el.value, el);
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
                const input = event.target as HTMLInputElement;
                const file = input.files?.[0] ?? null;
                // Cleared so picking the same path again still fires `change`.
                input.value = '';
                setCover(file);
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
                    key: chapter.id ?? index,
                    class: { 'is-active': selected.value === index },
                    draggable: true,
                    'aria-label': formatMessage(messages.value.manuscriptReorderHandle, {
                      title: chapter.title || messages.value.untitled,
                    }),
                    'data-dragging': draggingIndex.value === index ? '' : undefined,
                    onClick: () => draft.setSelectedChapterIndex(index),
                    onDragstart: (event: DragEvent) => {
                      draggingIndex.value = index;
                      if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = 'move';
                        // Firefox starts a drag only when the transfer carries data.
                        event.dataTransfer.setData('text/plain', chapter.id ?? String(index));
                      }
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
                    h('span', formatMessage(messages.value.chapterN, { n: index + 1 })),
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
                      title: formatMessage(messages.value.manuscriptDefaultChapterTitle, {
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
                    draft.updateChapter(selected.value, {
                      title: (event.target as HTMLInputElement).value,
                    });
                  },
                }),
                // These markers are recognized by the 'mejiro' dialect only.
                props.dialect === 'mejiro'
                  ? h('div', { class: 'mejiro-editor-grid mejiro-editor-notation' }, [
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
                    ])
                  : null,
                h(MejiroNotationHighlighter, {
                  ref: (el: unknown) => {
                    highlighterRef.value = el as ComponentPublicInstance | null;
                  },
                  class: 'mejiro-editor-manuscript',
                  value: current.value.body,
                  dialect: props.dialect,
                  'onUpdate:value': (body: string) => {
                    draft.updateChapter(selected.value, { body });
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

/** Props accepted by {@link MejiroManuscriptEditor}. */
export type MejiroManuscriptEditorProps = InstanceType<typeof MejiroManuscriptEditor>['$props'];

function defaultChapter(messages: MejiroMessages): ManuscriptChapter {
  return {
    id: `chapter-${Date.now()}-0`,
    title: formatMessage(messages.manuscriptDefaultChapterTitle, { n: 1 }),
    body: messages.manuscriptDefaultBody,
  };
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

/** File name the cover is stored under: the upload name reduced to safe characters. */
function coverFilename(file: File): string {
  const filename = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return filename && !/^\.+$/u.test(filename) ? filename : `cover${coverExtension(file.type)}`;
}
