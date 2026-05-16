import type { EpubBook } from '@libraz/mejiro/epub';
import { defineComponent, h, type PropType } from 'vue';
import { format, useI18n } from './i18n.js';

export type MejiroChapterNavVariant = 'select' | 'panel';

function textPreview(text: string, max = 72): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

/**
 * Chapter selector for an {@link EpubBook}.
 *
 * Renders a `<select>` styled by the reader CSS. Use `v-model:chapter` to
 * bind the current chapter index, or listen to `update:chapter`.
 *
 * @deprecated Prefer {@link MejiroToc} for new code. `MejiroToc` adds
 * search and current-anchor highlighting. The `<select>` variant remains
 * supported here for existing `MejiroReader` integration.
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
    chapter: {
      type: Number,
      required: true,
    },
    /** Visual treatment for the chapter list. */
    variant: {
      type: String as PropType<MejiroChapterNavVariant>,
      default: 'select',
    },
  },
  emits: ['update:chapter'],
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
                const title = ch.title ?? format(messages.value.chapterN, { n: i + 1 });
                const preview = ch.paragraphs.find((p) => !p.headingLevel && p.text.trim())?.text;
                const chapterKey = `${title}-${ch.paragraphs
                  .map((p) => p.text)
                  .join('|')
                  .slice(0, 120)}`;
                const headings = ch.paragraphs
                  .filter((p) => p.headingLevel && p.text.trim() && p.text.trim() !== title)
                  .slice(0, 3);

                return h('li', { key: chapterKey, class: 'mejiro-reader-chapter-list-item' }, [
                  h(
                    'button',
                    {
                      type: 'button',
                      class: ['mejiro-reader-chapter-card', { 'is-active': i === props.chapter }],
                      'aria-current': i === props.chapter ? 'true' : undefined,
                      onClick: () => emit('update:chapter', i),
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
                                h('span', { key: heading.text }, textPreview(heading.text, 30)),
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
            value: props.chapter,
            onChange: (e: Event) =>
              emit('update:chapter', Number((e.target as HTMLSelectElement).value)),
          },
          props.epub.chapters.map((ch, i) =>
            h(
              'option',
              { key: i, value: i },
              ch.title ?? format(messages.value.chapterN, { n: i + 1 }),
            ),
          ),
        ),
      );
    };
  },
});

export type MejiroChapterNavProps = InstanceType<typeof MejiroChapterNav>['$props'];
