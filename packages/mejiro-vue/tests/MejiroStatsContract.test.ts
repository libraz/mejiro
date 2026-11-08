// @vitest-environment happy-dom

import { enMessages, jaMessages } from '@libraz/mejiro';
import { estimateReadingTime, formatReadingTime } from '@libraz/mejiro/book';
import type { EpubChapter } from '@libraz/mejiro/epub';
import { render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroI18nProvider } from '../src/i18n.js';
import { MejiroStats } from '../src/MejiroStats.js';

const chapter: EpubChapter = {
  title: 'C',
  paragraphs: [{ text: 'あ'.repeat(90), inlineAnnotations: [] }],
};

function statsText(container: Element): string {
  return container.querySelector('.mejiro-reader-stats')?.textContent ?? '';
}

describe('MejiroStats (Vue) — reading time', () => {
  it('spells the reading time in the provider locale at charsPerMinute', () => {
    const ms = estimateReadingTime(chapter, { charsPerMinute: 60 });
    const Wrapped = defineComponent({
      setup: () => () =>
        h(MejiroI18nProvider, { locale: 'en' }, () =>
          h(MejiroStats, { chapter, pageCount: 3, showReadingTime: true, charsPerMinute: 60 }),
        ),
    });
    const text = statsText(render(Wrapped).container);

    expect(text).toContain('3pp');
    expect(text).toContain(formatReadingTime(ms, { messages: enMessages }));
  });

  it('uses the locale prop over the provider', () => {
    const ms = estimateReadingTime(chapter, { charsPerMinute: 60 });
    const Wrapped = defineComponent({
      setup: () => () =>
        h(MejiroI18nProvider, { locale: 'en' }, () =>
          h(MejiroStats, { chapter, showReadingTime: true, charsPerMinute: 60, locale: 'ja' }),
        ),
    });

    expect(statsText(render(Wrapped).container)).toContain(
      formatReadingTime(ms, { messages: jaMessages }),
    );
  });

  it('takes pageCount and charsPerMinute and drops the old names', () => {
    expectTypeErrors(
      `import type { MejiroStatsProps } from '@libraz/mejiro-vue';
const ok: MejiroStatsProps = { pageCount: 1, charsPerMinute: 400, locale: 'en' };
void ok;
const p1: MejiroStatsProps = { totalPages: 1 };
const p2: MejiroStatsProps = { cpm: 400 };
const p3: MejiroStatsProps = { readingTimeLocale: 'en' };`,
      { fails: ['const p1', 'const p2', 'const p3'] },
    );
  });
});
