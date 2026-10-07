// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { MejiroDropZone } from '../src/MejiroDropZone.js';

async function pick(container: Element, file: File): Promise<void> {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await fireEvent.change(input);
}

function picked(emitted: Record<string, unknown[][]>): string[] {
  return (emitted.file ?? []).map(([file]) => (file as File).name);
}

/** Inputs whose `value` the browser emulation below owns. */
const emulated = new WeakSet<HTMLInputElement>();

/**
 * Picks `file` the way a browser does: no `change` fires when the selection
 * equals the input's current value.
 */
async function browserPick(container: Element, file: File): Promise<void> {
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
  await fireEvent.change(input);
}

describe('MejiroDropZone (Vue) — file picker', () => {
  it('delivers the same file again when it is picked a second time', async () => {
    const { container, emitted } = render(MejiroDropZone);
    const file = new File(['x'], 'book.epub');
    await browserPick(container, file);
    await browserPick(container, file);
    expect(picked(emitted())).toEqual(['book.epub', 'book.epub']);
  });
});

describe('MejiroDropZone (Vue) — default validator', () => {
  it.each(['book.epub', 'BOOK.EPUB', 'Book.Epub'])('accepts %s', async (name) => {
    const { container, emitted } = render(MejiroDropZone);
    await pick(container, new File(['x'], name));
    expect(picked(emitted())).toEqual([name]);
  });

  it('rejects a file the accept filter does not allow', async () => {
    const { container, emitted } = render(MejiroDropZone);
    await pick(container, new File(['x'], 'notes.txt'));
    expect(picked(emitted())).toEqual([]);
  });

  it('follows a custom accept filter', async () => {
    const { container, emitted } = render(MejiroDropZone, { props: { accept: '.zip,image/*' } });
    await pick(container, new File(['x'], 'ARCHIVE.ZIP'));
    await pick(container, new File(['x'], 'cover', { type: 'image/png' }));
    await pick(container, new File(['x'], 'book.epub'));
    expect(picked(emitted())).toEqual(['ARCHIVE.ZIP', 'cover']);
  });
});
