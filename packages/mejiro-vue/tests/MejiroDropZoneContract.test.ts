// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroDropZone } from '../src/MejiroDropZone.js';

async function pick(container: Element, file: File): Promise<void> {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await fireEvent.change(input);
}

describe('MejiroDropZone (Vue) — rejected files', () => {
  it('reports a file outside the accept filter with the reason type', async () => {
    const onReject = vi.fn();
    const onFile = vi.fn();
    const { container } = render(MejiroDropZone, { props: { onReject, onFile } });
    const file = new File(['x'], 'notes.txt');

    await pick(container, file);

    expect(onFile).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith(file, 'type');
  });

  it('reports a file the validateFile predicate refuses with the reason validation', async () => {
    const onReject = vi.fn();
    const { container } = render(MejiroDropZone, {
      props: { validateFile: () => false, onReject },
    });
    const file = new File(['x'], 'book.epub');

    await pick(container, file);

    expect(onReject).toHaveBeenCalledWith(file, 'validation');
  });

  it('types the reject payload', () => {
    expectTypeErrors(
      `import type { MejiroDropZoneProps } from '@libraz/mejiro-vue';
const ok: MejiroDropZoneProps = { onReject: (file: File, reason: 'type' | 'validation') => void [file, reason] };
void ok;
const p1: MejiroDropZoneProps = { onReject: (file: File, reason: number) => void [file, reason] };`,
      { fails: ['const p1'] },
    );
  });
});
