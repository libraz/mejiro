import { defineComponent, h, type PropType, ref } from 'vue';
import { useI18n } from './i18n.js';

/**
 * Drop zone for EPUB files. Combines a drag-and-drop target with a
 * click-to-open file picker. Emits `file` once a file is selected.
 *
 * Renders default placeholder content unless a `default` slot is provided.
 */
export const MejiroDropZone = defineComponent({
  name: 'MejiroDropZone',
  props: {
    /** File `accept` filter for the hidden input. @defaultValue '.epub' */
    accept: {
      type: String,
      default: '.epub',
    },
    /** Predicate used to validate dropped files. Defaults to `.epub` filter. */
    validateFile: {
      type: Function as PropType<(file: File) => boolean>,
    },
  },
  emits: {
    /** Emitted when a file is dropped or selected via the dialog. */
    file: (file: File) => file instanceof File,
  },
  setup(props, { emit, slots }) {
    const messages = useI18n();
    const input = ref<HTMLInputElement | null>(null);
    const dragover = ref(false);

    const isValid = (file: File): boolean => {
      if (props.validateFile) return props.validateFile(file);
      return file.name.endsWith('.epub');
    };

    function openPicker(): void {
      input.value?.click();
    }
    function onChange(e: Event): void {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file && isValid(file)) emit('file', file);
    }
    function onDragOver(e: DragEvent): void {
      e.preventDefault();
      dragover.value = true;
    }
    function onDragLeave(): void {
      dragover.value = false;
    }
    function onDrop(e: DragEvent): void {
      e.preventDefault();
      dragover.value = false;
      const file = e.dataTransfer?.files[0];
      if (file && isValid(file)) emit('file', file);
    }

    return () =>
      h(
        'div',
        {
          class: ['mejiro-reader-drop-zone', { 'is-dragover': dragover.value }],
          onClick: openPicker,
          onDragover: onDragOver,
          onDragleave: onDragLeave,
          onDrop,
        },
        [
          slots.default
            ? slots.default()
            : [
                h('div', { class: 'mejiro-reader-drop-zone-icon' }, '\u{1F4D6}'),
                h('div', { class: 'mejiro-reader-drop-zone-text' }, [
                  h('strong', null, messages.value.dropZoneTitle),
                ]),
                h('div', { class: 'mejiro-reader-drop-zone-hint' }, messages.value.dropZoneHint),
              ],
          h('input', {
            ref: input,
            type: 'file',
            accept: props.accept,
            hidden: true,
            onChange,
          }),
        ],
      );
  },
});

export type MejiroDropZoneProps = InstanceType<typeof MejiroDropZone>['$props'];
