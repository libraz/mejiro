import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packages = ['mejiro', 'mejiro-react', 'mejiro-vue'];

describe('package exports', () => {
  it('exports package.json from all published packages', async () => {
    for (const pkg of packages) {
      const raw = await readFile(resolve(import.meta.dirname, `../../${pkg}/package.json`), 'utf8');
      const json = JSON.parse(raw) as { exports?: Record<string, unknown> };
      expect(json.exports?.['./package.json']).toBe('./package.json');
    }
  });
});
