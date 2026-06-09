import { defineComponent, h, type PropType } from 'vue';
import { useI18n } from './i18n.js';
import type { ImageRect } from './useImageOverlay.js';

/**
 * Decorative overlay component representing an in-flow image placeholder
 * with drag and resize affordances. Pure presentation — wire up the
 * pointer-down handlers from {@link useImageOverlay} or
 * {@link useMultiImageOverlay}.
 */
export const MejiroImageOverlay = defineComponent({
  name: 'MejiroImageOverlay',
  props: {
    /** Position and size of the overlay (px). */
    rect: {
      type: Object as PropType<ImageRect>,
      required: true,
    },
    /** Optional label shown in the body. @defaultValue `messages.imageButton` */
    label: {
      type: String,
    },
  },
  emits: ['overlay-pointerdown', 'resize-pointerdown', 'close'],
  setup(props, { emit }) {
    const messages = useI18n();

    return () =>
      h(
        'div',
        {
          class: 'mejiro-reader-image-overlay',
          style: {
            left: `${props.rect.x}px`,
            top: `${props.rect.y}px`,
            width: `${props.rect.w}px`,
            height: `${props.rect.h}px`,
          },
          onPointerdown: (e: PointerEvent) => emit('overlay-pointerdown', e),
        },
        [
          h('div', { class: 'mejiro-reader-image-overlay-label' }, [
            h('div', { class: 'mejiro-reader-image-overlay-icon' }),
            h('span', null, props.label ?? messages.value.imageButton),
          ]),
          h('div', {
            class: 'mejiro-reader-image-overlay-resize',
            onPointerdown: (e: PointerEvent) => emit('resize-pointerdown', e),
          }),
          h('button', {
            type: 'button',
            class: 'mejiro-reader-image-overlay-close',
            'aria-label': messages.value.imageRemoveButton,
            title: messages.value.imageRemoveButton,
            onPointerdown: (e: PointerEvent) => {
              e.stopPropagation();
              e.preventDefault();
              emit('close');
            },
            onKeydown: (e: KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.stopPropagation();
              e.preventDefault();
              emit('close');
            },
          }),
        ],
      );
  },
});

export type MejiroImageOverlayProps = InstanceType<typeof MejiroImageOverlay>['$props'];
