import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS_PATH = new URL('../../src/render/mejiro.css', import.meta.url);
const DOC_PATHS = [
  'docs/en/07-pagination-and-rendering.md',
  'docs/ja/07-pagination-and-rendering.md',
];
const RECIPE_PATHS = ['docs/en/08-react-and-vue.md', 'docs/ja/08-react-and-vue.md'];

const css = readFileSync(CSS_PATH, 'utf8');

/** Reads a single declaration value out of the shipped stylesheet. */
function declaredValue(selector: string, property: string): string {
  const escaped = selector.replace(/[.+]/gu, '\\$&');
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'u'));
  expect(block, `no rule for ${selector}`).not.toBeNull();
  const declaration = (block?.[1] ?? '').match(new RegExp(`${property}:\\s*([^;]+);`, 'u'));
  expect(declaration, `no ${property} in ${selector}`).not.toBeNull();
  return (declaration?.[1] ?? '').trim();
}

/** Reads a documentation page relative to the repository root. */
function readDoc(relativePath: string): string {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), 'utf8');
}

/** Table row of the CSS class table whose first cell names the given selector. */
function classTableRow(relativePath: string, selector: string): string {
  const row = readDoc(relativePath)
    .split('\n')
    .find((line) => line.startsWith(`| \`${selector}\` |`));
  expect(row, `no table row for ${selector} in ${relativePath}`).toBeDefined();
  return row ?? '';
}

describe('paragraph gap documentation', () => {
  it.each(DOC_PATHS)('documents the shipped gap properties in %s', (path) => {
    const gap = declaredValue('.mejiro-paragraph', 'margin-right');
    const headingGap = declaredValue(
      '.mejiro-paragraph--heading + .mejiro-paragraph',
      'margin-right',
    );

    expect(classTableRow(path, '.mejiro-paragraph')).toContain(`margin-right: ${gap}`);
    expect(classTableRow(path, '.mejiro-paragraph:first-child')).toContain('margin-right: 0');
    expect(classTableRow(path, '.mejiro-paragraph--heading + .mejiro-paragraph')).toContain(
      `margin-right: ${headingGap}`,
    );
  });

  it.each([...DOC_PATHS, ...RECIPE_PATHS])(
    'never overrides the inline-start side of .mejiro-paragraph in %s',
    (path) => {
      const lines = readDoc(path).split('\n');
      for (const [index, line] of lines.entries()) {
        if (!line.includes('margin-left:')) continue;
        const context = lines.slice(Math.max(0, index - 4), index + 1).join('\n');
        expect(context, `${path}:${index + 1} overrides the wrong side`).not.toContain(
          '.mejiro-paragraph',
        );
      }
    },
  );
});
