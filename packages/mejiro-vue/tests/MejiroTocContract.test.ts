// @vitest-environment happy-dom

import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroToc } from '../src/MejiroToc.js';
import { fakeEpub } from './helpers/fixtures.js';

describe('MejiroToc (Vue) — chapter selection', () => {
  it('shows the search field with showSearch and reports the picked chapter index', () => {
    const onChapterSelect = vi.fn();
    const { container } = render(MejiroToc, {
      props: {
        epub: fakeEpub(),
        showSearch: true,
        currentAnchor: { chapterIndex: 1, paragraphIndex: 0, charIndex: 0 },
        onChapterSelect,
      },
    });

    expect(container.querySelector('input[type="search"]')).not.toBeNull();
    const links = container.querySelectorAll<HTMLButtonElement>('.mejiro-toc-link');
    expect(links[1].classList.contains('is-active')).toBe(true);
    links[2].click();
    expect(onChapterSelect).toHaveBeenCalledWith(2);
  });

  it('names the toggle and the event after what they do', () => {
    expectTypeErrors(
      `import type { EpubBook } from '@libraz/mejiro/epub';
import type { MejiroTocProps } from '@libraz/mejiro-vue';
declare const epub: EpubBook;
const ok: MejiroTocProps = { epub, showSearch: true, 'onChapter-select': (chapterIndex: number) => void chapterIndex };
void ok;
const p1: MejiroTocProps = { epub, searchable: true };
const p2: MejiroTocProps = { epub, onSelect: () => {} };`,
      { fails: ['const p1', 'const p2'] },
    );
  });
});
