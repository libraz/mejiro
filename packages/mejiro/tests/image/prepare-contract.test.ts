/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MejiroError } from '@libraz/mejiro';
import { prepareImage } from '@libraz/mejiro/image';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../type-probe.js';

/** Runs `action` and returns what it rejected with, failing the test when it resolves. */
async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

const PNG = (): Blob => new Blob([new Uint8Array(16)], { type: 'image/png' });

/** Canvas stub whose encoded size scales with the requested quality. */
class SizedOffscreen {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext(_kind: string): { drawImage: () => void } {
    return { drawImage: () => {} };
  }
  async convertToBlob(opts: { type: string; quality?: number }): Promise<Blob> {
    const size = Math.max(64, Math.floor(this.width * this.height * (opts.quality ?? 1) * 0.05));
    return new Blob([new Uint8Array(size)], { type: opts.type });
  }
}

function stubBitmap(close = vi.fn()): ReturnType<typeof vi.fn> {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 1024, height: 768, close }) as unknown as ImageBitmap),
  );
  return close;
}

describe('prepareImage failures', () => {
  beforeEach(() => {
    stubBitmap();
    vi.stubGlobal('OffscreenCanvas', SizedOffscreen as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('wraps a decode failure in a MejiroError that keeps the cause', async () => {
    const cause = new DOMException('The source image cannot be decoded', 'InvalidStateError');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw cause;
      }),
    );

    const error = await rejection(() => prepareImage(PNG()));

    expect(error).toBeInstanceOf(MejiroError);
    expect(error).toMatchObject({ name: 'MejiroError', code: 'image-decode-failed', cause });
  });

  it('reports a missing createImageBitmap as an unsupported environment', async () => {
    vi.stubGlobal('createImageBitmap', undefined);

    await expect(prepareImage(PNG())).rejects.toMatchObject({
      name: 'MejiroError',
      code: 'environment-unsupported',
    });
  });

  it('reports the absence of any canvas as an unsupported environment and releases the bitmap', async () => {
    const close = stubBitmap();
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('document', undefined);

    await expect(prepareImage(PNG())).rejects.toMatchObject({
      name: 'MejiroError',
      code: 'environment-unsupported',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reports a canvas without a 2D context as an unsupported environment', async () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext(): null {
          return null;
        }
      },
    );

    await expect(prepareImage(PNG())).rejects.toMatchObject({
      name: 'MejiroError',
      code: 'environment-unsupported',
    });
  });

  it('reports a canvas that produces no blob as an encoding failure', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (callback: (blob: Blob | null) => void) => callback(null),
    } as unknown as HTMLCanvasElement);

    await expect(prepareImage(PNG())).rejects.toMatchObject({
      name: 'MejiroError',
      code: 'image-encode-failed',
    });
  });

  it('wraps an encoder that throws and keeps the cause', async () => {
    const cause = new Error('encoder exploded');
    const close = stubBitmap();
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends SizedOffscreen {
        override async convertToBlob(): Promise<Blob> {
          throw cause;
        }
      },
    );

    const error = await rejection(() => prepareImage(PNG()));

    expect(error).toMatchObject({ name: 'MejiroError', code: 'image-encode-failed', cause });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps invalid bounds a programming error rather than a MejiroError', async () => {
    const error = await rejection(() => prepareImage(PNG(), { maxWidth: 0 }));

    expect(error).toBeInstanceOf(RangeError);
    expect(error).not.toBeInstanceOf(MejiroError);
  });
});

describe('prepareImage warnings', () => {
  beforeEach(() => {
    stubBitmap();
    vi.stubGlobal('OffscreenCanvas', SizedOffscreen as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports an output that still exceeds maxBytes as a coded warning', async () => {
    const result = await prepareImage(PNG(), { convertTo: 'jpeg', maxBytes: 4_000 });

    expect(result.warnings).toEqual([{ code: 'max-bytes-exceeded', message: expect.any(String) }]);
    expect(result.data.byteLength).toBeGreaterThan(4_000);
  });

  it('has no warning when the output fits, however much it was reduced', async () => {
    const result = await prepareImage(PNG(), {
      convertTo: 'jpeg',
      maxBytes: 500,
      maxWidth: 128,
      maxHeight: 128,
    });

    expect(result.warnings).toEqual([]);
    expect(result.data.byteLength).toBeLessThanOrEqual(500);
    expect(result.width).toBeLessThanOrEqual(128);
  });

  it('types the warnings as a read-only list of MejiroWarning', () => {
    const header = `import { prepareImage } from '@libraz/mejiro/image';
import type { MejiroWarning } from '@libraz/mejiro';
declare const file: Blob;
const result = await prepareImage(file);
`;
    expectTypeErrors(
      `${header}export const warnings: readonly MejiroWarning[] = result.warnings;
export const code: string = result.warnings[0].code;
`,
      { fails: [] },
    );
    expectTypeErrors(
      `${header}export const text: string = result.warnings[0];
export const push = result.warnings.push({ code: 'max-bytes-exceeded', message: '' });
`,
      { fails: ['const text', 'const push'] },
    );
  });
});

describe('prepareImage input and output bytes', () => {
  beforeEach(() => {
    stubBitmap();
    vi.stubGlobal('OffscreenCanvas', SizedOffscreen as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a Uint8Array covering exactly the encoded bytes and leaves the input untouched', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const file = new Blob([bytes], { type: 'image/png' });

    const result = await prepareImage(file, { convertTo: 'png' });

    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.data.byteOffset).toBe(0);
    expect(result.data.buffer.byteLength).toBe(result.data.byteLength);
    expect(file.size).toBe(bytes.byteLength);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('prepareImage cancellation', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', SizedOffscreen as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects with the signal reason when already aborted, without decoding', async () => {
    stubBitmap();
    const reason = new Error('stopped before start');
    const controller = new AbortController();
    controller.abort(reason);

    const error = await rejection(() => prepareImage(PNG(), { signal: controller.signal }));

    expect(error).toBe(reason);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('rejects with an AbortError by default', async () => {
    stubBitmap();
    const controller = new AbortController();
    controller.abort();

    await expect(prepareImage(PNG(), { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects with the reason when aborted while encoding, and releases the bitmap', async () => {
    const close = stubBitmap();
    const reason = new Error('stopped while encoding');
    const controller = new AbortController();
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends SizedOffscreen {
        override async convertToBlob(opts: { type: string; quality?: number }): Promise<Blob> {
          controller.abort(reason);
          return super.convertToBlob(opts);
        }
      },
    );

    const error = await rejection(() => prepareImage(PNG(), { signal: controller.signal }));

    expect(error).toBe(reason);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('prefers the abort reason over a decode failure caused by the abort', async () => {
    const reason = new Error('stopped while decoding');
    const controller = new AbortController();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        controller.abort(reason);
        throw new DOMException('aborted', 'InvalidStateError');
      }),
    );

    const error = await rejection(() => prepareImage(PNG(), { signal: controller.signal }));

    expect(error).toBe(reason);
  });

  it('completes normally with a signal that is never aborted', async () => {
    stubBitmap();
    const controller = new AbortController();

    const result = await prepareImage(PNG(), { signal: controller.signal });

    expect(result.width).toBe(1024);
  });

  it.each([
    ['a plain object', {}],
    ['a string', 'abort'],
    ['null', null],
    ['an almost-signal', { aborted: false }],
  ])('rejects %s as the signal with a TypeError', async (_label, signal) => {
    stubBitmap();

    const error = await rejection(() =>
      prepareImage(PNG(), { signal: signal as unknown as AbortSignal }),
    );

    expect(error).toBeInstanceOf(TypeError);
  });

  it('takes the signal as an AbortSignal and nothing else at the type level', () => {
    const header = `import { prepareImage } from '@libraz/mejiro/image';
import type { PrepareImageOptions } from '@libraz/mejiro/image';
declare const file: Blob;
`;
    expectTypeErrors(
      `${header}export const ok: PrepareImageOptions = { signal: new AbortController().signal };
export const unset: PrepareImageOptions = { signal: undefined };
export const call = prepareImage(file, ok);
`,
      { fails: [] },
    );
    expectTypeErrors(
      `${header}export const wrong: PrepareImageOptions = { signal: true };
`,
      { fails: ['const wrong'] },
    );
  });
});

describe('prepareImage option documentation', () => {
  it('states the default of every defaulted option with a defaultValue tag', () => {
    // `import.meta.url` is not a file URL under the DOM environment this file runs in.
    const file = path.join(process.cwd(), 'packages/mejiro/src/image/prepare.ts');
    const source = ts.createSourceFile(
      'prepare.ts',
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
    );
    const options = source.statements.find(
      (node): node is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(node) && node.name.text === 'PrepareImageOptions',
    );
    const tagged = new Map<string, boolean>();
    for (const member of options?.members ?? []) {
      if (!(ts.isPropertySignature(member) && ts.isIdentifier(member.name))) continue;
      tagged.set(
        member.name.text,
        ts.getJSDocTags(member).some((tag) => tag.tagName.text === 'defaultValue'),
      );
    }

    expect([...tagged.keys()].sort()).toEqual([
      'convertTo',
      'maxBytes',
      'maxHeight',
      'maxWidth',
      'quality',
      'signal',
    ]);
    expect([...tagged.values()].every(Boolean)).toBe(true);
  });
});
