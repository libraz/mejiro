/**
 * Pins what the published documentation comments promise where no runtime
 * test can: the JSDoc states the current contract with no version history,
 * the line breaking entry points name the `RangeError` they throw, and
 * `RenderSegment` tells a renderer to draw either the flattened text or the
 * nested children. The READMEs and guides must not teach passing
 * `DEFAULT_HEADING_STYLES` back in, since it is what a book uses already.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');

const SOURCE_ROOTS = [
  'packages/mejiro/src',
  'packages/mejiro-react/src',
  'packages/mejiro-vue/src',
];

function sourceFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) =>
    readdirSync(resolve(repoRoot, root), { recursive: true, encoding: 'utf8' })
      .filter((file) => ['.ts', '.tsx'].includes(extname(file)) && !file.endsWith('.d.ts'))
      .map((file) => `${root}/${file}`),
  );
}

/** Every `/** … *\/` block of a file, with the line it starts on. */
function docBlocks(text: string): { line: number; body: string }[] {
  const blocks: { line: number; body: string }[] = [];
  for (const match of text.matchAll(/\/\*\*[\s\S]*?\*\//gu)) {
    const line = text.slice(0, match.index).split('\n').length;
    blocks.push({ line, body: match[0] });
  }
  return blocks;
}

function parse(path: string): ts.SourceFile {
  const text = readFileSync(resolve(repoRoot, path), 'utf8');
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
}

/** The JSDoc text attached to the first declaration `pick` accepts. */
function docOf(path: string, pick: (node: ts.Node) => boolean): string {
  const source = parse(path);
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (pick(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(found, `declaration not found in ${path}`).toBeDefined();
  return (ts.getJSDocCommentsAndTags(found as ts.Node) as readonly ts.Node[])
    .map((doc) => doc.getText(source))
    .join('\n');
}

const named =
  (kind: ts.SyntaxKind, name: string) =>
  (node: ts.Node): boolean =>
    node.kind === kind && (node as ts.NamedDeclaration).name?.getText() === name;

describe('TSDoc contract', () => {
  it('describes the current contract without version history', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles()) {
      const text = readFileSync(resolve(repoRoot, path), 'utf8');
      for (const block of docBlocks(text)) {
        if (/\bv0\.\d+\b/u.test(block.body) || /\bformerly\b/iu.test(block.body)) {
          offenders.push(`${path}:${block.line}`);
        }
      }
    }
    expect(offenders, 'JSDoc that narrates a past version').toEqual([]);
  });

  it.each([
    ['computeBreaks', 'packages/mejiro/src/layout.ts', ts.SyntaxKind.FunctionDeclaration],
    ['preprocessRuby', 'packages/mejiro/src/ruby.ts', ts.SyntaxKind.FunctionDeclaration],
  ] as const)('documents the RangeError %s throws', (name, path, kind) => {
    expect(docOf(path, named(kind, name))).toMatch(/@throws\s+\{?RangeError\}?/u);
  });

  it('documents the RangeError ExclusionEngine.compute throws', () => {
    const doc = docOf(
      'packages/mejiro/src/exclusion.ts',
      (node) =>
        ts.isMethodDeclaration(node) &&
        node.name.getText() === 'compute' &&
        ts.isClassDeclaration(node.parent) &&
        node.parent.name?.getText() === 'ExclusionEngine',
    );
    expect(doc).toMatch(/@throws\s+\{?RangeError\}?/u);
  });

  it('tells a renderer to draw either the flattened text or the children', () => {
    const doc = docOf(
      'packages/mejiro/src/render/types.ts',
      named(ts.SyntaxKind.TypeAliasDeclaration, 'RenderSegment'),
    ).replace(/\s*\n\s*\*\s*/gu, ' ');
    expect(doc).toMatch(/`text` is the span's content flattened to a string/u);
    expect(doc).toMatch(/`children` covers the same range/u);
    expect(doc).toMatch(/Draw only one of the two/u);
  });

  it('keeps DEFAULT_HEADING_STYLES out of the option examples', () => {
    const pages = [
      'README.md',
      'README_ja.md',
      'packages/mejiro/README.md',
      'packages/mejiro-react/README.md',
      'packages/mejiro-vue/README.md',
      ...['en', 'ja'].flatMap((lang) =>
        readdirSync(resolve(repoRoot, 'docs', lang))
          .filter((file) => file.endsWith('.md') && file !== '11-migrating-to-0.11.md')
          .map((file) => `docs/${lang}/${file}`),
      ),
    ];
    const offenders = pages.filter((path) =>
      /headingStyles:\s*DEFAULT_HEADING_STYLES/u.test(
        readFileSync(resolve(repoRoot, path), 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
