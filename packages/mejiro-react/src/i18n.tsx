import {
  enMessages,
  type MejiroLocale,
  type MejiroMessages,
  messageCatalogs,
  resolveMessages,
} from '@libraz/mejiro';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

export { enMessages, formatMessage, jaMessages, resolveMessages } from '@libraz/mejiro';
export type { MejiroLocale, MejiroMessages };

const I18nContext = createContext<MejiroMessages>(enMessages);

/** Props for {@link MejiroI18nProvider}. */
export interface MejiroI18nProviderProps {
  /**
   * Built-in locale to use as the base catalog. Without it the catalog of the
   * enclosing provider is the base, or the English catalog at the top level.
   */
  locale?: MejiroLocale;
  /** Overrides merged on top of the base catalog. */
  messages?: Partial<MejiroMessages>;
  /** Subtree the catalog applies to. */
  children: ReactNode;
}

/** Provider that scopes a message catalog to its descendants. */
export function MejiroI18nProvider({
  locale,
  messages,
  children,
}: MejiroI18nProviderProps): ReactNode {
  const fromContext = useContext(I18nContext);
  const value = useMemo(
    () => resolveMessages(locale, messages, locale != null ? enMessages : fromContext),
    [locale, messages, fromContext],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

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
 * Returns the resolved `MejiroMessages` catalog. With no arguments the
 * catalog provided by the nearest {@link MejiroI18nProvider} is returned;
 * passing `locale` / `messages` resolves a catalog without context.
 */
export function useI18n(options: UseI18nOptions = {}): MejiroMessages {
  const fromContext = useContext(I18nContext);
  const { locale, messages } = options;
  return useMemo(() => {
    if (locale == null && messages == null) return fromContext;
    return resolveMessages(locale, messages, fromContext);
  }, [locale, messages, fromContext]);
}

/** Built-in message catalogs, keyed by locale. */
export const CATALOGS: Record<MejiroLocale, MejiroMessages> = messageCatalogs;
