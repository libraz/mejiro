// @vitest-environment happy-dom
/** @jsxImportSource react */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MejiroDropZone } from '../src/MejiroDropZone.js';

function pick(container: HTMLElement, file: File): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

/** Inputs whose `value` the browser emulation below owns. */
const emulated = new WeakSet<HTMLInputElement>();

/**
 * Picks `file` the way a browser does: no `change` fires when the selection
 * equals the input's current value.
 */
function browserPick(container: HTMLElement, file: File): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  if (!emulated.has(input)) {
    emulated.add(input);
    let value = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => value,
      set: (next: string) => {
        value = next;
      },
    });
  }
  const path = `C:\\fakepath\\${file.name}`;
  if (input.value === path) return;
  input.value = path;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

describe('MejiroDropZone (React) — file picker', () => {
  it('delivers the same file again when it is picked a second time', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    const file = new File(['x'], 'book.epub');
    browserPick(container, file);
    browserPick(container, file);
    expect(onFile).toHaveBeenCalledTimes(2);
  });
});

describe('MejiroDropZone (React) — default validator', () => {
  it.each(['book.epub', 'BOOK.EPUB', 'Book.Epub'])('accepts %s', (name) => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    pick(container, new File(['x'], name));
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('rejects a file the accept filter does not allow', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    pick(container, new File(['x'], 'notes.txt'));
    expect(onFile).not.toHaveBeenCalled();
  });

  it('follows a custom accept filter', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone accept=".zip,image/*" onFile={onFile} />);
    pick(container, new File(['x'], 'ARCHIVE.ZIP'));
    pick(container, new File(['x'], 'cover', { type: 'image/png' }));
    pick(container, new File(['x'], 'book.epub'));
    expect(onFile.mock.calls.map(([file]) => file.name)).toEqual(['ARCHIVE.ZIP', 'cover']);
  });
});
