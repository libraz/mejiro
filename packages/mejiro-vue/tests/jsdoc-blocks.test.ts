import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = resolve(import.meta.dirname, '../src');

/** Matches a doc comment immediately followed by another one, with no member between. */
const STACKED_DOC_COMMENTS = /\*\/\s*\n\s*\/\*\*/gu;

/** Returns every `.ts` file under a directory, recursively. */
async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('doc comments', () => {
  it('detects two doc comments stacked on one member', () => {
    const source = ['/** First. */', '/** Second. */', 'export const value = 1;'].join('\n');
    expect(source.match(STACKED_DOC_COMMENTS)).not.toBeNull();
  });

  it('gives each member a single doc comment', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(srcDir)) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(STACKED_DOC_COMMENTS)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file.slice(srcDir.length + 1)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
