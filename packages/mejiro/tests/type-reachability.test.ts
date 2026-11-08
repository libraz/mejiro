import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Mechanically enforces the barrel-reachability contract of the published
 * packages: every type that appears in a public signature — parameter types,
 * component props, hook return members, members of an exported union — can be
 * imported by name from a published entry point.
 *
 * A host writing a typed wrapper otherwise has to hand-copy the shape and
 * silently drifts from it on the next release, so the check starts from the
 * barrels behind `package.json#exports` and walks outwards twice:
 *
 * - over the written syntax (type annotations and heritage clauses), which
 *   catches everything spelled out in the sources, and
 * - over the checked types, which catches shapes that are inferred rather than
 *   written — `defineComponent` props in the Vue package above all.
 *
 * Only types declared inside this repository are considered; `react`, `vue` and
 * the DOM lib are reachable through their own packages.
 */

const PACKAGES_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** A published package and the barrels backing its `package.json#exports`. */
interface PublicPackage {
  /** Directory under `packages/`. */
  dir: string;
  /** Barrel paths relative to the package directory. */
  barrels: readonly string[];
}

const CORE: PublicPackage = {
  dir: 'mejiro',
  barrels: [
    'src/index.ts',
    'src/browser/index.ts',
    'src/epub/index.ts',
    'src/render/index.ts',
    'src/book/index.ts',
    'src/image/index.ts',
    'src/analysis/index.ts',
  ],
};

const FRAMEWORK_PACKAGES: readonly PublicPackage[] = [
  { dir: 'mejiro-react', barrels: ['src/index.ts'] },
  { dir: 'mejiro-vue', barrels: ['src/index.ts'] },
];

const PUBLIC_PACKAGES = [CORE, ...FRAMEWORK_PACKAGES];

/**
 * Repo-relative source path prefixes from `MEJIRO_CHECK_MODULES`
 * (comma-separated). When set, only the barrels under one of them are walked,
 * and a prefix list that matches no barrel fails the run instead of passing empty.
 */
const CHECK_PREFIXES = (process.env.MEJIRO_CHECK_MODULES ?? '')
  .split(',')
  .map((prefix) => prefix.trim())
  .filter(Boolean);

/** True when the barrel at absolute path `file` is within the requested prefixes. */
function isChecked(file: string): boolean {
  const repoPath = `packages/${path.relative(PACKAGES_ROOT, file)}`;
  return (
    CHECK_PREFIXES.length === 0 || CHECK_PREFIXES.some((prefix) => repoPath.startsWith(prefix))
  );
}

/** Barrels of `pkg` that this run walks. */
function checkedBarrels(pkg: PublicPackage): string[] {
  return pkg.barrels.filter((barrel) => isChecked(absolute(pkg, barrel)));
}

/**
 * Types that a public signature reaches but that their own module keeps
 * private, recorded as a ratchet.
 *
 * None of these can be fixed by a barrel alone — the declaring module has to
 * export them first — and each is either a composition helper whose fields are
 * fully visible through an exported type, or attached to a deprecated field.
 * The check below asserts the current gap set is a *subset* of this list, so
 * exporting one of them never breaks the suite while a newly unreachable type
 * always does. Shrink it when a type becomes reachable; never grow it.
 */
const UNREACHABLE_TYPES = [
  // Reached only through the deprecated `EditableEpubChapter.paragraphRefs`,
  // and itself deprecated: exporting it would publish a shape scheduled for
  // removal, so it stays private until the field goes.
];

/** A type reachable from a public signature but not exported by any barrel. */
interface Finding {
  /** `<module>:<symbol>` key, e.g. `mejiro/src/book/snapshot.ts:PageSize`. */
  key: string;
  /** Source line of the declaration, for the failure message only. */
  line: number;
  /** Public symbol the walk arrived from, for the failure message only. */
  from: string;
}

function absolute(pkg: PublicPackage, barrel: string): string {
  return path.join(PACKAGES_ROOT, pkg.dir, barrel);
}

const ALL_BARRELS = PUBLIC_PACKAGES.flatMap((pkg) =>
  pkg.barrels.map((barrel) => absolute(pkg, barrel)),
);

let cachedProgram: { program: ts.Program; checker: ts.TypeChecker } | undefined;

/**
 * Builds one bound program covering every published package.
 *
 * `@libraz/mejiro` is mapped to the core sources, mirroring the alias in
 * `vitest.config.ts`, so the walk sees the current tree instead of a `dist`
 * build that may predate the sources.
 *
 * Memoized: binding the whole public surface dominates the cost of this file.
 */
function createProgram(): { program: ts.Program; checker: ts.TypeChecker } {
  if (cachedProgram) return cachedProgram;
  const subpaths = ['browser', 'epub', 'render', 'book', 'image', 'analysis'];
  const program = ts.createProgram(ALL_BARRELS, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    strict: true,
    skipLibCheck: true,
    baseUrl: PACKAGES_ROOT,
    paths: {
      '@libraz/mejiro': [absolute(CORE, 'src/index.ts')],
      ...Object.fromEntries(
        subpaths.map((subpath) => [
          `@libraz/mejiro/${subpath}`,
          [absolute(CORE, `src/${subpath}/index.ts`)],
        ]),
      ),
    },
  });
  cachedProgram = { program, checker: program.getTypeChecker() };
  return cachedProgram;
}

function exportsOfBarrel(barrel: string): ts.Symbol[] {
  const { program, checker } = createProgram();
  const sourceFile = program.getSourceFile(barrel);
  expect(sourceFile, `barrel not found: ${barrel}`).toBeDefined();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile as ts.SourceFile);
  expect(moduleSymbol, `barrel exports nothing: ${barrel}`).toBeDefined();
  return checker.getExportsOfModule(moduleSymbol as ts.Symbol);
}

function resolveAlias(symbol: ts.Symbol): ts.Symbol {
  const { checker } = createProgram();
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

/** True when the declaration introduces a named type a consumer could import. */
function isTypeDeclaration(declaration: ts.Declaration): boolean {
  return (
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration) ||
    ts.isClassDeclaration(declaration) ||
    ts.isEnumDeclaration(declaration)
  );
}

/** Declarations of `symbol` that live in this repository. */
function localDeclarations(symbol: ts.Symbol | undefined): ts.Declaration[] {
  return (symbol?.getDeclarations() ?? []).filter((declaration) => {
    const fileName = declaration.getSourceFile().fileName;
    return fileName.startsWith(PACKAGES_ROOT) && !fileName.includes('node_modules');
  });
}

/** True when the declaration is marked `@internal` and is therefore out of scope. */
function isInternal(declaration: ts.Node): boolean {
  const documented = ts.isVariableDeclaration(declaration)
    ? declaration.parent.parent
    : declaration;
  return ts
    .getJSDocCommentsAndTags(documented)
    .some(
      (doc) => ts.isJSDoc(doc) && (doc.tags ?? []).some((tag) => tag.tagName.text === 'internal'),
    );
}

/** Members that a consumer cannot observe, and whose types stay private with them. */
function isHidden(node: ts.Node): boolean {
  if (!(ts.isClassElement(node) || ts.isTypeElement(node))) return false;
  const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  if (
    modifiers.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword,
    )
  ) {
    return true;
  }
  return node.name !== undefined && ts.isPrivateIdentifier(node.name);
}

/** Collects a package's own barrel exports plus the core ones it re-uses. */
function publicSymbolsFor(pkg: PublicPackage): Set<ts.Symbol> {
  const barrels =
    pkg === CORE
      ? pkg.barrels.map((barrel) => absolute(pkg, barrel))
      : [
          ...pkg.barrels.map((barrel) => absolute(pkg, barrel)),
          ...CORE.barrels.map((barrel) => absolute(CORE, barrel)),
        ];
  const symbols = new Set<ts.Symbol>();
  for (const barrel of barrels) {
    for (const exported of exportsOfBarrel(barrel)) symbols.add(resolveAlias(exported));
  }
  return symbols;
}

const findingsCache = new Map<string, Finding[]>();

/** Walks the public surface of `pkg` and reports the types it cannot name. */
function findUnreachable(pkg: PublicPackage): Finding[] {
  const cached = findingsCache.get(pkg.dir);
  if (cached) return cached;
  const findings = scanUnreachable(pkg);
  findingsCache.set(pkg.dir, findings);
  return findings;
}

function scanUnreachable(pkg: PublicPackage): Finding[] {
  const { checker } = createProgram();
  const publicSymbols = publicSymbolsFor(pkg);
  const findings = new Map<string, Finding>();

  const record = (symbol: ts.Symbol, from: string): void => {
    const declarations = localDeclarations(symbol);
    if (declarations.length === 0) return;
    if (!declarations.some(isTypeDeclaration)) return;
    if (publicSymbols.has(symbol)) return;
    if (declarations.every(isInternal)) return;
    const sourceFile = declarations[0].getSourceFile();
    const module = path.relative(PACKAGES_ROOT, sourceFile.fileName);
    const key = `${module}:${symbol.getName()}`;
    if (findings.has(key)) return;
    const line =
      sourceFile.getLineAndCharacterOfPosition(declarations[0].getStart(sourceFile)).line + 1;
    findings.set(key, { key, line, from });
  };

  // Pass 1 — written syntax. Function bodies and non-public members are skipped:
  // the types they mention stay inside the implementation.
  const visitedSymbols = new Set<ts.Symbol>();
  const walkSyntax = (symbol: ts.Symbol): void => {
    if (visitedSymbols.has(symbol)) return;
    visitedSymbols.add(symbol);
    for (const declaration of localDeclarations(symbol)) {
      const references: ts.Node[] = [];
      const collect = (node: ts.Node): void => {
        if (ts.isBlock(node) || isHidden(node)) return;
        if (ts.isTypeReferenceNode(node)) references.push(node.typeName);
        else if (ts.isExpressionWithTypeArguments(node)) references.push(node.expression);
        else if (ts.isTypeQueryNode(node)) references.push(node.exprName);
        ts.forEachChild(node, collect);
      };
      ts.forEachChild(declaration, collect);

      for (const reference of references) {
        const referenced = checker.getSymbolAtLocation(reference);
        if (!referenced) continue;
        const resolved = resolveAlias(referenced);
        if (localDeclarations(resolved).length === 0) continue;
        const label = `${symbol.getName()} (${path.relative(PACKAGES_ROOT, declaration.getSourceFile().fileName)})`;
        record(resolved, label);
        walkSyntax(resolved);
      }
    }
  };

  // Pass 2 — checked types, for shapes that are inferred rather than written.
  // The walk stops at types owned by a dependency so it never descends into the
  // React or DOM surface, but still follows their type arguments.
  const visitedTypes = new Set<ts.Type>();
  const walkType = (type: ts.Type, from: string, depth: number): void => {
    if (depth > 12 || visitedTypes.has(type)) return;
    visitedTypes.add(type);

    if (type.aliasSymbol) record(type.aliasSymbol, from);
    for (const argument of type.aliasTypeArguments ?? []) walkType(argument, from, depth + 1);

    if (type.isUnionOrIntersection()) {
      for (const member of type.types) walkType(member, from, depth + 1);
      return;
    }

    const symbol = type.getSymbol();
    if (symbol) record(symbol, from);

    if (type.flags & ts.TypeFlags.Object) {
      const objectType = type as ts.ObjectType;
      if (objectType.objectFlags & ts.ObjectFlags.Reference) {
        for (const argument of checker.getTypeArguments(objectType as ts.TypeReference)) {
          walkType(argument, from, depth + 1);
        }
      }
    }

    const isOwn = symbol === undefined || localDeclarations(symbol).length > 0;
    if (!isOwn) return;

    const typeOf = (member: ts.Symbol): ts.Type | undefined => {
      const declaration = member.valueDeclaration ?? member.getDeclarations()?.[0];
      if (!declaration || isHidden(declaration)) return undefined;
      return checker.getTypeOfSymbolAtLocation(member, declaration);
    };

    for (const property of checker.getPropertiesOfType(type)) {
      const propertyType = typeOf(property);
      if (propertyType) walkType(propertyType, from, depth + 1);
    }
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      for (const parameter of signature.getParameters()) {
        const parameterType = typeOf(parameter);
        if (parameterType) walkType(parameterType, from, depth + 1);
      }
      walkType(signature.getReturnType(), from, depth + 1);
    }
  };

  for (const barrel of checkedBarrels(pkg)) {
    for (const exported of exportsOfBarrel(absolute(pkg, barrel))) {
      const symbol = resolveAlias(exported);
      const label = `${exported.getName()} (${pkg.dir}/${barrel})`;
      walkSyntax(symbol);

      const declaration = symbol.valueDeclaration ?? symbol.getDeclarations()?.[0];
      if (!declaration) continue;
      const isTypeOnly = symbol.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface);
      walkType(
        isTypeOnly
          ? checker.getDeclaredTypeOfSymbol(symbol)
          : checker.getTypeOfSymbolAtLocation(symbol, declaration),
        label,
        0,
      );
    }
  }

  return [...findings.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Types the audited signatures reach, listed per entry point they must come from. */
const REQUIRED_EXPORTS: readonly { entry: string; barrel: string; types: readonly string[] }[] = [
  {
    entry: '@libraz/mejiro',
    barrel: absolute(CORE, 'src/index.ts'),
    types: [
      'BinaryInput',
      'CanBreakAtOptions',
      'ChapterSource',
      'HeadingLevel',
      'KinsokuCheckOptions',
      'KinsokuRuleSource',
      'MejiroErrorCode',
      'MejiroWarning',
      'MejiroWarningCode',
      'ParsedManuscript',
      'ExclusionResult',
      'ComputeExclusionSlotsInput',
    ],
  },
  {
    entry: '@libraz/mejiro/browser',
    barrel: absolute(CORE, 'src/browser/index.ts'),
    types: [
      'CharMeasurerOptions',
      'FontLoaderOptions',
      'LayoutTextOptions',
      'ParagraphsLayoutResult',
      'WidthCacheStats',
    ],
  },
  {
    entry: '@libraz/mejiro/render',
    barrel: absolute(CORE, 'src/render/index.ts'),
    types: ['AdjustExclusionSlotsInput', 'BuildColumnSlotsInput', 'FindPhysicalColumnInput'],
  },
  {
    entry: '@libraz/mejiro/epub',
    barrel: absolute(CORE, 'src/epub/index.ts'),
    types: [
      'CoverInput',
      'EditHistoryState',
      'EditableEpubExportOptions',
      'EpubProjectImageInput',
      'ManuscriptChapter',
      'EpubExportOptions',
      'MergeParagraphsInput',
      'NewParagraph',
      'ParagraphPatch',
      'ParsedManuscript',
    ],
  },
  {
    entry: '@libraz/mejiro/analysis',
    barrel: absolute(CORE, 'src/analysis/index.ts'),
    types: ['SuzumeAnalysis', 'SuzumeInstance', 'SuzumeMorpheme'],
  },
  {
    entry: '@libraz/mejiro/book',
    barrel: absolute(CORE, 'src/book/index.ts'),
    types: [
      'AnchorAtOptions',
      'BookOptionsPatch',
      'ChapterTypography',
      'FitPageSizeOptions',
      'FormatReadingTimeOptions',
      'PageGeometry',
      'ResolvedBookOptions',
      'SpreadImagesSnapshot',
      'SpreadPoint',
    ],
  },
  {
    entry: '@libraz/mejiro-react',
    barrel: absolute(FRAMEWORK_PACKAGES[0], 'src/index.ts'),
    types: [
      'ImageOverlayRect',
      'ChapterLayoutRecomputeOptions',
      'ManuscriptAutosaveDraft',
      'MejiroReaderManuscriptProps',
      'UseMejiroBookOptions',
    ],
  },
  {
    entry: '@libraz/mejiro-vue',
    barrel: absolute(FRAMEWORK_PACKAGES[1], 'src/index.ts'),
    types: [
      'ImageOverlayRect',
      'ChapterLayoutRecomputeOptions',
      'ManuscriptAutosaveDraft',
      'UseMejiroBookOptions',
    ],
  },
];

describe('type reachability from public entry points', () => {
  it.each(
    PUBLIC_PACKAGES.filter((pkg) => checkedBarrels(pkg).length > 0).map(
      (pkg) => [pkg.dir, pkg] as const,
    ),
  )('names every type reachable from the public surface of %s', (_dir, pkg) => {
    const unexpected = findUnreachable(pkg)
      .filter((finding) => !UNREACHABLE_TYPES.includes(finding.key))
      .map((finding) => {
        const [module, symbol] = finding.key.split(':');
        return `${module}:${finding.line} ${symbol} (reached from ${finding.from})`;
      });

    expect(
      unexpected,
      'These types appear in a public signature but cannot be imported by name. ' +
        'Add them to the barrel of the entry point that exposes them rather than ' +
        'extending the ratchet list.',
    ).toEqual([]);
  });

  it.runIf(CHECK_PREFIXES.length > 0)(
    'walks at least one barrel under MEJIRO_CHECK_MODULES',
    () => {
      const exported = PUBLIC_PACKAGES.flatMap((pkg) =>
        checkedBarrels(pkg).flatMap((barrel) => exportsOfBarrel(absolute(pkg, barrel))),
      );
      expect(exported).not.toEqual([]);
    },
  );

  // With a prefix filter, gaps behind the barrels left out would read as stale.
  it.skipIf(CHECK_PREFIXES.length > 0)('keeps every ratchet entry grounded in a real gap', () => {
    const gaps = new Set(PUBLIC_PACKAGES.flatMap((pkg) => findUnreachable(pkg)).map((f) => f.key));

    // A stale entry would silently absorb a future regression under the same
    // module and symbol name, so require each one to still describe a real gap.
    expect(UNREACHABLE_TYPES.filter((entry) => !gaps.has(entry))).toEqual([]);
  });

  it.each(
    REQUIRED_EXPORTS.filter((required) => isChecked(required.barrel)).map(
      (required) => [required.entry, required] as const,
    ),
  )('exports the audited type names from %s', (_entry, required) => {
    const exported = new Set(exportsOfBarrel(required.barrel).map((symbol) => symbol.getName()));
    expect(required.types.filter((name) => !exported.has(name))).toEqual([]);
  });
});
