// @vitest-environment happy-dom

import { render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { MejiroShelf } from '../src/MejiroShelf.js';

describe('MejiroShelf (Vue) — selection', () => {
  const shelfVolumes = [
    { id: 'a', label: 'Book A', meta: { n: 1 } },
    { id: 'b', label: 'Book B', meta: { n: 2 }, cover: 'https://cdn.example.test/b.jpg' },
    { id: 'c', label: 'Book C', meta: { n: 3 } },
  ];

  it('emits volume-select with exactly the activated card volume', async () => {
    const { container, emitted } = render(MejiroShelf, { props: { volumes: shelfVolumes } });

    (container.querySelectorAll('.mejiro-shelf-card')[1] as HTMLElement).click();

    expect(emitted()['volume-select']).toEqual([[shelfVolumes[1]]]);
  });

  it('marks only the card whose id equals currentId as active', async () => {
    const { container, rerender } = render(MejiroShelf, {
      props: { volumes: shelfVolumes, currentId: 'c' },
    });
    const active = () =>
      [...container.querySelectorAll('.mejiro-shelf-card.is-active')].map((card) =>
        card.textContent?.trim(),
      );
    expect(active()).toEqual(['Book C']);

    await rerender({ volumes: shelfVolumes, currentId: 'missing' });
    expect(active()).toEqual([]);
  });
});
