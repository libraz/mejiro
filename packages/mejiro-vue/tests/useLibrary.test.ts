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
    expect(result.current.currentIndex.value).toBe(0);
    expect(result.current.current.value?.id).toBe('a');
  });

  it('honors initialVolumeId', () => {
    const { result } = harness(() => useLibrary({ volumes, initialVolumeId: 'c' }));
    expect(result.current.currentIndex.value).toBe(2);
  });

  it('next / prev / goTo and onChange', () => {
    const onChange = vi.fn();
    const { result } = harness(() => useLibrary({ volumes, onChange }));
    result.current.next();
    expect(result.current.current.value?.id).toBe('b');
    expect(onChange).toHaveBeenLastCalledWith(volumes[1]);
    result.current.goTo('c');
    expect(result.current.current.value?.id).toBe('c');
    result.current.prev();
    expect(result.current.current.value?.id).toBe('b');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('returns null current for an empty library', () => {
    const { result } = harness(() => useLibrary({ volumes: [] }));
    expect(result.current.current.value).toBeNull();
    expect(result.current.currentIndex.value).toBe(-1);
  });

  it('keeps selection by id when volumes are replaced and resets on empty lists', async () => {
    const list = ref(volumes);
    const { result } = harness(() => useLibrary({ volumes: list }));

    result.current.goTo('c');
    const reordered = [volumes[2], volumes[1], volumes[0]];
    list.value = reordered;
    await nextTick();

    expect(result.current.current.value?.id).toBe('c');
    expect(result.current.currentIndex.value).toBe(0);

    list.value = [];
    await nextTick();
    expect(result.current.current.value).toBeNull();
    expect(result.current.currentIndex.value).toBe(-1);
  });

  it('falls back immediately when the selected volume disappears', () => {
    const list = ref(volumes);
    const onChange = vi.fn();
    const { result } = harness(() => useLibrary({ volumes: list, onChange }));

    result.current.goTo('c');
    list.value = [volumes[0], volumes[1]];

    expect(result.current.current.value?.id).toBe('a');
    expect(result.current.currentIndex.value).toBe(0);
    expect(onChange).toHaveBeenLastCalledWith(volumes[0]);
  });

  it('opens initialVolumeId once a list arriving after mount contains it', () => {
    const list = ref<typeof volumes>([]);
    const onChange = vi.fn();
    const { result } = harness(() => useLibrary({ volumes: list, initialVolumeId: 'c', onChange }));
    expect(result.current.current.value).toBeNull();

    list.value = volumes;

    expect(result.current.current.value?.id).toBe('c');
    expect(result.current.currentIndex.value).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(volumes[2]);
  });

  it('switches to initialVolumeId when a later list adds it, until the user navigates', () => {
    const list = ref([volumes[0], volumes[1]]);
    const { result } = harness(() => useLibrary({ volumes: list, initialVolumeId: 'c' }));
    expect(result.current.current.value?.id).toBe('a');

    list.value = volumes;
    expect(result.current.current.value?.id).toBe('c');

    result.current.goTo('a');
    list.value = [...volumes];
    expect(result.current.current.value?.id).toBe('a');
  });

  it('re-resolves the current volume when a reactive array is mutated in place', () => {
    const list = ref([...volumes]);
    const onChange = vi.fn();
    const { result } = harness(() => useLibrary({ volumes: list, onChange }));
    result.current.goTo('b');
    onChange.mockClear();

    list.value.splice(1, 1);

    expect(result.current.current.value?.id).toBe('a');
    expect(result.current.currentIndex.value).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(volumes[0]);

    result.current.next();
    expect(result.current.current.value?.id).toBe('c');
  });

  it('opens initialVolumeId pushed into a reactive array after mount', () => {
    const list = ref<typeof volumes>([]);
    const { result } = harness(() => useLibrary({ volumes: list, initialVolumeId: 'b' }));

    list.value.push(...volumes);

    expect(result.current.current.value?.id).toBe('b');
  });
});
