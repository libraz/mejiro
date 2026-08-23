import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BLOCK_ELEMENTS } from '../../src/epub/ruby-extractor.js';

const DOC_PATHS = ['docs/en/06-epub.md', 'docs/ja/06-epub.md'];

/** Element names listed on the paragraph-boundary line of an EPUB doc page. */
function documentedBoundaryElements(relativePath: string): string[] {
  const source = readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), 'utf8');
  const line = source.split('\n').find((candidate) => candidate.includes('`figcaption`'));
  expect(line, `no paragraph-boundary line in ${relativePath}`).toBeDefined();
  return [...(line ?? '').matchAll(/`([a-z0-9]+)`/gu)].map((match) => match[1]);
}

describe('block-level element documentation', () => {
  it.each(DOC_PATHS)('lists exactly the paragraph boundary elements in %s', (path) => {
    expect(documentedBoundaryElements(path)).toEqual([...BLOCK_ELEMENTS]);
  });
});
