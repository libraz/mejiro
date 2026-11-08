// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { useEditableEpub } from '../src/useEditableEpub.js';
import { useEpub } from '../src/useEpub.js';
import { spiedEpubFile, withSetup } from './helpers/fixtures.js';

vi.mock('@libraz/mejiro/epub', async (importOriginal) => {
  // Only the loaders are faked; the module's pure helpers stay real.
  const actual = await importOriginal<typeof import('@libraz/mejiro/epub')>();

  return {
    ...actual,
    parseEditableEpub: vi.fn(),
    parseEpub: vi.fn(async () => ({
      title: 'Mocked',
      author: 'A',
      chapters: [{ title: 'C1', paragraphs: [{ text: 'a', inlineAnnotations: [] }] }],
    })),
  };
});

describe('EPUB file loaders (Vue) — input size', () => {
  it('useEpub rejects a file over maxInputBytes without reading it', async () => {
    const onError = vi.fn();
    const { result, unmount } = withSetup(() => useEpub({ limits: { maxInputBytes: 4 }, onError }));
    const { file, read } = spiedEpubFile(8);

    expect(await result.loadFile(file)).toBeNull();

    expect(read).not.toHaveBeenCalled();
    expect(result.error.value).toMatchObject({ name: 'MejiroError', code: 'epub-limit-exceeded' });
    expect(onError).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('useEditableEpub rejects a file over maxInputBytes without reading it', async () => {
    const onError = vi.fn();
    const { result, unmount } = withSetup(() =>
      useEditableEpub({ limits: { maxInputBytes: 4 }, onError }),
    );
    const { file, read } = spiedEpubFile(8);

    expect(await result.loadFile(file)).toBeNull();

    expect(read).not.toHaveBeenCalled();
    expect(result.error.value).toMatchObject({ name: 'MejiroError', code: 'epub-limit-exceeded' });
    expect(result.loading.value).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('reads a file within the limit', async () => {
    const { result, unmount } = withSetup(() => useEpub({ limits: { maxInputBytes: 8 } }));
    const { file, read } = spiedEpubFile(8);

    await result.loadFile(file);

    expect(read).toHaveBeenCalledTimes(1);
    expect(result.error.value).toBeNull();
    unmount();
  });
});
