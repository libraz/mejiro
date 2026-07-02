import {
  enMessages,
  formatMessage,
  type MejiroLocale,
  type MejiroMessages,
  resolveMessages as resolveCoreMessages,
} from '@libraz/mejiro';
import { type ComputedRef, computed, defineComponent, inject, type PropType, provide } from 'vue';

export { enMessages, jaMessages } from '@libraz/mejiro';
export type { MejiroLocale, MejiroMessages };

const INJECTION_KEY = Symbol.for('@libraz/mejiro-vue:messages');

/** Build a catalog without using Vue context. */
export function resolveMessages(
  locale: MejiroLocale | undefined,
  overrides: Partial<MejiroMessages> | undefined,
): MejiroMessages {
  return resolveCoreMessages(locale, overrides);
}

/** Provider component that scopes a message catalog to its descendants. */
export const MejiroI18nProvider = defineComponent({
  name: 'MejiroI18nProvider',
  props: {
    locale: { type: String as PropType<MejiroLocale>, default: undefined },
    messages: { type: Object as PropType<Partial<MejiroMessages>>, default: undefined },
  },
  setup(props, { slots }) {
    const provided = inject<ComputedRef<MejiroMessages> | undefined>(INJECTION_KEY, undefined);
    provide(
      INJECTION_KEY,
      computed(() => resolveCoreMessages(props.locale, props.messages, provided?.value)),
    );
    return () => (slots.default ? slots.default() : null);
  },
});

/** Options for {@link useI18n}. */
export interface UseI18nOptions {
  /** Built-in locale to use as the base catalog. @defaultValue 'en' */
  locale?: MejiroLocale;
  /** Overrides merged on top of the built-in catalog. */
  messages?: Partial<MejiroMessages>;
}

/**
 * Returns a reactive `MejiroMessages` catalog. With no arguments the catalog
 * provided by the nearest {@link MejiroI18nProvider} is returned; passing
 * `locale` / `messages` resolves a catalog locally.
 */
export function useI18n(options: UseI18nOptions = {}): ComputedRef<MejiroMessages> {
  const provided = inject<ComputedRef<MejiroMessages> | undefined>(INJECTION_KEY, undefined);
  return computed(() => {
    if (options.locale == null && options.messages == null) {
      return provided?.value ?? enMessages;
    }
    return resolveCoreMessages(options.locale, options.messages, provided?.value);
  });
}

/** Replace `{name}` placeholders in a template. */
export function format(template: string, vars: Record<string, string | number>): string {
  return formatMessage(template, vars);
}
