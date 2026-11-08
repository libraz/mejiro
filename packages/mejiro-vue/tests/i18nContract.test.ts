// @vitest-environment happy-dom

import * as core from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import * as vue from '../src/i18n.js';

describe('i18n (Vue) — core catalog helpers', () => {
  it('re-exports the core catalog helpers and frozen catalogs as they are', () => {
    expect(vue.resolveMessages).toBe(core.resolveMessages);
    expect(vue.formatMessage).toBe(core.formatMessage);
    expect(vue.enMessages).toBe(core.enMessages);
    expect(vue.jaMessages).toBe(core.jaMessages);
    expect(Object.isFrozen(vue.jaMessages)).toBe(true);
    expect('format' in vue).toBe(false);
  });

  it('types the helpers like the core ones and names the provider props', () => {
    expectTypeErrors(
      `import { enMessages, formatMessage, type MejiroI18nProviderProps, jaMessages, resolveMessages } from '@libraz/mejiro-vue';
const messages = resolveMessages('ja', undefined, enMessages);
const text: string = formatMessage(messages.chapterN, { n: 1 });
void text;
const props: MejiroI18nProviderProps = { locale: 'en' };
void props;
jaMessages.tocTitle = 'x';
import { format } from '@libraz/mejiro-vue';`,
      { fails: ["jaMessages.tocTitle = 'x'", 'import { format }'] },
    );
  });
});
