// @vitest-environment happy-dom
/** @jsxImportSource react */

import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MejiroManuscriptEditor } from '../src/MejiroManuscriptEditor.js';

/** Entry names of a zip archive, read from its local file headers. */
function zipEntryNames(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const names: string[] = [];
  for (let i = 0; i + 30 <= bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const nameLength = view.getUint16(i + 26, true);
    names.push(decoder.decode(bytes.subarray(i + 30, i + 30 + nameLength)));
  }
  return names;
}

/**
 * The editor exports through the real project pipeline here (no `EpubProject`
 * stub), so what reaches `assetResolver` is the pipeline's own behavior.
 */
describe('MejiroManuscriptEditor asset resolution (React)', () => {
  it('embeds the chosen cover, leaving assetResolver unused', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob://stub');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const assetResolver = vi.fn(() => new Uint8Array([1, 2, 3]));
    const onExport = vi.fn();
    const onError = vi.fn();

    try {
      const { container } = render(
        <MejiroManuscriptEditor
          assetResolver={assetResolver}
          onExport={onExport}
          onError={onError}
        />,
      );
      const fileInput = container.querySelector(
        '.mejiro-editor-panel input[type="file"]',
      ) as HTMLInputElement;
      const cover = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'cover.jpg', {
        type: 'image/jpeg',
      });
      Object.defineProperty(fileInput, 'files', { value: [cover], configurable: true });
      fireEvent.change(fileInput);
      fireEvent.click(container.querySelector('.mejiro-editor-export') as HTMLButtonElement);

      await waitFor(() => expect(onExport).toHaveBeenCalled());

      expect(onError).not.toHaveBeenCalled();
      // The cover really is in the package (zip entry names are stored as
      // plain bytes), and getting it there took no resolver call.
      expect(zipEntryNames(onExport.mock.calls[0][0])).toContain('OPS/Images/cover.jpg');
      expect(assetResolver).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
      revokeObjectURL.mockRestore();
      createObjectURL.mockRestore();
    }
  });
});
