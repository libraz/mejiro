// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { useLibrary } from '../src/useLibrary.js';
import { withSetup } from './helpers/fixtures.js';

const volumes = [
  { id: 'a', label: 'Volume A' },
  { id: 'b', label: 'Volume B' },
];

describe('useLibrary (Vue) — volume selection', () => {
  it('selects a volume by id and reports it through onVolumeChange', () => {
    const onVolumeChange = vi.fn();
    const { result, unmount } = withSetup(() => useLibrary({ volumes, onVolumeChange }));

    result.selectVolume('b');

    expect(result.volume.value).toEqual(volumes[1]);
    expect(result.volumeIndex.value).toBe(1);
    expect(onVolumeChange).toHaveBeenCalledWith(volumes[1]);
    unmount();
  });

  it('names the selection after the volume it holds', () => {
    expectTypeErrors(
      `import { useLibrary } from '@libraz/mejiro-vue';
const state = useLibrary({ volumes: [], onVolumeChange: () => {} });
state.selectVolume('a');
void state.volume.value;
void state.volumeIndex.value;
useLibrary({ volumes: [], onChange: () => {} });
state.goTo('a');
void state.current;
void state.currentIndex;`,
      { fails: ['onChange: ()', 'state.goTo', 'state.current;', 'state.currentIndex'] },
    );
  });
});
