import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Mechanically enforces the JSDoc coverage requirement in `CLAUDE.md`:
 * "Every exported function, class, interface and type alias carries JSDoc."
 *
 * Coverage is measured against the symbols a consumer can actually reach, so the
 * scan starts from the barrels behind the `exports` map of every published
 * package (core, React, Vue) rather than from the file tree — a helper that no barrel re-exports is internal and
 * is deliberately not required to carry docs.
 */

const PACKAGES_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** Published packages whose `package.json#exports` define the public surface. */
const PUBLISHED_PACKAGES = ['mejiro', 'mejiro-react', 'mejiro-vue'];

/**
 * Source barrels behind every `types` entry of each published package's
 * `exports` map, relative to `packages/`. Derived rather than listed, so a new
 * subpath is covered the moment it ships.
 */
const BARRELS = PUBLISHED_PACKAGES.flatMap((pkg) => {
  const manifest = JSON.parse(readFileSync(`${PACKAGES_DIR}${pkg}/package.json`, 'utf8')) as {
    exports: Record<string, string | { types?: string }>;
  };
  return Object.values(manifest.exports).flatMap((entry) => {
    const types = typeof entry === 'string' ? undefined : entry.types;
    const match = types?.match(/^\.\/dist\/(.+)\.d\.ts$/u);
    if (!match) return [];
    const base = `${pkg}/src/${match[1]}`;
    return [existsSync(`${PACKAGES_DIR}${base}.tsx`) ? `${base}.tsx` : `${base}.ts`];
  });
});

/**
 * Modules whose exports are documented down to individual interface fields and
 * class members, matching the density of `book/types.ts` and `paginate.ts`.
 *
 * Adding an export to one of these without a doc comment fails the strict check
 * below, which is the point: these modules stay at full coverage.
 */
const FULLY_DOCUMENTED_MODULES = [
  'mejiro/src/book/mejiro-book.ts',
  'mejiro/src/book/snapshot.ts',
  'mejiro/src/browser/measure.ts',
  'mejiro/src/browser/types.ts',
  'mejiro/src/cluster.ts',
  'mejiro/src/epub/editor.ts',
  'mejiro/src/epub/project.ts',
  'mejiro/src/epub/types.ts',
  'mejiro/src/exclusion.ts',
  'mejiro/src/hanging.ts',
  'mejiro/src/i18n.ts',
  'mejiro/src/manuscript-tokens.ts',
  'mejiro/src/manuscript.ts',
  'mejiro/src/overlay.ts',
  'mejiro/src/paginate.ts',
  'mejiro/src/persistence.ts',
  'mejiro/src/render/inline-tree.ts',
  'mejiro/src/render/segment-descriptor.ts',
  'mejiro/src/text.ts',
  'mejiro/src/url.ts',
];

/**
 * Declarations that are still undocumented, recorded as a ratchet.
 *
 * The repo-wide check asserts the current gap set is a *subset* of this list, so
 * documenting an entry never breaks the suite while a newly added undocumented
 * export always does. Entries are keyed by module and symbol, without line
 * numbers, so unrelated edits above them do not churn the list. Shrink it when
 * you document one of these; never grow it.
 */
const UNDOCUMENTED_DECLARATIONS: string[] = [];

interface Gap {
  /** `<module>:<symbol>` key, e.g. `mejiro/src/i18n.ts:formatMessage`. */
  key: string;
  /** Module path relative to `packages/`. */
  module: string;
  /** Source line of the declaration, for the failure message only. */
  line: number;
}

/** True for a source file of a published package (not a dependency or a build output). */
function isPublishedSource(fileName: string): boolean {
  return PUBLISHED_PACKAGES.some((pkg) => fileName.startsWith(`${PACKAGES_DIR}${pkg}/src/`));
}

let cachedProgram: { program: ts.Program; checker: ts.TypeChecker } | undefined;

/**
 * Builds a bound program so `node.parent` is set and JSDoc lookups resolve.
 *
 * Memoized: parsing the whole public surface is by far the expensive part of
 * this file, and re-doing it per test case slows the whole suite down enough to
 * disturb the timing-sensitive tests running alongside it.
 */
function createProgram(): { program: ts.Program; checker: ts.TypeChecker } {
  if (cachedProgram) return cachedProgram;
  const program = ts.createProgram(
    BARRELS.map((barrel) => `${PACKAGES_DIR}${barrel}`),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  );
  // Creating the checker binds the program. Without it `getJSDocCommentsAndTags`
  // silently reports no docs, which would make every assertion here vacuous.
  cachedProgram = { program, checker: program.getTypeChecker() };
  return cachedProgram;
}

/** True when a declaration carries a `/** ... *\/` block with content or tags. */
function hasJsDoc(node: ts.Node): boolean {
  return ts
    .getJSDocCommentsAndTags(node)
    .some((doc) => ts.isJSDoc(doc) && (doc.comment !== undefined || (doc.tags?.length ?? 0) > 0));
}

/** Members that belong to the public surface of an exported declaration. */
function publicMembers(
  declaration: ts.Declaration,
): readonly ts.ClassElement[] | readonly ts.TypeElement[] {
  if (ts.isInterfaceDeclaration(declaration)) return declaration.members;
  if (ts.isClassDeclaration(declaration)) return declaration.members;
  if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) {
    return declaration.type.members;
  }
  return [];
}

function isHidden(member: ts.ClassElement | ts.TypeElement): boolean {
  const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
  if (
    modifiers.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword,
    )
  ) {
    return true;
  }
  return member.name !== undefined && ts.isPrivateIdentifier(member.name);
}

/** True for the body-carrying implementation behind a set of overload signatures. */
function isOverloadImplementation(declaration: ts.Declaration, symbol: ts.Symbol): boolean {
  return (
    ts.isFunctionDeclaration(declaration) &&
    declaration.body !== undefined &&
    (symbol.getDeclarations()?.length ?? 0) > 1
  );
}

/**
 * True for an optional `never` field, which only forbids combining variants of
 * a discriminated union and is documented on the variant itself.
 */
function isExclusionMarker(member: ts.ClassElement | ts.TypeElement): boolean {
  return ts.isPropertySignature(member) && member.type?.kind === ts.SyntaxKind.NeverKeyword;
}

const gapCache = new Map<boolean, Gap[]>();

/**
 * Walks every barrel export and reports the ones lacking a doc comment.
 *
 * Memoized per mode, so the per-module cases below share a single walk.
 *
 * @param includeMembers - Also require docs on interface fields and public class
 *   members, which is the density the strict module list is held to.
 */
function findGaps(includeMembers: boolean): Gap[] {
  const cached = gapCache.get(includeMembers);
  if (cached) return cached;
  const gaps = scanGaps(includeMembers);
  gapCache.set(includeMembers, gaps);
  return gaps;
}

function scanGaps(includeMembers: boolean): Gap[] {
  const { program, checker } = createProgram();
  const gaps = new Map<string, Gap>();

  const record = (module: string, symbol: string, node: ts.Node, sourceFile: ts.SourceFile) => {
    const key = `${module}:${symbol}`;
    if (gaps.has(key)) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    gaps.set(key, { key, module, line });
  };

  for (const barrel of BARRELS) {
    const sourceFile = program.getSourceFile(`${PACKAGES_DIR}${barrel}`);
    expect(sourceFile, `barrel not found: ${barrel}`).toBeDefined();
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile as ts.SourceFile);
    expect(moduleSymbol, `barrel exports nothing: ${barrel}`).toBeDefined();

    for (const exported of checker.getExportsOfModule(moduleSymbol as ts.Symbol)) {
      const name = exported.getName();
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;

      for (const declaration of symbol.getDeclarations() ?? []) {
        const declFile = declaration.getSourceFile();
        if (!isPublishedSource(declFile.fileName)) continue;
        const module = declFile.fileName.slice(PACKAGES_DIR.length);

        // An overload's implementation signature is not callable by consumers;
        // the overload signatures carry the docs.
        if (isOverloadImplementation(declaration, symbol)) continue;
        // A `const` carries its docs on the enclosing statement, not the declarator.
        const documented = ts.isVariableDeclaration(declaration)
          ? declaration.parent.parent
          : declaration;
        if (!hasJsDoc(documented)) record(module, name, declaration, declFile);
        if (!includeMembers) continue;

        for (const member of publicMembers(declaration)) {
          if (isHidden(member) || isExclusionMarker(member)) continue;
          const isCtor = ts.isConstructorDeclaration(member);
          if (!isCtor && member.name === undefined) continue;
          const memberName = isCtor ? 'constructor' : member.name.getText(declFile);
          if (!hasJsDoc(member)) record(module, `${name}.${memberName}`, member, declFile);
        }
      }
    }
  }

  return [...gaps.values()].sort((a, b) => a.key.localeCompare(b.key));
}

describe('JSDoc coverage of public exports', () => {
  it('scans a source barrel for every published subpath, including the framework packages', () => {
    expect(BARRELS).toEqual(
      expect.arrayContaining([
        'mejiro/src/index.ts',
        'mejiro/src/analysis/index.ts',
        'mejiro-react/src/index.ts',
        'mejiro-vue/src/index.ts',
      ]),
    );
    expect(BARRELS.filter((barrel) => !existsSync(`${PACKAGES_DIR}${barrel}`))).toEqual([]);
  });

  it('documents every declaration reachable from a public barrel', () => {
    const unexpected = findGaps(false)
      .filter((gap) => !UNDOCUMENTED_DECLARATIONS.includes(gap.key))
      .map((gap) => `${gap.module}:${gap.line} ${gap.key.split(':')[1]}`);

    expect(
      unexpected,
      'These exports are reachable from a public barrel but carry no JSDoc. ' +
        'Add a doc comment describing the contract rather than extending the ratchet list.',
    ).toEqual([]);
  });

  it.each(FULLY_DOCUMENTED_MODULES)('documents every export and member of %s', (module) => {
    const gaps = findGaps(true)
      .filter((gap) => gap.module === module)
      .map((gap) => `${gap.module}:${gap.line} ${gap.key.split(':')[1]}`);

    expect(gaps).toEqual([]);
  });

  it.each(['mejiro-react', 'mejiro-vue'])('documents every export and member of %s', (pkg) => {
    const gaps = findGaps(true)
      .filter((gap) => gap.module.startsWith(`${pkg}/`))
      .map((gap) => `${gap.module}:${gap.line} ${gap.key.split(':')[1]}`);

    expect(gaps).toEqual([]);
  });

  it('keeps every strictly checked module reachable from a public barrel', () => {
    const reachable = new Set<string>();
    const { program, checker } = createProgram();
    for (const barrel of BARRELS) {
      const sourceFile = program.getSourceFile(`${PACKAGES_DIR}${barrel}`) as ts.SourceFile;
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile) as ts.Symbol;
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const symbol =
          exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        for (const declaration of symbol.getDeclarations() ?? []) {
          const fileName = declaration.getSourceFile().fileName;
          if (isPublishedSource(fileName)) reachable.add(fileName.slice(PACKAGES_DIR.length));
        }
      }
    }

    // A module dropping off the public surface would silently make its strict
    // entry vacuous, so require the list to stay grounded in real exports.
    expect(FULLY_DOCUMENTED_MODULES.filter((module) => !reachable.has(module))).toEqual([]);
  });
});
