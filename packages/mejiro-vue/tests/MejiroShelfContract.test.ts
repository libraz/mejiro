// @vitest-environment happy-dom

import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroShelf } from '../src/MejiroShelf.js';
import type { VolumeInfo } from '../src/useLibrary.js';

describe('MejiroShelf (Vue) — volume selection', () => {
  it('reports the activated card through volume-select', () => {
    const volumes: readonly VolumeInfo[] = [
      { id: 'a', label: 'Book A' },
      { id: 'b', label: 'Book B' },
    ];
    const onVolumeSelect = vi.fn();
    const { container } = render(MejiroShelf, { props: { volumes, onVolumeSelect } });

    (container.querySelectorAll('.mejiro-shelf-card')[1] as HTMLElement).click();

    expect(onVolumeSelect).toHaveBeenCalledWith(volumes[1]);
  });

  it('takes read-only volume lists and drops the select event', () => {
    expectTypeErrors(
      `import type { MejiroShelfProps, VolumeInfo } from '@libraz/mejiro-vue';
const volumes: readonly VolumeInfo[] = [];
const ok: MejiroShelfProps = { volumes, 'onVolume-select': (volume: VolumeInfo) => void volume };
void ok;
const p1: MejiroShelfProps = { volumes, onSelect: () => {} };`,
      { fails: ['const p1'] },
    );
  });
});
