// @vitest-environment happy-dom

import { render, waitFor } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { MejiroEditor } from '../src/MejiroEditor.js';

describe('MejiroEditor (Vue) — epubUrl failures', () => {
  it("reports a non-2xx response through 'error' once", async () => {
    const onError = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new ArrayBuffer(0), { status: 404 }));
    try {
      const { container } = render(MejiroEditor, {
        props: { epubUrl: '/missing.epub' },
        attrs: { onError },
      });

      await waitFor(() =>
        expect(container.querySelector('.mejiro-editor-error')?.textContent).toBe(
          'Failed to load EPUB: 404',
        ),
      );
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBe('Failed to load EPUB: 404');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
