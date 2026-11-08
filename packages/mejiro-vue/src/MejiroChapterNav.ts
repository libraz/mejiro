import type { EpubBook } from '@libraz/mejiro/epub';
import { defineComponent, h, type PropType } from 'vue';
import { formatMessage, useI18n } from './i18n.js';

/**
 * Layout of {@link MejiroChapterNav}: `'select'` is a compact dropdown,
 * `'panel'` a chapter list with titles, headings and a text preview.
 */
export type MejiroChapterNavVariant = 'select' | 'panel';

function textPreview(text: string, max = 72): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

/**
 * Chapter picker for an {@link EpubBook}: a compact `<select>` or a panel of
 * chapter cards, styled by the reader CSS. Bind the current chapter with
 * `v-model:chapter-index`. For search and current-anchor highlighting over a
 * long table of contents, use {@link MejiroToc}.
 */
export const MejiroChapterNav = defineComponent({
  name: 'MejiroChapterNav',
  props: {
    /** The EPUB whose chapters should be listed. */
    epub: {
      type: Object as PropType<EpubBook>,
      required: true,
    },
    /** Current chapter index (zero-based). */
    chapterIndex: {
      type: Number,
      required: true,
    },
    /** Visual treatment for the chapter list. @defaultValue 'select' */
    variant: {
      type: String as PropType<MejiroChapterNavVariant>,
      default: 'select',
    },
  },
  emits: {
    /** The user picked a chapter; carries its zero-based index. */
    'update:chapterIndex': (_chapterIndex: number) => true,
  },
  setup(props, { emit }) {
    const messages = useI18n();
    return () => {
      if (props.variant === 'panel') {
        return h(
          'nav',
          { class: 'mejiro-reader-chapter-panel', 'aria-label': messages.value.tocTitle },
          [
            h('div', { class: 'mejiro-reader-chapter-panel-head' }, [
              h('span', { class: 'mejiro-reader-chapter-panel-kicker' }, messages.value.tocTitle),
              h('strong', props.epub.title),
              props.epub.author ? h('span', props.epub.author) : null,
            ]),
            h(
              'ol',
              { class: 'mejiro-reader-chapter-list' },
              props.epub.chapters.map((ch, i) => {
                const title = ch.title ?? formatMessage(messages.value.chapterN, { n: i + 1 });
                const preview = ch.paragraphs.find((p) => !p.headingLevel && p.text.trim())?.text;
                // Keyed by paragraph index: heading text can repeat within a chapter.
                const headings = ch.paragraphs
                  .flatMap((p, paragraph) =>
                    p.headingLevel && p.text.trim() && p.text.trim() !== title
                      ? [{ paragraph, text: p.text }]
                      : [],
                  )
                  .slice(0, 3);

                return h('li', { key: i, class: 'mejiro-reader-chapter-list-item' }, [
                  h(
                    'button',
                    {
                      type: 'button',
                      class: [
                        'mejiro-reader-chapter-card',
                        { 'is-active': i === props.chapterIndex },
                      ],
                      'aria-current': i === props.chapterIndex ? 'true' : undefined,
                      onClick: () => emit('update:chapterIndex', i),
                    },
                    [
                      h(
                        'span',
                        { class: 'mejiro-reader-chapter-number' },
                        String(i + 1).padStart(2, '0'),
                      ),
                      h('span', { class: 'mejiro-reader-chapter-main' }, [
                        h('span', { class: 'mejiro-reader-chapter-title' }, title),
                        preview
                          ? h(
                              'span',
                              { class: 'mejiro-reader-chapter-preview' },
                              textPreview(preview),
                            )
                          : null,
                        headings.length > 0
                          ? h(
                              'span',
                              { class: 'mejiro-reader-chapter-subheads' },
                              headings.map((heading) =>
                                h(
                                  'span',
                                  { key: heading.paragraph },
                                  textPreview(heading.text, 30),
                                ),
                              ),
                            )
                          : null,
                      ]),
                    ],
                  ),
                ]);
              }),
            ),
          ],
        );
      }

      return h(
        'div',
        { class: 'mejiro-reader-chapter-nav' },
        h(
          'select',
          {
            value: props.chapterIndex,
            onChange: (e: Event) =>
              emit('update:chapterIndex', Number((e.target as HTMLSelectElement).value)),
          },
          props.epub.chapters.map((ch, i) =>
            h(
              'option',
              { key: i, value: i },
              ch.title ?? formatMessage(messages.value.chapterN, { n: i + 1 }),
            ),
          ),
        ),
      );
    };
  },
});

/** Props accepted by {@link MejiroChapterNav}. */
export type MejiroChapterNavProps = InstanceType<typeof MejiroChapterNav>['$props'];
