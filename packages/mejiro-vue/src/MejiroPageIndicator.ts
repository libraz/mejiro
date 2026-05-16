import { defineComponent, h } from 'vue';

/** Displays "current / total" spread position under the book. */
export const MejiroPageIndicator = defineComponent({
  name: 'MejiroPageIndicator',
  props: {
    /** Current spread (1-based). */
    current: { type: Number, required: true },
    /** Total number of spreads. */
    total: { type: Number, required: true },
  },
  setup(props) {
    return () =>
      h('div', { class: 'mejiro-reader-page-indicator' }, `${props.current} / ${props.total}`);
  },
});

export type MejiroPageIndicatorProps = InstanceType<typeof MejiroPageIndicator>['$props'];
