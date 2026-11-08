import { estimateReadingTime, formatReadingTime } from '@libraz/mejiro/book';
import type { EpubChapter } from '@libraz/mejiro/epub';
import { computed, defineComponent, h, type PropType } from 'vue';
import { type MejiroLocale, resolveMessages, useI18n } from './i18n.js';

/**
 * Compact reading stats line: characters, page count, ruby count,
 * font, and elapsed layout time.
 */
export const MejiroStats = defineComponent({
  name: 'MejiroStats',
  props: {
    /** Chapter currently displayed. */
    chapter: { type: Object as PropType<EpubChapter | null>, default: null },
    /** Number of pages in the current layout. */
    pageCount: { type: Number, default: 0 },
    /** Most recent layout time in ms. */
    elapsedMs: { type: Number, default: 0 },
    /** Optional label for the current font (e.g. "Noto Serif JP 16px"). */
    fontLabel: { type: String, default: '' },
    /** Show estimated reading time in the stats line. @defaultValue false */
    showReadingTime: { type: Boolean, default: false },
    /** Reading rate, in characters per minute, of the reading-time estimate. @defaultValue 600 */
    charsPerMinute: { type: Number, default: 600 },
    /**
     * Locale whose catalog spells the reading-time units. Defaults to the
     * catalog of the nearest `MejiroI18nProvider`.
     */
    locale: { type: String as PropType<MejiroLocale>, default: undefined },
  },
  setup(props) {
    const provided = useI18n();
    const messages = computed(() =>
      props.locale ? resolveMessages(props.locale, undefined) : provided.value,
    );
    const text = computed(() => {
      const ch = props.chapter;
      if (!ch) return '';
      // Same population as the reading-time estimate shown beside it:
      // codepoints (so surrogate pairs count once) with headings left out.
      const totalChars = ch.paragraphs.reduce(
        (s, p) => (p.headingLevel != null ? s : s + [...p.text].length),
        0,
      );
      const totalRuby = ch.paragraphs.reduce(
        (s, p) => s + p.inlineAnnotations.filter((a) => a.type === 'ruby').length,
        0,
      );
      const readingTimeLabel = props.showReadingTime
        ? formatReadingTime(estimateReadingTime(ch, { charsPerMinute: props.charsPerMinute }), {
            messages: messages.value,
          })
        : null;
      const parts = [
        `${totalChars}ch`,
        `${props.pageCount}pp`,
        totalRuby > 0 ? `${totalRuby}ruby` : null,
        readingTimeLabel,
        props.fontLabel ? props.fontLabel : null,
        `${props.elapsedMs.toFixed(0)}ms`,
      ];
      return parts.filter(Boolean).join(' / ');
    });
    return () => h('span', { class: 'mejiro-reader-stats' }, text.value);
  },
});

/** Props accepted by {@link MejiroStats}. */
export type MejiroStatsProps = InstanceType<typeof MejiroStats>['$props'];
