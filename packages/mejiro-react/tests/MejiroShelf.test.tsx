// @vitest-environment happy-dom
/** @jsxImportSource react */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MejiroShelf } from '../src/MejiroShelf.js';

describe('MejiroShelf (React) — selection', () => {
  const shelfVolumes = [
    { id: 'a', label: 'Book A', meta: { n: 1 } },
    { id: 'b', label: 'Book B', meta: { n: 2 }, cover: 'https://cdn.example.test/b.jpg' },
    { id: 'c', label: 'Book C', meta: { n: 3 } },
  ];

  it('reports the activated card with exactly its volume', () => {
    const onVolumeSelect = vi.fn();
    const { container } = render(
      <MejiroShelf volumes={shelfVolumes} onVolumeSelect={onVolumeSelect} />,
    );

    fireEvent.click(container.querySelectorAll('.mejiro-shelf-card')[1] as HTMLElement);

    expect(onVolumeSelect).toHaveBeenCalledTimes(1);
    expect(onVolumeSelect).toHaveBeenCalledWith(shelfVolumes[1]);
  });

  it('marks only the card whose id equals currentId as active', () => {
    const { container, rerender } = render(<MejiroShelf volumes={shelfVolumes} currentId="c" />);
    const active = () =>
      [...container.querySelectorAll('.mejiro-shelf-card.is-active')].map((card) =>
        card.textContent?.trim(),
      );
    expect(active()).toEqual(['Book C']);

    rerender(<MejiroShelf volumes={shelfVolumes} currentId="missing" />);
    expect(active()).toEqual([]);
  });
});
