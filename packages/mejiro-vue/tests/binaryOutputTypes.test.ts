import { describe, it } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';

describe('binary output types', () => {
  it('feeds the exported bytes and the transform hook into a Blob without a copy', () => {
    expectTypeErrors(
      `import { type ExportPolicy, useEpubProject } from '@libraz/mejiro-vue';
declare const project: ReturnType<typeof useEpubProject>;
declare const policy: ExportPolicy;
export const fromHook = new Blob([await project.exportEpub()]);
export const transformed = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Blob([await policy.transform!(bytes)]);
export const wrongInput: ExportPolicy = { transform: (bytes: string) => new Uint8Array(bytes.length) };
export const asString: string = await project.exportEpub();
`,
      { fails: ['wrongInput', 'asString'] },
    );
  });
});
