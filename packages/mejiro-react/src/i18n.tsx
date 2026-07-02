import {
  enMessages,
  formatMessage,
  type MejiroLocale,
  type MejiroMessages,
  messageCatalogs,
  resolveMessages as resolveCoreMessages,
} from '@libraz/mejiro';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

export { enMessages, jaMessages } from '@libraz/mejiro';
export type { MejiroLocale, MejiroMessages };

const I18nContext = createContext<MejiroMessages>(enMessages);

/** Provider that scopes a message catalog to its descendants. */
export function MejiroI18nProvider({
  locale,
  messages,
  children,
}: {
  locale?: MejiroLocale;
  messages?: Partial<MejiroMessages>;
  children: ReactNode;
}): ReactNode {
  const fromContext = useContext(I18nContext);
  const value = useMemo(
    () => resolveCoreMessages(locale, messages, locale != null ? enMessages : fromContext),
    [locale, messages, fromContext],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Options for {@link useI18n}. */
export interface UseI18nOptions {
  /** Built-in locale to use as the base catalog. @defaultValue 'en' */
  locale?: MejiroLocale;
  /** Overrides merged on top of the built-in catalog. */
  messages?: Partial<MejiroMessages>;
}

/**
 * Returns the resolved `MejiroMessages` catalog. With no arguments the
 * catalog provided by the nearest {@link MejiroI18nProvider} is returned;
 * passing `locale` / `messages` resolves a catalog without context.
 */
export function useI18n(options: UseI18nOptions = {}): MejiroMessages {
  const fromContext = useContext(I18nContext);
  const { locale, messages } = options;
  return useMemo(() => {
    if (locale == null && messages == null) return fromContext;
    return resolveCoreMessages(locale, messages, fromContext);
  }, [locale, messages, fromContext]);
}

/** Build a catalog without invoking React (useful in plain modules). */
export function resolveMessages(
  locale: MejiroLocale | undefined,
  overrides: Partial<MejiroMessages> | undefined,
): MejiroMessages {
  return resolveCoreMessages(locale, overrides);
}

/** Replace `{name}` placeholders in a template. */
export function format(template: string, vars: Record<string, string | number>): string {
  return formatMessage(template, vars);
}

export const CATALOGS: Record<MejiroLocale, MejiroMessages> = messageCatalogs;
