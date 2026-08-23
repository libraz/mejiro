import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Mechanically enforces the JSDoc coverage requirement in `CLAUDE.md`:
 * "Every exported function, class, interface and type alias carries JSDoc."
 *
 * Coverage is measured against the symbols a consumer can actually reach, so the
 * scan starts from the barrels behind the `exports` map in `package.json` rather
 * than from the file tree — a helper that no barrel re-exports is internal and
 * is deliberately not required to carry docs.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Barrels backing the public subpaths declared in `package.json#exports`. */
const BARRELS = [
  'src/index.ts',
  'src/browser/index.ts',
  'src/epub/index.ts',
  'src/render/index.ts',
  'src/book/index.ts',
  'src/image/index.ts',
];

/**
 * Modules whose exports are documented down to individual interface fields and
 * class members, matching the density of `book/types.ts` and `paginate.ts`.
 *
 * Adding an export to one of these without a doc comment fails the strict check
 * below, which is the point: these modules stay at full coverage.
 */
const FULLY_DOCUMENTED_MODULES = [
  'src/book/mejiro-book.ts',
  'src/book/snapshot.ts',
  'src/browser/measure.ts',
  'src/browser/types.ts',
  'src/cluster.ts',
  'src/epub/editor.ts',
  'src/epub/project.ts',
  'src/epub/types.ts',
  'src/exclusion.ts',
  'src/hanging.ts',
  'src/i18n.ts',
  'src/manuscript-tokens.ts',
  'src/manuscript.ts',
  'src/overlay.ts',
  'src/paginate.ts',
  'src/persistence.ts',
  'src/render/inline-tree.ts',
  'src/render/segment-descriptor.ts',
  'src/text.ts',
  'src/url.ts',
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
  /** `<module>:<symbol>` key, e.g. `src/i18n.ts:formatMessage`. */
  key: string;
  /** Module path relative to the package root. */
  module: string;
  /** Source line of the declaration, for the failure message only. */
  line: number;
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
    BARRELS.map((barrel) => `${PACKAGE_ROOT}${barrel}`),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
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
    const sourceFile = program.getSourceFile(`${PACKAGE_ROOT}${barrel}`);
    expect(sourceFile, `barrel not found: ${barrel}`).toBeDefined();
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile as ts.SourceFile);
    expect(moduleSymbol, `barrel exports nothing: ${barrel}`).toBeDefined();

    for (const exported of checker.getExportsOfModule(moduleSymbol as ts.Symbol)) {
      const name = exported.getName();
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;

      for (const declaration of symbol.getDeclarations() ?? []) {
        const declFile = declaration.getSourceFile();
        if (!declFile.fileName.startsWith(PACKAGE_ROOT)) continue;
        const module = declFile.fileName.slice(PACKAGE_ROOT.length);

        // A `const` carries its docs on the enclosing statement, not the declarator.
        const documented = ts.isVariableDeclaration(declaration)
          ? declaration.parent.parent
          : declaration;
        if (!hasJsDoc(documented)) record(module, name, declaration, declFile);
        if (!includeMembers) continue;

        for (const member of publicMembers(declaration)) {
          if (isHidden(member)) continue;
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

  it('keeps every strictly checked module reachable from a public barrel', () => {
    const reachable = new Set<string>();
    const { program, checker } = createProgram();
    for (const barrel of BARRELS) {
      const sourceFile = program.getSourceFile(`${PACKAGE_ROOT}${barrel}`) as ts.SourceFile;
      const moduleSymbol = checker.getSymbolAtLocation(sourceFile) as ts.Symbol;
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const symbol =
          exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        for (const declaration of symbol.getDeclarations() ?? []) {
          const fileName = declaration.getSourceFile().fileName;
          if (fileName.startsWith(PACKAGE_ROOT)) reachable.add(fileName.slice(PACKAGE_ROOT.length));
        }
      }
    }

    // A module dropping off the public surface would silently make its strict
    // entry vacuous, so require the list to stay grounded in real exports.
    expect(FULLY_DOCUMENTED_MODULES.filter((module) => !reachable.has(module))).toEqual([]);
  });
});
