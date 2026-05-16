import { defineComponent, h, type PropType } from 'vue';
import { useI18n } from './i18n.js';
import type { VolumeInfo } from './useLibrary.js';

/**
 * Visual bookshelf picker. Renders each volume as a card with cover, label,
 * and author. Pair with {@link useLibrary} to drive selection.
 */
export const MejiroShelf = defineComponent({
  name: 'MejiroShelf',
  props: {
    volumes: {
      type: Array as PropType<readonly VolumeInfo[]>,
      required: true,
    },
    currentId: { type: String, default: undefined },
    title: { type: String, default: undefined },
  },
  emits: {
    select: (_volume: VolumeInfo) => true,
  },
  setup(props, { emit }) {
    const messages = useI18n();
    return () =>
      h(
        'section',
        { class: 'mejiro-shelf', 'aria-label': props.title ?? messages.value.shelfTitle },
        [
          h('header', { class: 'mejiro-shelf-header' }, [
            h('span', { class: 'mejiro-shelf-title' }, props.title ?? messages.value.shelfTitle),
          ]),
          h(
            'ul',
            { class: 'mejiro-shelf-grid' },
            props.volumes.map((v) =>
              h('li', { key: v.id, class: 'mejiro-shelf-item' }, [
                h(
                  'button',
                  {
                    type: 'button',
                    class: ['mejiro-shelf-card', { 'is-active': v.id === props.currentId }],
                    onClick: () => emit('select', v),
                  },
                  [
                    v.cover
                      ? h('span', {
                          class: 'mejiro-shelf-cover',
                          style: { backgroundImage: `url(${JSON.stringify(v.cover)})` },
                          'aria-hidden': 'true',
                        })
                      : h('span', {
                          class: 'mejiro-shelf-cover mejiro-shelf-cover--blank',
                          'aria-hidden': 'true',
                        }),
                    h('span', { class: 'mejiro-shelf-meta' }, [
                      h('span', { class: 'mejiro-shelf-label' }, v.label),
                      v.author ? h('span', { class: 'mejiro-shelf-author' }, v.author) : null,
                    ]),
                  ],
                ),
              ]),
            ),
          ),
        ],
      );
  },
});

export type MejiroShelfProps = InstanceType<typeof MejiroShelf>['$props'];
