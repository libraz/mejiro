import type { PageResult } from '@libraz/mejiro/book';
import type { RenderSegment } from '@libraz/mejiro/render';
import { defineComponent, h, type PropType, type VNode } from 'vue';
import { MejiroPage } from './MejiroPage.js';

function renderSlotSegment(segment: RenderSegment, key: number): VNode | string {
  if (segment.type === 'text') return segment.text;
  return h('ruby', { key }, [segment.base, h('rt', null, segment.rubyText)]);
}

/**
 * Vue component that renders a page from a {@link PageResult}.
 *
 * Automatically selects the rendering strategy:
 * - **Normal mode** (no images): Uses CSS `writing-mode: vertical-rl` via `MejiroPage`.
 * - **Slot mode** (images present): Uses absolute-positioned columns with per-line sizing.
 *
 * @example
 * ```vue
 * <MejiroPageView :result="spread.right" fontFamily="serif" :lineSpacing="1.8" />
 * ```
 */
export const MejiroPageView = defineComponent({
  name: 'MejiroPageView',
  props: {
    /** Page result from ChapterLayout.getSpread() or ChapterLayout.getPage(). */
    result: {
      type: Object as PropType<PageResult>,
      required: true,
    },
    /** CSS font family for slot-based rendering (used when images are present). */
    fontFamily: {
      type: String,
    },
    /** Line spacing multiplier for slot-based rendering (used when images are present). */
    lineSpacing: {
      type: Number,
    },
    /** Force slot-based rendering even when result.hasImages is false. */
    slotMode: {
      type: Boolean,
    },
  },
  setup(props) {
    return () => {
      const { result, fontFamily, lineSpacing, slotMode } = props;

      if (result.hasImages || slotMode) {
        const columns = result.lines
          .map((line, i) => {
            const slot = result.slots[i];
            if (!slot || slot.height <= 0) return null;
            return h(
              'div',
              {
                key: i,
                style: {
                  position: 'absolute',
                  writingMode: 'vertical-rl',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  right: `${slot.xPos}px`,
                  top: `${slot.yStart}px`,
                  height: `${slot.height}px`,
                  fontSize: `${line.fontSize}px`,
                  fontFamily,
                  lineHeight: lineSpacing,
                  fontWeight: line.headingLevel != null ? '700' : undefined,
                },
              },
              line.segments.map((seg, si) => renderSlotSegment(seg, si)),
            );
          })
          .filter(Boolean);

        return h(
          'div',
          {
            class: 'mejiro-page-slots',
            style: { position: 'relative' },
          },
          columns as VNode[],
        );
      }

      return h(MejiroPage, { page: result.page });
    };
  },
});
