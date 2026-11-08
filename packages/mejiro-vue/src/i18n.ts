import {
  enMessages,
  type MejiroLocale,
  type MejiroMessages,
  resolveMessages,
} from '@libraz/mejiro';
import { type ComputedRef, computed, defineComponent, inject, type PropType, provide } from 'vue';

export { enMessages, formatMessage, jaMessages, resolveMessages } from '@libraz/mejiro';
export type { MejiroLocale, MejiroMessages };

const INJECTION_KEY = Symbol.for('@libraz/mejiro-vue:messages');

/** Provider component that scopes a message catalog to its descendants. */
export const MejiroI18nProvider = defineComponent({
  name: 'MejiroI18nProvider',
  props: {
    /** Built-in locale used as the base catalog. Defaults to the enclosing provider's catalog. */
    locale: { type: String as PropType<MejiroLocale>, default: undefined },
    /** Overrides merged on top of the base catalog. */
    messages: { type: Object as PropType<Partial<MejiroMessages>>, default: undefined },
  },
  setup(props, { slots }) {
    const provided = inject<ComputedRef<MejiroMessages> | undefined>(INJECTION_KEY, undefined);
    provide(
      INJECTION_KEY,
      computed(() => resolveMessages(props.locale, props.messages, provided?.value)),
    );
    return () => (slots.default ? slots.default() : null);
  },
});

/** Props accepted by {@link MejiroI18nProvider}. */
export type MejiroI18nProviderProps = InstanceType<typeof MejiroI18nProvider>['$props'];

/** Options for {@link useI18n}. */
export interface UseI18nOptions {
  /**
   * Built-in locale to use as the base catalog. Defaults to the nearest
   * `MejiroI18nProvider` locale, or `'en'` without one.
   */
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
    return resolveMessages(options.locale, options.messages, provided?.value);
  });
}
