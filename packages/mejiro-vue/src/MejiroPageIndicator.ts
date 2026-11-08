import { defineComponent, h } from 'vue';

/**
 * Displays the navigation position as "n / count" under the book. Takes the
 * `index` and `count` that `useSpread` returns and shows the index one-based.
 */
export const MejiroPageIndicator = defineComponent({
  name: 'MejiroPageIndicator',
  props: {
    /** Current navigation index (0-based). */
    index: { type: Number, required: true },
    /** Number of navigation positions. */
    count: { type: Number, required: true },
  },
  setup(props) {
    return () =>
      h('div', { class: 'mejiro-reader-page-indicator' }, `${props.index + 1} / ${props.count}`);
  },
});

/** Props accepted by {@link MejiroPageIndicator}. */
export type MejiroPageIndicatorProps = InstanceType<typeof MejiroPageIndicator>['$props'];
