import { type AssetResolver, type EpubBook, EpubProject, parseEpub } from '@libraz/mejiro/epub';
import { computed, defineComponent, h, type PropType, ref, watch } from 'vue';
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

export const MejiroManuscriptEditor = defineComponent({
  name: 'MejiroManuscriptEditor',
  props: {
    fonts: { type: Array as PropType<FontChoice[]>, default: undefined },
    title: { type: String, default: undefined },
    author: { type: String, default: '' },
    chapters: { type: Array as PropType<ManuscriptEditorChapter[]>, default: undefined },
    /**
     * Props forwarded to the embedded {@link MejiroReader} preview. Lets
     * hosts customize subtitle / chapterNavMode / etc.; `epub` and `fonts`
     * remain driven by the editor.
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
  emits: ['export'],
  setup(props, { emit }) {
    const messages = useI18n();
    const coverInput = ref<HTMLInputElement | null>(null);
    const title = ref(props.title ?? messages.value.manuscriptDefaultTitle);
    const author = ref(props.author);
    const chapters = ref<ManuscriptEditorChapter[]>(
      props.chapters?.length ? [...props.chapters] : [defaultChapter(messages.value)],
    );
    const selected = ref(0);
    const cover = ref<File | null>(null);
    const preview = ref<EpubBook | null>(null);
    const error = ref<Error | null>(null);
    const bodyTextareaRef = ref<HTMLTextAreaElement | null>(null);
    const current = computed(() => chapters.value[selected.value] ?? chapters.value[0]);

    function buildProject(): EpubProject {
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
          data: new Uint8Array(),
        });
      }
      return project;
    }

    watch(
      [title, author, chapters, cover],
      () => {
        let cancelled = false;
        const timer = setTimeout(() => {
          void (async () => {
            try {
              preview.value = await parseEpub(await buildProject().export());
              error.value = null;
            } catch (err) {
              if (!cancelled) error.value = err instanceof Error ? err : new Error(String(err));
            }
          })();
        }, 250);
        return () => {
          cancelled = true;
          clearTimeout(timer);
        };
      },
      { immediate: true, deep: true },
    );

    function patchChapter(index: number, patch: Partial<ManuscriptEditorChapter>): void {
      chapters.value = chapters.value.map((chapter, i) =>
        i === index ? { ...chapter, ...patch } : chapter,
      );
    }

    function wrapSelection(open: string, close: string): void {
      const el = bodyTextareaRef.value;
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const before = el.value.slice(0, start);
      const middle = el.value.slice(start, end);
      const after = el.value.slice(end);
      patchChapter(selected.value, { body: `${before}${open}${middle}${close}${after}` });
      requestAnimationFrame(() => {
        const target = bodyTextareaRef.value;
        if (!target) return;
        target.focus();
        target.setSelectionRange(start + open.length, start + open.length + middle.length);
      });
    }

    function addChapter(): void {
      chapters.value = [...chapters.value, defaultChapter(messages.value, chapters.value.length)];
      selected.value = chapters.value.length - 1;
    }

    function removeChapter(): void {
      if (chapters.value.length <= 1) return;
      chapters.value = chapters.value.filter((_, index) => index !== selected.value);
      selected.value = Math.max(0, Math.min(selected.value, chapters.value.length - 1));
    }

    async function exportEpub(): Promise<void> {
      const project = buildProject();
      if (cover.value) {
        project.assets.length = 0;
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
          preview.value
            ? h(MejiroReader, {
                subtitle: messages.value.manuscriptPreviewSubtitle,
                chapterNavMode: 'panel',
                ...(props.previewProps ?? {}),
                // Editor-driven, always override.
                epub: preview.value,
                fonts: props.fonts ?? undefined,
                enableImageOverlay: false,
              })
            : null,
          error.value ? h('div', { class: 'mejiro-editor-error' }, error.value.message) : null,
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
                title.value = (event.target as HTMLInputElement).value;
              },
            }),
            h('input', {
              value: author.value,
              onInput: (event: Event) => {
                author.value = (event.target as HTMLInputElement).value;
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
                cover.value = (event.target as HTMLInputElement).files?.[0] ?? null;
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
                    onClick: () => {
                      selected.value = index;
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
                { type: 'button', onClick: addChapter },
                messages.value.manuscriptAddChapter,
              ),
              h(
                'button',
                { type: 'button', onClick: removeChapter },
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
                    patchChapter(selected.value, {
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
                    patchChapter(selected.value, {
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
