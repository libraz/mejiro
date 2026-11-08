// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { useLibrary } from '../src/useLibrary.js';

const volumes = [
  { id: 'a', label: 'Volume A' },
  { id: 'b', label: 'Volume B' },
  { id: 'c', label: 'Volume C' },
];

function harness<T>(setup: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T };
  const TestComponent = defineComponent({
    setup() {
      result.current = setup();
      return () => h('div');
    },
  });
  mount(TestComponent);
  return { result };
}

describe('useLibrary (Vue)', () => {
  it('starts on the first volume by default', () => {
    const { result } = harness(() => useLibrary({ volumes }));
    expect(result.current.volumeIndex.value).toBe(0);
    expect(result.current.volume.value?.id).toBe('a');
  });

  it('honors initialVolumeId', () => {
    const { result } = harness(() => useLibrary({ volumes, initialVolumeId: 'c' }));
    expect(result.current.volumeIndex.value).toBe(2);
  });

  it('next / prev / selectVolume and onVolumeChange', () => {
    const onVolumeChange = vi.fn();
    const { result } = harness(() => useLibrary({ volumes, onVolumeChange }));
    result.current.next();
    expect(result.current.volume.value?.id).toBe('b');
    expect(onVolumeChange).toHaveBeenLastCalledWith(volumes[1]);
    result.current.selectVolume('c');
    expect(result.current.volume.value?.id).toBe('c');
    result.current.prev();
    expect(result.current.volume.value?.id).toBe('b');
    expect(onVolumeChange).toHaveBeenCalledTimes(3);
  });

  it('returns a null volume for an empty library', () => {
    const { result } = harness(() => useLibrary({ volumes: [] }));
    expect(result.current.volume.value).toBeNull();
    expect(result.current.volumeIndex.value).toBe(-1);
  });

  it('keeps selection by id when volumes are replaced and resets on empty lists', async () => {
    const list = ref(volumes);
    const { result } = harness(() => useLibrary({ volumes: list }));

    result.current.selectVolume('c');
    const reordered = [volumes[2], volumes[1], volumes[0]];
    list.value = reordered;
    await nextTick();

    expect(result.current.volume.value?.id).toBe('c');
    expect(result.current.volumeIndex.value).toBe(0);

    list.value = [];
    await nextTick();
    expect(result.current.volume.value).toBeNull();
    expect(result.current.volumeIndex.value).toBe(-1);
  });

  it('falls back immediately when the selected volume disappears', () => {
    const list = ref(volumes);
    const onVolumeChange = vi.fn();
    const { result } = harness(() => useLibrary({ volumes: list, onVolumeChange }));

    result.current.selectVolume('c');
    list.value = [volumes[0], volumes[1]];

    expect(result.current.volume.value?.id).toBe('a');
    expect(result.current.volumeIndex.value).toBe(0);
    expect(onVolumeChange).toHaveBeenLastCalledWith(volumes[0]);
  });

  it('opens initialVolumeId once a list arriving after mount contains it', () => {
    const list = ref<typeof volumes>([]);
    const onVolumeChange = vi.fn();
    const { result } = harness(() =>
      useLibrary({ volumes: list, initialVolumeId: 'c', onVolumeChange }),
    );
    expect(result.current.volume.value).toBeNull();

    list.value = volumes;

    expect(result.current.volume.value?.id).toBe('c');
    expect(result.current.volumeIndex.value).toBe(2);
    expect(onVolumeChange).toHaveBeenCalledTimes(1);
    expect(onVolumeChange).toHaveBeenLastCalledWith(volumes[2]);
  });

  it('switches to initialVolumeId when a later list adds it, until the user navigates', () => {
    const list = ref([volumes[0], volumes[1]]);
    const { result } = harness(() => useLibrary({ volumes: list, initialVolumeId: 'c' }));
    expect(result.current.volume.value?.id).toBe('a');

    list.value = volumes;
    expect(result.current.volume.value?.id).toBe('c');

    result.current.selectVolume('a');
    list.value = [...volumes];
    expect(result.current.volume.value?.id).toBe('a');
  });

  it('re-resolves the current volume when a reactive array is mutated in place', () => {
    const list = ref([...volumes]);
    const onVolumeChange = vi.fn();
    const { result } = harness(() => useLibrary({ volumes: list, onVolumeChange }));
    result.current.selectVolume('b');
    onVolumeChange.mockClear();

    list.value.splice(1, 1);

    expect(result.current.volume.value?.id).toBe('a');
    expect(result.current.volumeIndex.value).toBe(0);
    expect(onVolumeChange).toHaveBeenCalledTimes(1);
    expect(onVolumeChange).toHaveBeenLastCalledWith(volumes[0]);

    result.current.next();
    expect(result.current.volume.value?.id).toBe('c');
  });

  it('opens initialVolumeId pushed into a reactive array after mount', () => {
    const list = ref<typeof volumes>([]);
    const { result } = harness(() => useLibrary({ volumes: list, initialVolumeId: 'b' }));

    list.value.push(...volumes);

    expect(result.current.volume.value?.id).toBe('b');
  });
});
