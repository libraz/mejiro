import { tokenizeManuscriptSource } from '@libraz/mejiro';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import { computed, defineComponent, h, type PropType, ref, type StyleValue } from 'vue';

/**
 * Manuscript textarea with a notation-highlight overlay behind it. Bind the
 * source text with `v-model:value`; other attributes and listeners —
 * `class` and `placeholder` included — go to the textarea.
 */
export const MejiroNotationHighlighter = defineComponent({
  name: 'MejiroNotationHighlighter',
  inheritAttrs: false,
  props: {
    /** Source manuscript text. */
    value: { type: String, required: true },
    /** Manuscript notation dialect. @defaultValue `'mejiro'` */
    dialect: { type: String as PropType<ManuscriptDialect>, default: 'mejiro' },
    /** Class on the wrapper element. */
    wrapperClass: { type: String, default: undefined },
    /** Inline style on the wrapper element. */
    wrapperStyle: { type: [String, Object, Array] as PropType<StyleValue>, default: undefined },
  },
  emits: {
    /** The text changed; carries the next source text. */
    'update:value': (_value: string) => true,
  },
  setup(props, { attrs, emit }) {
    const overlayRef = ref<HTMLDivElement | null>(null);
    const textareaRef = ref<HTMLTextAreaElement | null>(null);

    // IME composition freeze: while an IME session is open the overlay keeps
    // the segments it had at compositionstart, and the textarea is bound to
    // the text the browser itself holds so that a host normalizing the model
    // value cannot overwrite the uncommitted string.
    const isComposing = ref(false);
    const composingValue = ref('');
    const boundValue = computed(() => (isComposing.value ? composingValue.value : props.value));

    let lastSegments: Segment[] | null = null;
    const segments = computed<Segment[]>(() => {
      if (isComposing.value && lastSegments) return lastSegments;
      const next = buildSegments(props.value, props.dialect);
      lastSegments = next;
      return next;
    });

    function callAttrHandler(handler: unknown, event: Event): void {
      if (Array.isArray(handler)) {
        for (const fn of handler) callAttrHandler(fn, event);
        return;
      }
      if (typeof handler === 'function') {
        (handler as (event: Event) => void)(event);
      }
    }

    return () =>
      h(
        'div',
        {
          class: ['mejiro-notation-highlighter', props.wrapperClass].filter(Boolean).join(' '),
          style: props.wrapperStyle,
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
            ...attrs,
            ref: textareaRef,
            class: ['mejiro-notation-textarea', attrs.class],
            value: boundValue.value,
            spellcheck: false,
            onInput: (event: Event) => {
              const next = (event.target as HTMLTextAreaElement).value;
              if (isComposing.value) composingValue.value = next;
              emit('update:value', next);
              callAttrHandler(attrs.onInput, event);
            },
            onCompositionstart: (event: CompositionEvent) => {
              composingValue.value = (event.target as HTMLTextAreaElement).value;
              isComposing.value = true;
              callAttrHandler(attrs.onCompositionstart, event);
            },
            onCompositionend: (event: CompositionEvent) => {
              isComposing.value = false;
              const next = (event.target as HTMLTextAreaElement).value;
              composingValue.value = next;
              emit('update:value', next);
              callAttrHandler(attrs.onCompositionend, event);
            },
            onScroll: (event: Event) => {
              if (overlayRef.value) {
                const t = event.target as HTMLTextAreaElement;
                overlayRef.value.scrollTop = t.scrollTop;
                overlayRef.value.scrollLeft = t.scrollLeft;
              }
              callAttrHandler(attrs.onScroll, event);
            },
          }),
        ],
      );
  },
});

/** Props accepted by {@link MejiroNotationHighlighter}. */
export type MejiroNotationHighlighterProps = InstanceType<
  typeof MejiroNotationHighlighter
>['$props'];

interface Segment {
  key: string;
  text: string;
  kind?: string;
}

function buildSegments(text: string, dialect: ManuscriptDialect): Segment[] {
  const tokens = tokenizeManuscriptSource(text, dialect);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [i, token] of tokens.entries()) {
    if (token.startOffset > cursor) {
      segments.push({ key: `t-${i}-pre`, text: text.slice(cursor, token.startOffset) });
    }
    segments.push({
      key: `t-${i}`,
      text: text.slice(token.startOffset, token.endOffset),
      kind: token.kind,
    });
    cursor = token.endOffset;
  }
  if (cursor < text.length) {
    segments.push({ key: 'tail', text: text.slice(cursor) });
  }
  if (segments.length === 0) {
    segments.push({ key: 'empty', text });
  }
  return segments;
}
