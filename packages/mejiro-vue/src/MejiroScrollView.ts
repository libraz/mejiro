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

/**
 * Continuous-scroll variant of {@link MejiroSpread} for Vue. Stacks every
 * page in the chapter inside a vertically scrollable container. The visible
 * page is detected via `IntersectionObserver` and reported through the
 * `visible-page-change` event as the viewport scrolls.
 */
export const MejiroScrollView = defineComponent({
  name: 'MejiroScrollView',
  props: {
    /** Layout containing the pages to render. */
    layout: { type: Object as PropType<ChapterLayout>, required: true },
    /** Page width in px. */
    pageWidth: { type: Number, required: true },
    /** Page height in px. */
    pageHeight: { type: Number, required: true },
    /** Content area height (px). */
    contentHeight: { type: Number, required: true },
    /** CSS font family applied to the content. */
    fontFamily: { type: [String, Array] as PropType<FontFamily>, default: undefined },
    /** Font size override (px). */
    fontSize: { type: Number, default: undefined },
    /** Line spacing multiplier. */
    lineSpacing: { type: Number, default: undefined },
    /** Force slot-based rendering on every page. */
    slotMode: { type: Boolean, default: undefined },
    /**
     * Target page to scroll into view. When set, the view scrolls so that the
     * matching page sits at the top of the scroll container.
     */
    scrollToPage: { type: Number, default: undefined },
    /** Vertical gap between pages (px). @defaultValue 24 */
    pageGap: { type: Number, default: 24 },
  },
  emits: {
    /**
     * Visible page index reported to the parent as the viewport scrolls. The
     * page with the largest intersection with the viewport is treated as
     * visible. `source` is `'programmatic'` while the view is settling a
     * {@link MejiroScrollViewProps.scrollToPage} request, so hosts can ignore
     * their own scrolls instead of feeding them back as navigation. Declared in
     * camelCase so the derived props type exposes a typed
     * `onVisiblePageChange`; template listeners may still use
     * `@visible-page-change`.
     */
    visiblePageChange: (_pageIdx: number, _source: 'user' | 'programmatic') => true,
  },
  setup(props, { emit }) {
    const containerEl = ref<HTMLDivElement | null>(null);
    const pageEls = ref<Array<HTMLDivElement | null>>([]);

    const pages = computed<PageResult[]>(() => {
      const total = props.layout.totalPages;
      return Array.from({ length: total }, (_, i) => props.layout.getPage(i));
    });
    const contentStyle = computed(() => {
      const style: Record<string, string | number> = { height: `${props.contentHeight}px` };
      if (props.fontFamily) style.fontFamily = normalizeFontFamily(props.fontFamily);
      if (props.fontSize != null) style.fontSize = `${props.fontSize}px`;
      if (props.lineSpacing != null) style.lineHeight = String(props.lineSpacing);
      return style;
    });

    let observer: IntersectionObserver | null = null;
    // Set while a `scrollToPage` request is settling, so the intersection
    // callback it triggers is reported as programmatic rather than as a user
    // scroll the host should navigate to.
    let programmaticScroll = false;
    let programmaticTimer: ReturnType<typeof setTimeout> | null = null;

    // Rebuilt from scratch whenever the page list changes, so the observed
    // elements always match the currently rendered pages: a reflow re-layout
    // swaps the `ChapterLayout` (and its page count) without unmounting.
    function observePages(): void {
      observer?.disconnect();
      observer = null;
      const container = containerEl.value;
      if (!container) return;
      if (pages.value.length === 0) return;
      if (typeof IntersectionObserver === 'undefined') return;
      let mostVisibleIdx = -1;
      let mostVisibleRatio = 0;
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
          if (mostVisibleIdx >= 0) {
            emit('visiblePageChange', mostVisibleIdx, programmaticScroll ? 'programmatic' : 'user');
          }
        },
        { root: container, threshold: [0.25, 0.5, 0.75] },
      );
      for (const el of pageEls.value) {
        if (el) observer.observe(el);
      }
    }

    onMounted(observePages);
    // `flush: 'post'` so the new page elements exist before they are observed.
    watch(() => pages.value.length, observePages, { flush: 'post' });
    onBeforeUnmount(() => {
      observer?.disconnect();
      observer = null;
      if (programmaticTimer) {
        clearTimeout(programmaticTimer);
        programmaticTimer = null;
      }
    });

    // Applied on mount as well as on later changes, so a restored reading
    // position lands on the requested page at the first paint instead of
    // page 0. Page elements only exist after the initial render, so the
    // page-count change is a dependency too.
    function applyScrollToPage(): void {
      const next = props.scrollToPage;
      if (next == null) return;
      if (pages.value.length === 0) return;
      const el = pageEls.value[next];
      if (!(el && containerEl.value)) return;
      programmaticScroll = true;
      containerEl.value.scrollTo({ top: el.offsetTop, behavior: 'auto' });
      if (programmaticTimer) clearTimeout(programmaticTimer);
      programmaticTimer = setTimeout(() => {
        programmaticScroll = false;
        programmaticTimer = null;
      }, 0);
    }

    onMounted(applyScrollToPage);
    watch([() => props.scrollToPage, () => pages.value.length], applyScrollToPage, {
      flush: 'post',
    });

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
                        slotMode: props.slotMode,
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

/** Props for {@link MejiroScrollView}, including the emit-derived listeners. */
export type MejiroScrollViewProps = InstanceType<typeof MejiroScrollView>['$props'];
