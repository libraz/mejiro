// @vitest-environment happy-dom

import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroChapterNav } from '../src/MejiroChapterNav.js';
import { fakeEpub } from './helpers/fixtures.js';

describe('MejiroChapterNav (Vue) — chapter picker', () => {
  it('binds the chapter through v-model:chapter-index', () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroChapterNav, {
      props: { epub: fakeEpub(), chapterIndex: 1, 'onUpdate:chapterIndex': onUpdate },
    });
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('1');

    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onUpdate).toHaveBeenCalledWith(2);
  });

  it('takes chapterIndex and drops the bare chapter prop', () => {
    expectTypeErrors(
      `import type { EpubBook } from '@libraz/mejiro/epub';
import type { MejiroChapterNavProps } from '@libraz/mejiro-vue';
declare const epub: EpubBook;
const ok: MejiroChapterNavProps = { epub, chapterIndex: 0, 'onUpdate:chapterIndex': (index: number) => void index };
void ok;
const p1: MejiroChapterNavProps = { epub, chapter: 0 };
const p2: MejiroChapterNavProps = { epub, chapterIndex: 0, 'onUpdate:chapterIndex': (index: string) => void index };`,
      { fails: ['const p1', 'const p2'] },
    );
  });
});
