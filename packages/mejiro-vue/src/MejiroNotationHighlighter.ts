import { tokenizeManuscriptSource } from '@libraz/mejiro';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import { computed, defineComponent, h, type PropType, ref } from 'vue';

/**
 * Vue equivalent of {@link MejiroNotationHighlighter} (React). Renders a
 * textarea with a notation-highlight overlay behind it.
 */
export const MejiroNotationHighlighter = defineComponent({
  name: 'MejiroNotationHighlighter',
  props: {
    /** Source manuscript text. */
    modelValue: { type: String, required: true },
    /** Manuscript notation dialect. @defaultValue `'mejiro'` */
    dialect: { type: String as PropType<ManuscriptDialect>, default: 'mejiro' },
    /** Class on the wrapper element. */
    wrapperClass: { type: String, default: undefined },
    /** Class on the inner textarea. */
    textareaClass: { type: String, default: undefined },
    /** Placeholder for the inner textarea. */
    placeholder: { type: String, default: undefined },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const overlayRef = ref<HTMLDivElement | null>(null);
    const textareaRef = ref<HTMLTextAreaElement | null>(null);

    const segments = computed(() => {
      const tokens = tokenizeManuscriptSource(props.modelValue, props.dialect);
      const out: Array<{ key: string; text: string; kind?: string }> = [];
      let cursor = 0;
      for (const [i, token] of tokens.entries()) {
        if (token.start > cursor) {
          out.push({ key: `t-${i}-pre`, text: props.modelValue.slice(cursor, token.start) });
        }
        out.push({
          key: `t-${i}`,
          text: props.modelValue.slice(token.start, token.end),
          kind: token.kind,
        });
        cursor = token.end;
      }
      if (cursor < props.modelValue.length) {
        out.push({ key: 'tail', text: props.modelValue.slice(cursor) });
      }
      if (out.length === 0) out.push({ key: 'empty', text: props.modelValue });
      return out;
    });

    return () =>
      h(
        'div',
        {
          class: ['mejiro-notation-highlighter', props.wrapperClass].filter(Boolean).join(' '),
        },
        [
          h(
            'div',
            {
              ref: overlayRef,
              class: 'mejiro-notation-overlay',
              'aria-hidden': 'true',
            },
            [
              ...segments.value.map((segment) =>
                h(
                  'span',
                  {
                    key: segment.key,
                    class: segment.kind
                      ? `mejiro-notation-token mejiro-notation-${segment.kind}`
                      : undefined,
                    'data-token': segment.kind,
                  },
                  segment.text,
                ),
              ),
              '​',
            ],
          ),
          h('textarea', {
            ref: textareaRef,
            class: ['mejiro-notation-textarea', props.textareaClass].filter(Boolean).join(' '),
            value: props.modelValue,
            placeholder: props.placeholder,
            spellcheck: false,
            onInput: (event: Event) => {
              emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
            },
            onScroll: (event: Event) => {
              if (overlayRef.value) {
                const t = event.target as HTMLTextAreaElement;
                overlayRef.value.scrollTop = t.scrollTop;
                overlayRef.value.scrollLeft = t.scrollLeft;
              }
            },
          }),
        ],
      );
  },
});

export type MejiroNotationHighlighterProps = InstanceType<
  typeof MejiroNotationHighlighter
>['$props'];
