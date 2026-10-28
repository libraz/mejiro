// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

const readerState = vi.hoisted(() => ({
  emitError: undefined as undefined | ((error: Error) => void),
}));

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: defineComponent({
    name: 'FakeReader',
    emits: ['error'],
    setup(_props, { emit }) {
      readerState.emitError = (error) => emit('error', error);
      return () => h('div', { class: 'fake-reader' });
    },
  }),
}));

import { MejiroManuscriptEditor } from '../src/MejiroManuscriptEditor.js';
import { useEpubProject } from '../src/useEpubProject.js';

afterEach(() => {
  vi.unstubAllGlobals();
  readerState.emitError = undefined;
});

describe('MejiroManuscriptEditor (Vue) — inputs', () => {
  it('replaces the held cover when the same path is picked again', async () => {
    const onUpdateCover = vi.fn();
    const { container } = render(MejiroManuscriptEditor, {
      props: { 'onUpdate:cover': onUpdateCover },
    });
    const input = container.querySelector(
      '.mejiro-editor-panel input[type="file"]',
    ) as HTMLInputElement;
    // A browser fires no `change` while the selection equals the input's value.
    let value = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => value,
      set: (next: string) => {
        value = next;
      },
    });
    const pick = async (file: File) => {
      if (value === 'C:\\fakepath\\cover.png') return;
      value = 'C:\\fakepath\\cover.png';
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await fireEvent.change(input);
    };
    const first = new File(['one'], 'cover.png', { type: 'image/png' });
    const second = new File(['two'], 'cover.png', { type: 'image/png' });

    await pick(first);
    await pick(second);

    expect(onUpdateCover.mock.calls.map((call) => call[0])).toEqual([first, second]);
  });

  it('starts a chapter drag with drag data carrying the chapter id', async () => {
    const { container } = render(MejiroManuscriptEditor, {
      props: {
        chapters: [
          { id: 'ch-a', title: 'A', body: 'a' },
          { id: 'ch-b', title: 'B', body: 'b' },
        ],
      },
    });
    const handle = container.querySelector('button[draggable="true"]') as HTMLButtonElement;
    const dataTransfer = { effectAllowed: '', setData: vi.fn() };

    await fireEvent.dragStart(handle, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'ch-a');
  });

  it('routes a preview reader failure to the error event and the panel', async () => {
    const { container, emitted } = render(MejiroManuscriptEditor);

    readerState.emitError?.(new Error('layout failed'));
    await nextTick();

    expect(emitted<[Error]>().error).toHaveLength(1);
    expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe('layout failed');
  });

  it('sets up without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {});

    expect(() => render(MejiroManuscriptEditor)).not.toThrow();
    let identifier: string | undefined;
    mount(
      defineComponent({
        setup() {
          identifier = useEpubProject().metadata.value.identifier;
          return () => h('div');
        },
      }),
    );
    expect(identifier).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  });
});
