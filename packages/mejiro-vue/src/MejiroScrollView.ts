import type { ChapterLayout, PageResult } from '@libraz/mejiro/book';
import { type FontFamily, normalizeFontFamily } from '@libraz/mejiro/browser';
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  type PropType,
  ref,
  watch,
} from 'vue';
import { MejiroPageView } from './MejiroPageView.js';

/** Props for {@link MejiroScrollView}. */
export interface MejiroScrollViewProps {
  layout: ChapterLayout;
  pageWidth: number;
  pageHeight: number;
  contentHeight: number;
  fontFamily?: FontFamily;
  fontSize?: number;
  lineSpacing?: number;
  slotMode?: boolean;
  scrollToPage?: number;
  pageGap?: number;
}

/**
 * Continuous-scroll variant of {@link MejiroSpread} for Vue. Stacks every
 * page in the chapter inside a vertically scrollable container. Emits
 * `visible-page-change` as the viewport scrolls.
 */
export const MejiroScrollView = defineComponent({
  name: 'MejiroScrollView',
  props: {
    layout: { type: Object as PropType<ChapterLayout>, required: true },
    pageWidth: { type: Number, required: true },
    pageHeight: { type: Number, required: true },
    contentHeight: { type: Number, required: true },
    fontFamily: { type: [String, Array] as PropType<FontFamily>, default: undefined },
    fontSize: { type: Number, default: undefined },
    lineSpacing: { type: Number, default: undefined },
    slotMode: { type: Boolean, default: false },
    scrollToPage: { type: Number, default: undefined },
    pageGap: { type: Number, default: 24 },
  },
  emits: ['visible-page-change'],
  setup(props, { emit }) {
    const containerEl = ref<HTMLDivElement | null>(null);
    const pageEls = ref<Array<HTMLDivElement | null>>([]);

    const pages = computed<PageResult[]>(() => {
      const total = props.layout.totalPages;
      return Array.from({ length: total }, (_, i) => props.layout.getPage(i));
    });
    const useSlot = true;

    const contentStyle = computed(() => {
      const style: Record<string, string | number> = { height: `${props.contentHeight}px` };
      if (props.fontFamily) style.fontFamily = normalizeFontFamily(props.fontFamily);
      if (props.fontSize != null) style.fontSize = `${props.fontSize}px`;
      if (props.lineSpacing != null) style.lineHeight = String(props.lineSpacing);
      return style;
    });

    let observer: IntersectionObserver | null = null;
    let mostVisibleIdx = -1;
    let mostVisibleRatio = 0;
    onMounted(() => {
      const container = containerEl.value;
      if (!container) return;
      if (typeof IntersectionObserver === 'undefined') return;
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset.pageIdx);
            if (Number.isNaN(idx)) continue;
            if (entry.intersectionRatio > mostVisibleRatio || idx === mostVisibleIdx) {
              if (entry.isIntersecting) {
                mostVisibleRatio = entry.intersectionRatio;
                mostVisibleIdx = idx;
              } else if (idx === mostVisibleIdx) {
                mostVisibleIdx = -1;
                mostVisibleRatio = 0;
              }
            }
          }
          if (mostVisibleIdx >= 0) emit('visible-page-change', mostVisibleIdx);
        },
        { root: container, threshold: [0.25, 0.5, 0.75] },
      );
      for (const el of pageEls.value) {
        if (el) observer.observe(el);
      }
    });
    onBeforeUnmount(() => {
      observer?.disconnect();
      observer = null;
    });

    watch(
      () => props.scrollToPage,
      (next) => {
        if (next == null) return;
        const el = pageEls.value[next];
        if (!(el && containerEl.value)) return;
        containerEl.value.scrollTo({ top: el.offsetTop, behavior: 'auto' });
      },
    );

    return () =>
      h(
        'div',
        {
          ref: containerEl,
          class: 'mejiro-reader-scroll',
        },
        h(
          'div',
          {
            class: 'mejiro-reader-scroll-track',
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: `${props.pageGap}px`,
            },
          },
          pages.value.map((result, i) =>
            h(
              'div',
              {
                ref: (el) => {
                  pageEls.value[i] = el as HTMLDivElement | null;
                },
                'data-page-idx': i,
                class: 'mejiro-reader-page',
                style: {
                  width: `${props.pageWidth}px`,
                  height: `${props.pageHeight}px`,
                  flexShrink: 0,
                },
              },
              [
                h('div', { class: 'mejiro-reader-page-rule' }),
                h('div', { class: 'mejiro-reader-page-header' }, [
                  h('span', { class: 'mejiro-reader-page-header-title' }),
                  h('span', { class: 'mejiro-reader-page-header-num' }, String(i + 1)),
                ]),
                h('div', { class: 'mejiro-reader-page-viewport' }, [
                  h(
                    'div',
                    {
                      class: 'mejiro-reader-page-clip',
                      style: { height: `${props.contentHeight}px` },
                    },
                    [
                      h(MejiroPageView, {
                        result,
                        slotMode: useSlot,
                        fontFamily: props.fontFamily,
                        lineSpacing: props.lineSpacing,
                        class: 'mejiro-reader-page-content',
                        style: contentStyle.value,
                      }),
                    ],
                  ),
                ]),
              ],
            ),
          ),
        ),
      );
  },
});
