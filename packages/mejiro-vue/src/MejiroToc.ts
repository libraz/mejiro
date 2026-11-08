import type { ReadingAnchor } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { computed, defineComponent, h, type PropType, ref } from 'vue';
import { formatMessage, type MejiroMessages, useI18n } from './i18n.js';

interface ChapterEntry {
  index: number;
  title: string;
  /** Sub-headings, keyed by paragraph index so repeated heading text stays distinct. */
  headings: { paragraph: number; text: string }[];
}

function buildEntries(epub: EpubBook, messages: MejiroMessages): ChapterEntry[] {
  return epub.chapters.map((ch, i) => {
    const title = ch.title ?? formatMessage(messages.chapterN, { n: i + 1 });
    const headings = ch.paragraphs.flatMap((p, paragraph) => {
      const text = p.text.trim();
      return p.headingLevel && text && text !== title ? [{ paragraph, text }] : [];
    });
    return { index: i, title, headings };
  });
}

/**
 * Searchable, current-anchor-aware table of contents. Long-form replacement
 * for {@link MejiroChapterNav}.
 */
export const MejiroToc = defineComponent({
  name: 'MejiroToc',
  props: {
    /** The EPUB whose chapters and sub-headings are listed. */
    epub: { type: Object as PropType<EpubBook>, required: true },
    /** Reading position; its chapter is marked current. */
    currentAnchor: {
      type: Object as PropType<ReadingAnchor | null>,
      default: null,
    },
    /** Show a search field that filters chapters by title and sub-heading. @defaultValue false */
    showSearch: { type: Boolean, default: false },
    /** Heading of the list. @defaultValue `messages.tocTitle` */
    title: { type: String, default: undefined },
    /** Placeholder of the search field. @defaultValue `messages.tocSearchPlaceholder` */
    searchPlaceholder: { type: String, default: undefined },
  },
  emits: {
    /** The user picked a chapter; carries its zero-based index. */
    'chapter-select': (_chapterIndex: number) => true,
  },
  setup(props, { emit }) {
    const messages = useI18n();
    const query = ref('');
    const entries = computed(() => buildEntries(props.epub, messages.value));
    const filtered = computed(() => {
      if (!query.value) return entries.value;
      const needle = query.value.toLowerCase();
      return entries.value.filter(
        (e) =>
          e.title.toLowerCase().includes(needle) ||
          e.headings.some((heading) => heading.text.toLowerCase().includes(needle)),
      );
    });
    const activeIndex = computed(() => props.currentAnchor?.chapterIndex ?? -1);
    const resolvedTitle = computed(() => props.title ?? messages.value.tocTitle);
    const resolvedSearchPlaceholder = computed(
      () => props.searchPlaceholder ?? messages.value.tocSearchPlaceholder,
    );

    return () =>
      h('nav', { class: 'mejiro-toc', 'aria-label': resolvedTitle.value }, [
        h('header', { class: 'mejiro-toc-header' }, [
          h('span', { class: 'mejiro-toc-title' }, resolvedTitle.value),
          props.epub.author ? h('span', { class: 'mejiro-toc-subtitle' }, props.epub.author) : null,
        ]),
        props.showSearch
          ? h('div', { class: 'mejiro-toc-search' }, [
              h('input', {
                type: 'search',
                value: query.value,
                placeholder: resolvedSearchPlaceholder.value,
                'aria-label': resolvedSearchPlaceholder.value,
                onInput: (e: Event) => {
                  query.value = (e.target as HTMLInputElement).value;
                },
              }),
            ])
          : null,
        h(
          'ol',
          { class: 'mejiro-toc-list' },
          filtered.value.map((entry) =>
            h('li', { key: entry.index, class: 'mejiro-toc-item' }, [
              h(
                'button',
                {
                  type: 'button',
                  class: ['mejiro-toc-link', { 'is-active': entry.index === activeIndex.value }],
                  'aria-current': entry.index === activeIndex.value ? 'true' : undefined,
                  onClick: () => emit('chapter-select', entry.index),
                },
                [
                  h('span', { class: 'mejiro-toc-num' }, String(entry.index + 1).padStart(2, '0')),
                  h('span', { class: 'mejiro-toc-label' }, entry.title),
                ],
              ),
              entry.headings.length > 0
                ? h(
                    'ul',
                    { class: 'mejiro-toc-subheads' },
                    entry.headings
                      .slice(0, 5)
                      .map((heading) =>
                        h(
                          'li',
                          { key: heading.paragraph, class: 'mejiro-toc-subhead' },
                          heading.text,
                        ),
                      ),
                  )
                : null,
            ]),
          ),
        ),
        filtered.value.length === 0
          ? h(
              'div',
              { class: 'mejiro-toc-empty', role: 'status' },
              formatMessage(messages.value.tocEmpty, { query: query.value }),
            )
          : null,
      ]);
  },
});

/** Props accepted by {@link MejiroToc}. */
export type MejiroTocProps = InstanceType<typeof MejiroToc>['$props'];
