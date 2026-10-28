// @vitest-environment happy-dom
/** @jsxImportSource react */

import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const readerState = vi.hoisted(() => ({
  props: [] as Array<{ onError?: (error: Error) => void }>,
}));

vi.mock('../src/MejiroReader.js', () => ({
  // biome-ignore lint/style/useNamingConvention: mocked export name matches the public component.
  MejiroReader: forwardRef<unknown, { onError?: (error: Error) => void }>(
    function FakeReader(props) {
      readerState.props.push(props);
      return <div className="fake-reader" />;
    },
  ),
}));

import { MejiroManuscriptEditor } from '../src/MejiroManuscriptEditor.js';
import { useEpubProject } from '../src/useEpubProject.js';

afterEach(() => {
  vi.unstubAllGlobals();
  readerState.props.length = 0;
});

describe('MejiroManuscriptEditor (React) — inputs', () => {
  it('replaces the held cover when the same path is picked again', () => {
    const onCoverChange = vi.fn();
    const { container } = render(<MejiroManuscriptEditor onCoverChange={onCoverChange} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // A browser fires no `change` while the selection equals the input's value.
    let value = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => value,
      set: (next: string) => {
        value = next;
      },
    });
    const pick = (file: File) => {
      if (value === 'C:\\fakepath\\cover.png') return;
      value = 'C:\\fakepath\\cover.png';
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      fireEvent.change(input);
    };
    const first = new File(['one'], 'cover.png', { type: 'image/png' });
    const second = new File(['two'], 'cover.png', { type: 'image/png' });

    pick(first);
    pick(second);

    expect(onCoverChange.mock.calls.map((call) => call[0])).toEqual([first, second]);
  });

  it('starts a chapter drag with drag data carrying the chapter id', () => {
    const { container } = render(
      <MejiroManuscriptEditor
        chapters={[
          { id: 'ch-a', title: 'A', body: 'a' },
          { id: 'ch-b', title: 'B', body: 'b' },
        ]}
      />,
    );
    const handle = container.querySelector('button[draggable="true"]') as HTMLButtonElement;
    const dataTransfer = { effectAllowed: '', setData: vi.fn() };

    fireEvent.dragStart(handle, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'ch-a');
  });

  it('routes a preview reader failure to onError and the panel', () => {
    const onError = vi.fn();
    const { container } = render(<MejiroManuscriptEditor onError={onError} />);

    act(() => readerState.props.at(-1)?.onError?.(new Error('layout failed')));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe('layout failed');
  });

  it('sets up without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {});

    expect(() => render(<MejiroManuscriptEditor />)).not.toThrow();
    const { result } = renderHook(() => useEpubProject());
    expect(result.current.metadata.identifier).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  });
});
