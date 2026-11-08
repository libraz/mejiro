import type { ChapterLayout, PageResult } from '@libraz/mejiro/book';
import { type FontFamily, normalizeFontFamily } from '@libraz/mejiro/browser';
import { paragraphClassName } from '@libraz/mejiro/render';
import { defineComponent, h, type PropType, toRaw, type VNode } from 'vue';
import { MejiroPage } from './MejiroPage.js';
import { renderSegment } from './renderInlineNode.js';

/**
 * Vue component that renders a page from a {@link PageResult}.
 *
 * Automatically selects the rendering strategy:
 * - **Normal mode** (no images): Uses CSS `writing-mode: vertical-rl` via `MejiroPage`.
 * - **Slot mode** (images present): Uses absolute-positioned columns with per-line sizing.
 *
 * Given `layout`, the slot-mode font family and line spacing default to the
 * typography that layout was measured with.
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
    /** Layout the page comes from; its `typography` supplies the font props that are not given. */
    layout: {
      type: Object as PropType<ChapterLayout>,
    },
    /**
     * CSS font family for slot-based rendering (used when images are present).
     * @defaultValue `layout.typography.fontFamily`
     */
    fontFamily: {
      type: [String, Array] as PropType<FontFamily>,
    },
    /**
     * Line spacing multiplier for slot-based rendering (used when images are present).
     * @defaultValue `layout.typography.lineSpacing`
     */
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
      const { result, slotMode } = props;
      const typography = toRaw(props.layout)?.typography;
      const fontFamily = props.fontFamily ?? typography?.fontFamily;
      const lineSpacing = props.lineSpacing ?? typography?.lineSpacing;
      const fontFamilyCss = fontFamily != null ? normalizeFontFamily(fontFamily) : undefined;

      if (result.hasImages || slotMode) {
        const columns = result.lines
          .map((line, i) => {
            const slot = result.slots[i];
            if (!slot || slot.height <= 0) return null;
            // Geometry is the layout's; weight, style and white-space come from
            // the paragraph class, as in flow mode.
            return h(
              'div',
              {
                key: i,
                class: paragraphClassName(line.kind, line.headingLevel),
                style: {
                  position: 'absolute',
                  writingMode: 'vertical-rl',
                  overflow: 'hidden',
                  margin: 0,
                  right: `${slot.xPos}px`,
                  top: `${slot.yStart}px`,
                  height: `${slot.height}px`,
                  fontSize: `${line.fontSize}px`,
                  lineHeight: lineSpacing,
                },
              },
              line.segments.map((seg, si) => renderSegment(seg, `${i}-${si}`)),
            );
          })
          .filter(Boolean);

        return h(
          'div',
          {
            class: 'mejiro-page-slots',
            style: { position: 'relative', fontFamily: fontFamilyCss },
          },
          columns as VNode[],
        );
      }

      return h(MejiroPage, { page: result.page });
    };
  },
});

/** Props accepted by {@link MejiroPageView}. */
export type MejiroPageViewProps = InstanceType<typeof MejiroPageView>['$props'];
