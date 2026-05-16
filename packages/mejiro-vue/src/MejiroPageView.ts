import type { PageResult } from '@libraz/mejiro/book';
import { type FontFamily, normalizeFontFamily } from '@libraz/mejiro/browser';
import type { RenderSegment } from '@libraz/mejiro/render';
import { defineComponent, Fragment, h, type PropType, type VNode } from 'vue';
import { MejiroPage } from './MejiroPage.js';

function renderSlotSegment(segment: RenderSegment, key: string): VNode | string {
  switch (segment.type) {
    case 'text':
      return h(Fragment, { key }, [segment.text]);
    case 'ruby':
      return h('ruby', { key }, [segment.base, h('rt', null, segment.rubyText)]);
    case 'emphasis':
      return h(
        'span',
        { key, class: `mejiro-emphasis mejiro-emphasis--${segment.style}` },
        segment.text,
      );
    case 'tcy':
      return h('span', { key, class: 'mejiro-tcy' }, segment.text);
    case 'em':
      return h('em', { key }, segment.text);
    case 'strong':
      return h('strong', { key }, segment.text);
    case 'link':
      return h('a', { key, href: segment.href, title: segment.title }, segment.text);
    case 'footnote-ref':
      return h(
        'a',
        { key, class: 'mejiro-footnote-ref', href: `#${segment.noteId}` },
        segment.text,
      );
  }
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
      type: [String, Array] as PropType<FontFamily>,
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
      const fontFamilyCss = fontFamily != null ? normalizeFontFamily(fontFamily) : undefined;

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
                  fontFamily: fontFamilyCss,
                  lineHeight: lineSpacing,
                  fontWeight: line.headingLevel != null ? '700' : undefined,
                },
              },
              line.segments.map((seg, si) => renderSlotSegment(seg, `${i}-${si}`)),
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

export type MejiroPageViewProps = InstanceType<typeof MejiroPageView>['$props'];
