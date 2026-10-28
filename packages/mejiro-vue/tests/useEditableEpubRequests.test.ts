// @vitest-environment happy-dom

import type { EditableEpub } from '@libraz/mejiro/epub';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';

const loadMock = vi.hoisted(() => vi.fn());

vi.mock('@libraz/mejiro/epub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@libraz/mejiro/epub')>()),
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public class.
  EditableEpub: { load: loadMock },
}));

import { type UseEditableEpubOptions, useEditableEpub } from '../src/useEditableEpub.js';

/** A promise settled from outside. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function stubEditor(): EditableEpub {
  return {
    book: { chapters: [], packageData: { files: new Map() } },
    export: vi.fn(async () => new ArrayBuffer(1)),
  } as unknown as EditableEpub;
}

function harness(options: UseEditableEpubOptions) {
  const result = { current: undefined as unknown as ReturnType<typeof useEditableEpub> };
  const wrapper = mount(
    defineComponent({
      setup() {
        result.current = useEditableEpub(options);
        return () => h('div');
      },
    }),
  );
  return { result, wrapper };
}

afterEach(() => {
  vi.restoreAllMocks();
  loadMock.mockReset();
});

describe('useEditableEpub (Vue) — abandoned loads', () => {
  it('delivers no onLoad for a load still in flight at unmount', async () => {
    const pending = deferred<EditableEpub>();
    loadMock.mockReturnValue(pending.promise);
    const onLoad = vi.fn();
    const { result, wrapper } = harness({ onLoad });

    void result.current.loadBuffer(new ArrayBuffer(8));
    wrapper.unmount();
    pending.resolve(stubEditor());
    await flushPromises();

    expect(onLoad).not.toHaveBeenCalled();
  });

  it('delivers no onError for a failing load still in flight at unmount', async () => {
    const pending = deferred<EditableEpub>();
    loadMock.mockReturnValue(pending.promise.then(() => Promise.reject(new Error('bad'))));
    const onError = vi.fn();
    const { result, wrapper } = harness({ onError });

    void result.current.loadBuffer(new ArrayBuffer(8));
    wrapper.unmount();
    pending.resolve(stubEditor());
    await flushPromises();

    expect(onError).not.toHaveBeenCalled();
  });

  it('abandons a defaultUrl load when the URL is cleared mid-flight', async () => {
    const pending = deferred<EditableEpub>();
    loadMock.mockReturnValue(pending.promise);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ArrayBuffer(8)));
    const onLoad = vi.fn();
    const options = reactive<UseEditableEpubOptions>({ defaultUrl: '/a.epub', onLoad });
    const { result } = harness(options);
    await flushPromises();
    expect(loadMock).toHaveBeenCalled();
    expect(result.current.loading.value).toBe(true);

    options.defaultUrl = undefined;
    await nextTick();
    pending.resolve(stubEditor());
    await flushPromises();

    expect(onLoad).not.toHaveBeenCalled();
    expect(result.current.editor.value).toBeNull();
    expect(result.current.loading.value).toBe(false);
  });
});

describe('useEditableEpub (Vue) — exporting', () => {
  it('stays true until the last overlapping export settles', async () => {
    const first = deferred<ArrayBuffer>();
    const second = deferred<ArrayBuffer>();
    const exports = [first, second];
    const editor = stubEditor();
    vi.mocked(editor.export).mockImplementation(() => (exports.shift() as typeof first).promise);
    loadMock.mockResolvedValue(editor);
    const { result } = harness({});
    await result.current.loadBuffer(new ArrayBuffer(8));

    const one = result.current.exportEpub();
    const two = result.current.exportEpub();
    expect(result.current.exporting.value).toBe(true);

    first.resolve(new ArrayBuffer(1));
    await one;
    expect(result.current.exporting.value).toBe(true);

    second.resolve(new ArrayBuffer(1));
    await two;
    expect(result.current.exporting.value).toBe(false);
  });
});
