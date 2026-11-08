import { defineComponent, h, type PropType, ref } from 'vue';
import { useI18n } from './i18n.js';

/**
 * Applies an `accept` filter the way the file picker does: extensions match
 * case-insensitively, `type/*` matches a MIME family, anything else an exact type.
 */
function matchesAccept(accept: string, file: File): boolean {
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

/**
 * Drop zone for EPUB files. Combines a drag-and-drop target with a
 * click-to-open file picker. Emits `file` once an acceptable file is
 * selected, and `reject` for one that is not.
 *
 * The root is a real button, so it is reachable with Tab, announced as a
 * control by screen readers, and opens the picker on Enter / Space.
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
    /**
     * Predicate that decides which picked or dropped files are accepted, in
     * place of the `accept` filter. Without it the `accept` filter decides,
     * with extensions matched case-insensitively.
     */
    validateFile: {
      type: Function as PropType<(file: File) => boolean>,
    },
  },
  emits: {
    /** Emitted when an acceptable file is dropped or selected via the dialog. */
    file: (file: File) => file instanceof File,
    /**
     * Emitted for a dropped or selected file that is not accepted: `'type'`
     * when it is outside the `accept` filter, `'validation'` when
     * `validateFile` refused it.
     */
    reject: (file: File, _reason: 'type' | 'validation') => file instanceof File,
  },
  setup(props, { emit, slots }) {
    const messages = useI18n();
    const input = ref<HTMLInputElement | null>(null);
    const dragover = ref(false);

    function deliver(file: File): void {
      if (props.validateFile) {
        if (props.validateFile(file)) emit('file', file);
        else emit('reject', file, 'validation');
      } else if (matchesAccept(props.accept, file)) {
        emit('file', file);
      } else {
        emit('reject', file, 'type');
      }
    }

    function openPicker(): void {
      input.value?.click();
    }
    function onKeydown(e: KeyboardEvent): void {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // Cancel the browser's own activation so the picker opens exactly once.
      e.preventDefault();
      openPicker();
    }
    function onChange(e: Event): void {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      // Cleared so picking the same file again still fires `change`.
      target.value = '';
      if (file) deliver(file);
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
      if (file) deliver(file);
    }

    return () =>
      h(
        'button',
        {
          type: 'button',
          class: ['mejiro-reader-drop-zone', { 'is-dragover': dragover.value }],
          onClick: openPicker,
          onKeydown,
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

/** Props accepted by {@link MejiroDropZone}. */
export type MejiroDropZoneProps = InstanceType<typeof MejiroDropZone>['$props'];
