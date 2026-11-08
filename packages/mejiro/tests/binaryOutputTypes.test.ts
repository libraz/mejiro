import { describe, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

describe('binary output types', () => {
  it('feeds the exported EPUB bytes straight into a Blob and rejects a string', () => {
    expectTypeErrors(
      `import type { EditableEpub, EpubProject } from '@libraz/mejiro/epub';
import type { PrepareImageResult } from '@libraz/mejiro/image';
declare const editor: EditableEpub;
declare const project: EpubProject;
declare const prepared: PrepareImageResult;
export const fromEditor = new Blob([await editor.export()]);
export const fromProject = new Blob([await project.export()]);
export const fromImage = new Blob([prepared.data]);
export const asString: string = await editor.export();
`,
      { fails: ['asString'] },
    );
  });
});
