import type { ImageOverlayRect } from '@libraz/mejiro';
import { defineComponent, h, type PropType } from 'vue';
import { useI18n } from './i18n.js';

/**
 * Placeholder box standing in for an image placed in the text, with drag and
 * resize affordances. Pure presentation — wire its pointer-down events to the
 * handlers of {@link useImageOverlay}.
 */
export const MejiroImagePlaceholder = defineComponent({
  name: 'MejiroImagePlaceholder',
  props: {
    /** Position and size of the placeholder (px). */
    rect: {
      type: Object as PropType<ImageOverlayRect>,
      required: true,
    },
    /** Label shown in the body. @defaultValue `messages.imageButton` */
    label: {
      type: String,
    },
  },
  emits: {
    /** Pointer-down on the body (starts a move). */
    'overlay-pointer-down': (_e: PointerEvent) => true,
    /** Pointer-down on the resize handle. */
    'resize-pointer-down': (_e: PointerEvent) => true,
    /** The remove button was activated. */
    close: () => true,
  },
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
            width: `${props.rect.width}px`,
            height: `${props.rect.height}px`,
          },
          onPointerdown: (e: PointerEvent) => emit('overlay-pointer-down', e),
        },
        [
          h('div', { class: 'mejiro-reader-image-overlay-label' }, [
            h('div', { class: 'mejiro-reader-image-overlay-icon' }),
            h('span', null, props.label ?? messages.value.imageButton),
          ]),
          h('div', {
            class: 'mejiro-reader-image-overlay-resize',
            onPointerdown: (e: PointerEvent) => emit('resize-pointer-down', e),
          }),
          h('button', {
            type: 'button',
            class: 'mejiro-reader-image-overlay-close',
            'aria-label': messages.value.imageRemoveButton,
            title: messages.value.imageRemoveButton,
            // A press here must not start a drag of the overlay it sits on.
            onPointerdown: (e: PointerEvent) => e.stopPropagation(),
            // One path for pointer, keyboard and assistive-technology activation.
            onClick: () => emit('close'),
          }),
        ],
      );
  },
});

/** Props accepted by {@link MejiroImagePlaceholder}. */
export type MejiroImagePlaceholderProps = InstanceType<typeof MejiroImagePlaceholder>['$props'];
