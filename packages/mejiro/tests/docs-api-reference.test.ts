/**
 * Keeps `docs/{en,ja}/10-api-reference.md` in step with what the packages
 * actually export.
 *
 * The reference claims to cover the full public API, so the check is a set
 * difference rather than a spot check: every symbol reachable from a published
 * barrel must be named in both language versions, or be listed below as a
 * deliberate omission. Symbols are matched by name, not by line number, so
 * unrelated edits to the documents never churn this test.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');

/** Barrels backing every published subpath, keyed by the subpath they serve. */
const BARRELS: Record<string, string> = {
  '@libraz/mejiro': 'packages/mejiro/src/index.ts',
  '@libraz/mejiro/browser': 'packages/mejiro/src/browser/index.ts',
  '@libraz/mejiro/epub': 'packages/mejiro/src/epub/index.ts',
  '@libraz/mejiro/render': 'packages/mejiro/src/render/index.ts',
  '@libraz/mejiro/book': 'packages/mejiro/src/book/index.ts',
  '@libraz/mejiro/image': 'packages/mejiro/src/image/index.ts',
  '@libraz/mejiro-react': 'packages/mejiro-react/src/index.ts',
  '@libraz/mejiro-vue': 'packages/mejiro-vue/src/index.ts',
};

/**
 * Exports deliberately left out of the reference, keyed as `<subpath>:<name>`.
 *
 * An entry here is a promise that the symbol is internal to the packages'
 * own plumbing. Shrink the list when one gets documented; never grow it to
 * silence a newly added export.
 */
const UNDOCUMENTED_EXPORTS: string[] = [];

/** The languages the reference ships in. */
const LOCALES = ['en', 'ja'] as const;

let cachedNames: Record<string, string[]> | undefined;

/** Enumerates the export names of every barrel, memoized across test cases. */
function barrelExports(): Record<string, string[]> {
  if (cachedNames) return cachedNames;
  const program = ts.createProgram(
    Object.values(BARRELS).map((path) => resolve(repoRoot, path)),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  );
  // Binding the program is what makes `getExportsOfModule` see anything at all.
  const checker = program.getTypeChecker();

  const names: Record<string, string[]> = {};
  for (const [subpath, path] of Object.entries(BARRELS)) {
    const sourceFile = program.getSourceFile(resolve(repoRoot, path));
    expect(sourceFile, `barrel not found: ${path}`).toBeDefined();
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile as ts.SourceFile);
    expect(moduleSymbol, `barrel exports nothing: ${path}`).toBeDefined();
    names[subpath] = checker
      .getExportsOfModule(moduleSymbol as ts.Symbol)
      .map((symbol) => symbol.getName())
      .sort();
  }
  cachedNames = names;
  return names;
}

/** Reads one language version of the reference. */
function reference(locale: (typeof LOCALES)[number]): Promise<string> {
  return readFile(resolve(repoRoot, `docs/${locale}/10-api-reference.md`), 'utf8');
}

/** Matches the package specifier a top-level chapter heading opens with. */
const CHAPTER_HEADING = /^##\s+`(@libraz\/[\w/-]+)`/u;

/**
 * Splits the reference into its per-subpath chapters.
 *
 * Chapters are the top-level `##` headings, keyed by the backticked package
 * specifier each opens with — the one token identical in both language
 * versions. Keying on the heading rather than on a line range means a symbol
 * moving between subpaths is caught, while editing prose inside a chapter is
 * not.
 */
function chapters(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current: string | undefined;
  for (const line of text.split('\n')) {
    const heading = line.match(CHAPTER_HEADING);
    if (heading) {
      current = heading[1];
      sections[current] ??= '';
      continue;
    }
    if (current) sections[current] += `${line}\n`;
  }
  return sections;
}

describe('API reference coverage', () => {
  it.each(LOCALES)('documents every export in its own %s chapter', async (locale) => {
    const sections = chapters(await reference(locale));
    const missing: string[] = [];
    for (const [subpath, names] of Object.entries(barrelExports())) {
      expect(names.length, `${subpath} exports nothing`).toBeGreaterThan(0);
      const body = sections[subpath];
      expect(
        body,
        `docs/${locale}/10-api-reference.md has no chapter for ${subpath}`,
      ).toBeDefined();
      for (const name of names) {
        if (UNDOCUMENTED_EXPORTS.includes(`${subpath}:${name}`)) continue;
        if (!new RegExp(`\\b${name}\\b`, 'u').test(body as string)) {
          missing.push(`${subpath}:${name}`);
        }
      }
    }
    expect(
      missing,
      `docs/${locale}/10-api-reference.md claims to cover the full public API, but these ` +
        'exports are absent from the chapter of the subpath that exports them. An entry ' +
        'here usually means the export moved between subpaths and the reference still ' +
        'documents it under the old one.',
    ).toEqual([]);
  });

  it.each(LOCALES)('opens one %s chapter per published subpath', async (locale) => {
    const documented = Object.keys(chapters(await reference(locale))).sort();
    expect(documented).toEqual(Object.keys(BARRELS).sort());
  });

  it('keeps every deliberate omission grounded in a real export', () => {
    const names = barrelExports();
    const stale = UNDOCUMENTED_EXPORTS.filter((entry) => {
      const separator = entry.lastIndexOf(':');
      const subpath = entry.slice(0, separator);
      return !names[subpath]?.includes(entry.slice(separator + 1));
    });
    expect(stale, 'These omissions no longer correspond to an export.').toEqual([]);
  });
});

describe('shared export-path contracts', () => {
  it.each(LOCALES)('shows how to narrow AssetResolverAsset in the %s guide', async (locale) => {
    // One resolver serves both export paths, so the union has to be narrowed by
    // an `in` check; the guide is the only place that spells the recipe out.
    const text = await readFile(resolve(repoRoot, `docs/${locale}/09-advanced.md`), 'utf8');
    expect(text).toContain("'filename' in asset");
    expect(text).toContain('AssetResolverAsset');
  });

  it('renders paragraph kinds through the shared helper in both frameworks', async () => {
    // The reference promises identical `mejiro-paragraph--*` modifiers across
    // React, Vue and the static renderer, which only holds while all three go
    // through `paragraphClassName`.
    for (const path of [
      'packages/mejiro-react/src/MejiroPage.tsx',
      'packages/mejiro-vue/src/MejiroPage.ts',
    ]) {
      const text = await readFile(resolve(repoRoot, path), 'utf8');
      expect(text, `${path} does not import the shared helper`).toMatch(
        /import \{[^}]*paragraphClassName[^}]*\} from '@libraz\/mejiro\/render'/u,
      );
      expect(text, `${path} does not read paragraph.kind`).toContain('paragraph.kind');
    }
  });
});

describe('tate-chu-yoko contract', () => {
  it('does not describe tate-chu-yoko as render-only', async () => {
    // `tcy` spans reach the line breaker: `preprocessTcy` gives each span its own
    // cluster ID and collapses it to one em. These are the exact phrasings that
    // said otherwise, so each one is pinned rather than approximated.
    const stalePhrasings = [
      /Render-only: the span is measured as the sum/u,
      /variant is\s*\n?\s*\*?\s*the only one the line breaker consumes/u,
      /Only the `ruby` variant reaches the line breaker/u,
      /縦中横[^。]{0,40}(?:描画専用|レンダリング専用)/u,
    ];
    const sources = [
      'packages/mejiro/src/browser/types.ts',
      'docs/en/10-api-reference.md',
      'docs/ja/10-api-reference.md',
    ];
    for (const path of sources) {
      const text = await readFile(resolve(repoRoot, path), 'utf8');
      for (const phrasing of stalePhrasings) {
        expect(text, `${path} still calls tate-chu-yoko render-only`).not.toMatch(phrasing);
      }
    }
  });

  it('documents the two annotation kinds the line breaker consumes', async () => {
    const text = await readFile(resolve(repoRoot, 'packages/mejiro/src/browser/types.ts'), 'utf8');
    expect(text).toMatch(/`ruby` and `tcy` variants reach the line breaker/u);
    expect(text).toMatch(/'ruby'` and `'tcy'` are\s*\n?\s*\*\s*the two variants/u);
  });
});
