import { estimateReadingTime, formatReadingTime } from '@libraz/mejiro/book';
import type { EpubChapter } from '@libraz/mejiro/epub';
import { computed, defineComponent, h, type PropType } from 'vue';

/**
 * Compact reading stats line: characters, page count, ruby count,
 * font, and elapsed layout time.
 */
export const MejiroStats = defineComponent({
  name: 'MejiroStats',
  props: {
    /** Chapter currently displayed. */
    chapter: { type: Object as PropType<EpubChapter | null>, default: null },
    /** Total page count for the current layout. */
    totalPages: { type: Number, default: 0 },
    /** Most recent layout time in ms. */
    elapsedMs: { type: Number, default: 0 },
    /** Optional label for the current font (e.g. "Noto Serif JP 16px"). */
    fontLabel: { type: String, default: '' },
    /** Show estimated reading time in the stats line. @defaultValue false */
    showReadingTime: { type: Boolean, default: false },
    /** Characters-per-minute used for the reading-time estimate. @defaultValue 600 */
    cpm: { type: Number, default: 600 },
    /** Locale used to format the reading-time label. @defaultValue 'ja' */
    readingTimeLocale: { type: String as PropType<'ja' | 'en'>, default: 'ja' },
  },
  setup(props) {
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
        (s, p) => s + p.inlineAnnotations.filter((a) => a.kind === 'ruby').length,
        0,
      );
      const readingTimeLabel = props.showReadingTime
        ? formatReadingTime(estimateReadingTime(ch, { cpm: props.cpm }), props.readingTimeLocale)
        : null;
      const parts = [
        `${totalChars}ch`,
        `${props.totalPages}pp`,
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

export type MejiroStatsProps = InstanceType<typeof MejiroStats>['$props'];
