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
