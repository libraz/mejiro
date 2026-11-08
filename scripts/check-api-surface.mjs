#!/usr/bin/env node
/**
 * Mechanical check of the public-interface conventions.
 *
 * Reads the declarations exported from the nine published entry points with
 * the TypeScript compiler API (`@libraz/mejiro*` resolved to the sources) and
 * reports:
 *
 * - vocabulary rules matched against whole identifiers of export, property,
 *   parameter and method names, and of Vue props and emits;
 * - structure rules: anonymous object types and non-readonly array types in
 *   parameters, returns and properties, and `any` in repo-declared types;
 * - `@deprecated` tags, `stripInternal` in each package tsconfig, and stale
 *   allowlist entries (`--all` only);
 * - with `--parity`, React/Vue drift in the props, events and return keys of
 *   same-named components and hooks.
 *
 * Usage:
 *   node scripts/check-api-surface.mjs --all
 *   node scripts/check-api-surface.mjs --files <repo-relative paths...>
 *   node scripts/check-api-surface.mjs --parity [--files <paths...>]
 *   node scripts/check-api-surface.mjs --baseline <out>
 *
 * Exit status: 0 clean, 1 violations, 2 usage error or `--files` matching no
 * declaration. Exceptions live in `packages/mejiro/tests/api-surface-allowlist.json`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const ENTRIES = [
  'packages/mejiro/src/index.ts',
  'packages/mejiro/src/browser/index.ts',
  'packages/mejiro/src/epub/index.ts',
  'packages/mejiro/src/render/index.ts',
  'packages/mejiro/src/book/index.ts',
  'packages/mejiro/src/image/index.ts',
  'packages/mejiro/src/analysis/index.ts',
  'packages/mejiro-react/src/index.ts',
  'packages/mejiro-vue/src/index.ts',
];
const REACT_ENTRY = 'packages/mejiro-react/src/index.ts';
const VUE_ENTRY = 'packages/mejiro-vue/src/index.ts';
const PACKAGE_TSCONFIGS = [
  'packages/mejiro/tsconfig.json',
  'packages/mejiro-react/tsconfig.json',
  'packages/mejiro-vue/tsconfig.json',
];
const ALLOWLIST = 'packages/mejiro/tests/api-surface-allowlist.json';
const SOURCE_DIRS = [
  'packages/mejiro/src/',
  'packages/mejiro-react/src/',
  'packages/mejiro-vue/src/',
];

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { all: false, parity: false, files: null, baseline: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') args.all = true;
    else if (arg === '--parity') args.parity = true;
    else if (arg === '--baseline') args.baseline = argv[++i];
    else if (arg === '--files') {
      args.files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args.files.push(argv[++i]);
    } else usage(`unknown argument: ${arg}`);
  }
  if (args.baseline !== null && !args.baseline) usage('--baseline needs an output path');
  if (args.files !== null && args.files.length === 0) usage('--files needs at least one path');
  if (args.baseline) args.all = true;
  if (!(args.all || args.parity || args.files))
    usage('pass --all, --files, --parity or --baseline');
  if (args.all && args.files) usage('--all and --files are exclusive');
  if (args.files)
    args.files = args.files.map((file) => path.relative(ROOT, path.resolve(ROOT, file)));
  return args;
}

function usage(message) {
  console.error(`check-api-surface: ${message}`);
  console.error(
    'usage: check-api-surface.mjs (--all | --files <paths...> | --parity [--files <paths...>] | --baseline <out>)',
  );
  process.exit(2);
}

// ---------------------------------------------------------------- program

function createProgram() {
  const core = (file) => path.join(ROOT, 'packages/mejiro/src', file);
  const subpaths = ['analysis', 'book', 'browser', 'epub', 'image', 'render'];
  return ts.createProgram(
    ENTRIES.map((entry) => path.join(ROOT, entry)),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      paths: {
        '@libraz/mejiro': [core('index.ts')],
        ...Object.fromEntries(
          subpaths.map((sub) => [`@libraz/mejiro/${sub}`, [core(`${sub}/index.ts`)]]),
        ),
      },
    },
  );
}

const program = createProgram();
const checker = program.getTypeChecker();

function rel(fileName) {
  return path.relative(ROOT, fileName);
}

function isRepoSource(fileName) {
  const file = rel(fileName);
  return SOURCE_DIRS.some((dir) => file.startsWith(dir));
}

function lineOf(node) {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function resolveAlias(symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function exportsOf(entry) {
  const sf = program.getSourceFile(path.join(ROOT, entry));
  if (!sf) throw new Error(`entry not found: ${entry}`);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  return moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
}

function hasJsDocTag(node, tagName) {
  const target = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  return ts
    .getJSDocCommentsAndTags(target)
    .some((doc) => ts.isJSDoc(doc) && (doc.tags ?? []).some((tag) => tag.tagName.text === tagName));
}

function isHiddenMember(node) {
  const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
  if (
    modifiers.some(
      (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
    )
  ) {
    return true;
  }
  if (node.name && ts.isPrivateIdentifier(node.name)) return true;
  return hasJsDocTag(node, 'internal');
}

function memberName(node) {
  if (!node.name) return undefined;
  if (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) return node.name.text;
  if (ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) return node.name.text;
  return node.name.getText();
}

// ---------------------------------------------------------------- violations

/** @type {{ rule: string, file: string, line: number, name: string, message: string }[]} */
const violations = [];

function report(rule, node, name, message) {
  violations.push({
    rule,
    file: rel(node.getSourceFile().fileName),
    line: lineOf(node),
    name,
    message,
  });
}

// ---------------------------------------------------------------- type predicates

function nonNullable(type) {
  return type.isUnion()
    ? type.types.filter((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)))
    : [type];
}

function isNumberType(type) {
  if (!type) return false;
  const parts = nonNullable(type);
  return parts.length > 0 && parts.every((t) => t.flags & ts.TypeFlags.NumberLike);
}

function isKinsokuModeType(type) {
  if (!type) return false;
  if (type.aliasSymbol?.name === 'KinsokuMode') return true;
  const parts = nonNullable(type);
  if (parts.length === 1 && parts[0].aliasSymbol?.name === 'KinsokuMode') return true;
  const literals = parts.map((t) => (t.isStringLiteral() ? t.value : null));
  return literals.length === 2 && literals.includes('strict') && literals.includes('loose');
}

const BOOK_DATA_TYPES = new Set(['EpubBook', 'EditableEpubBook']);

/** True when the type is, or wraps (`Ref<…>`, a union), EPUB book data. */
function containsBookData(type, depth = 0) {
  if (!type || depth > 3) return false;
  if (BOOK_DATA_TYPES.has(type.aliasSymbol?.name) || BOOK_DATA_TYPES.has(type.getSymbol()?.name))
    return true;
  if (type.isUnionOrIntersection()) return type.types.some((t) => containsBookData(t, depth + 1));
  const args = [
    ...(type.aliasTypeArguments ?? []),
    ...(type.flags & ts.TypeFlags.Object && type.objectFlags & ts.ObjectFlags.Reference
      ? checker.getTypeArguments(type)
      : []),
  ];
  return args.some((t) => containsBookData(t, depth + 1));
}

// ---------------------------------------------------------------- vocabulary rules

const FONT_NAMES = new Set(['fixedFontFamily', 'fixedFontSize', 'fontKey']);
const TIME_NAMES = new Set(['throttleMs', 'resizeDebounce', 'autosaveDelay', 'turnDuration']);
const CHROME_NAMES = new Set([
  'enableHeader',
  'enableStats',
  'enablePageIndicator',
  'enableSettings',
  'enableChapterNav',
  'enableImageOverlay',
  'enableExport',
  'searchable',
  'bare',
]);
const HANDLER_NAMES = new Set(['onChange', 'onSpreadChange', 'onChapterCompleted']);
const PROPERTY_KINDS = new Set(['property', 'vue-prop']);

/**
 * Applies the vocabulary rules to one declared name.
 *
 * @param {string} name - Identifier as declared.
 * @param {'export'|'property'|'parameter'|'method'|'vue-prop'|'vue-emit'} kind
 * @param {{ node: import('typescript').Node, qualified: string, type?: () => import('typescript').Type | undefined, siblings?: Set<string>, inHook?: boolean }} ctx
 */
function checkName(name, kind, ctx) {
  const hit = (rule, message) =>
    report(`vocabulary/${rule}`, ctx.node, ctx.qualified, `'${name}' ${message}`);
  const isProperty = PROPERTY_KINDS.has(kind);
  const typed = kind === 'property' || kind === 'vue-prop' || kind === 'parameter';

  if (/Idx$|Idx[A-Z]/.test(name)) hit('idx', 'abbreviates index; use xxxIndex');
  if (
    isProperty &&
    (name === 'w' || name === 'h') &&
    ctx.siblings?.has('x') &&
    ctx.siblings?.has('y')
  ) {
    hit('rect', 'beside x/y; use width/height');
  }
  if (FONT_NAMES.has(name)) hit('font', 'use fontFamily / fontSize / fontSpec');
  if (isProperty && name === 'kinsokuRules') hit('kinsoku', 'use kinsoku');
  if (isProperty && name === 'mode' && isKinsokuModeType(ctx.type?.()))
    hit('kinsoku', 'is a kinsoku mode; use kinsoku');
  if (/^total[A-Z]/.test(name)) hit('count', 'use xxxCount');
  if (TIME_NAMES.has(name)) hit('time', 'carries no unit; use a ...Ms name');
  if (typed && name === 'debounce' && isNumberType(ctx.type?.()))
    hit('time', 'is a number without unit; use debounceMs');
  if (CHROME_NAMES.has(name)) hit('chrome', 'is a renamed chrome flag');
  if (isProperty && (name === 'single' || name === 'singlePage')) hit('single', 'use spreadMode');
  if (isProperty && name === 'previewBook') hit('book-slot', 'use previewEpub');
  if (isProperty && name === 'book' && containsBookData(ctx.type?.()))
    hit('book-slot', 'holds EPUB data; use epub');
  if (HANDLER_NAMES.has(name) || ((isProperty || kind === 'vue-emit') && name === 'onSelect')) {
    hit('handler', 'is a renamed handler');
  }
  if (/^patch[A-Z]/.test(name)) hit('merge', 'use updateXxx');
  if (isProperty && name === 'defaultUrl' && ctx.inHook) hit('initial', 'hook options take url');
  if (typed && (name === 'chapter' || name === 'paragraph') && isNumberType(ctx.type?.())) {
    hit('bare-index', `is a number; use ${name}Index`);
  }
}

// ---------------------------------------------------------------- structure rules

function isReadonlyOperator(node) {
  return ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword;
}

/**
 * Walks a written type node in a public position.
 *
 * @param {import('typescript').TypeNode | undefined} node
 * @param {string} qualified - Name of the position, for the report.
 * @param {{ named?: boolean, rest?: boolean, inHook?: boolean }} [flags] - `named`: the node is
 *   the body of a type alias, which names its top-level object literals.
 */
function walkTypeNode(node, qualified, flags = {}) {
  if (!node) return;
  const { inHook } = flags;
  const visit = (n, named, readonlyParent, rest) => {
    if (ts.isTypeLiteralNode(n)) {
      if (!named)
        report(
          'structure/anonymous-object',
          n,
          qualified,
          'anonymous object type; declare a named type',
        );
      walkMembers(n.members, qualified, { inHook });
      return;
    }
    if (ts.isParenthesizedTypeNode(n)) return visit(n.type, named, readonlyParent, rest);
    if ((ts.isUnionTypeNode(n) || ts.isIntersectionTypeNode(n)) && named) {
      for (const t of n.types) visit(t, true, false, false);
      return;
    }
    if (n.kind === ts.SyntaxKind.AnyKeyword) {
      report('structure/any', n, qualified, '`any` in a public type');
      return;
    }
    if (isReadonlyOperator(n)) return visit(n.type, false, true, rest);
    if (ts.isArrayTypeNode(n) || ts.isTupleTypeNode(n)) {
      if (!(readonlyParent || rest))
        report('structure/mutable-array', n, qualified, 'array type is not readonly');
      ts.forEachChild(n, (child) => visit(child, false, false, false));
      return;
    }
    if (
      ts.isTypeReferenceNode(n) &&
      ts.isIdentifier(n.typeName) &&
      n.typeName.text === 'Array' &&
      !rest
    ) {
      report('structure/mutable-array', n, qualified, 'Array<T> is not readonly; use readonly T[]');
    }
    if (ts.isFunctionTypeNode(n) || ts.isConstructorTypeNode(n)) {
      walkSignature(n, qualified, { inHook });
      return;
    }
    if (ts.isMappedTypeNode(n)) {
      if (n.type) visit(n.type, false, false, false);
      return;
    }
    ts.forEachChild(n, (child) => {
      if (ts.isTypeNode(child)) visit(child, false, false, false);
    });
  };
  visit(node, Boolean(flags.named), false, Boolean(flags.rest));
}

/** Checks an inferred type (no annotation was written) at a public position. */
function checkInferredType(type, node, qualified, depth = 0) {
  if (!type || depth > 3) return;
  if (type.flags & ts.TypeFlags.Any) {
    report('structure/any', node, qualified, 'inferred `any` in a public type');
    return;
  }
  if (type.isUnion()) {
    for (const t of type.types) checkInferredType(t, node, qualified, depth + 1);
    return;
  }
  if (!(type.flags & ts.TypeFlags.Object)) return;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const target = type.target;
    const isReadonly = checker.isTupleType(type)
      ? target.readonly
      : target.symbol?.name === 'ReadonlyArray';
    if (!isReadonly)
      report('structure/mutable-array', node, qualified, 'inferred array type is not readonly');
    for (const arg of checker.getTypeArguments(type))
      checkInferredType(arg, node, qualified, depth + 1);
    return;
  }
  const symbol = type.getSymbol();
  if (type.objectFlags & ts.ObjectFlags.Reference) {
    for (const arg of checker.getTypeArguments(type))
      checkInferredType(arg, node, qualified, depth + 1);
  }
  const isAnonymousLiteral =
    !type.aliasSymbol &&
    symbol &&
    (symbol.name === '__object' || symbol.name === '__type') &&
    type.getCallSignatures().length === 0 &&
    type.getConstructSignatures().length === 0;
  if (!isAnonymousLiteral) return;
  report(
    'structure/anonymous-object',
    node,
    qualified,
    'inferred anonymous object type; declare a named type',
  );
  const siblings = new Set(checker.getPropertiesOfType(type).map((p) => p.name));
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!(declaration && isRepoSource(declaration.getSourceFile().fileName))) continue;
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
    checkName(property.name, 'property', {
      node: declaration,
      qualified: `${qualified}.${property.name}`,
      type: () => propertyType,
      siblings,
    });
    checkInferredType(propertyType, declaration, `${qualified}.${property.name}`, depth + 1);
  }
}

/** Walks the parameters and return type of a signature-like node. */
function walkSignature(node, owner, { inHook } = {}) {
  for (const parameter of node.parameters ?? []) {
    const isBinding = !ts.isIdentifier(parameter.name);
    const name = isBinding ? undefined : parameter.name.text;
    const qualified = `${owner}(${name ?? '{…}'})`;
    if (name && name !== 'this') {
      checkName(name, 'parameter', {
        node: parameter,
        qualified,
        type: () => checker.getTypeAtLocation(parameter),
      });
    }
    walkTypeNode(parameter.type, qualified, { rest: Boolean(parameter.dotDotDotToken), inHook });
  }
  const returnQualified = `${owner}()`;
  if (node.type) walkTypeNode(node.type, returnQualified, { inHook });
  else if (
    !(
      ts.isFunctionTypeNode(node) ||
      ts.isConstructorTypeNode(node) ||
      ts.isConstructorDeclaration(node)
    )
  ) {
    const signature = checker.getSignatureFromDeclaration(node);
    if (signature)
      checkInferredType(checker.getReturnTypeOfSignature(signature), node, returnQualified);
  }
}

/** Walks the members of an interface, class or type literal. */
function walkMembers(members, container, { inHook } = {}) {
  const siblings = new Set(members.map(memberName).filter(Boolean));
  for (const member of members) {
    if (isHiddenMember(member)) continue;
    const name = memberName(member);
    const qualified = name ? `${container}.${name}` : container;
    if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
      checkName(name, 'property', {
        node: member,
        qualified,
        type: () => checker.getTypeAtLocation(member),
        siblings,
        inHook,
      });
      if (member.type) walkTypeNode(member.type, qualified, { inHook });
      else checkInferredType(checker.getTypeAtLocation(member), member, qualified);
    } else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      checkName(name, 'property', {
        node: member,
        qualified,
        type: () => checker.getTypeAtLocation(member),
        siblings,
        inHook,
      });
      if (ts.isGetAccessorDeclaration(member)) {
        if (member.type) walkTypeNode(member.type, qualified, { inHook });
        else checkInferredType(checker.getTypeAtLocation(member), member, qualified);
      } else {
        for (const parameter of member.parameters)
          walkTypeNode(parameter.type, qualified, { inHook });
      }
    } else if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
      checkName(name, 'method', { node: member, qualified });
      if (ts.isMethodDeclaration(member) && member.body && isOverloadImplementation(member))
        continue;
      walkSignature(member, qualified, { inHook });
    } else if (ts.isConstructorDeclaration(member)) {
      if (member.body && isOverloadImplementation(member)) continue;
      walkSignature(member, `${container}.constructor`, { inHook });
    } else if (
      ts.isCallSignatureDeclaration(member) ||
      ts.isConstructSignatureDeclaration(member)
    ) {
      walkSignature(member, container, { inHook });
    } else if (ts.isIndexSignatureDeclaration(member)) {
      walkTypeNode(member.type, `${container}[]`, { inHook });
    }
  }
}

function isOverloadImplementation(declaration) {
  const symbol = declaration.symbol ?? checker.getSymbolAtLocation(declaration.name ?? declaration);
  const declarations = symbol?.declarations ?? [];
  return declarations.filter((d) => d.kind === declaration.kind).length > 1;
}

// ---------------------------------------------------------------- Vue components

function isCallTo(node, name) {
  return (
    node &&
    ts.isCallExpression(node) &&
    ((ts.isIdentifier(node.expression) && node.expression.text === name) ||
      (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name))
  );
}

/** Resolves an identifier to the object/array literal it is initialised with. */
function literalOf(expression) {
  let node = expression;
  for (let i = 0; i < 5 && node; i++) {
    while (
      node &&
      (ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isParenthesizedExpression(node))
    ) {
      node = node.expression;
    }
    if (!node || ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node))
      return node;
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = checker.getSymbolAtLocation(node);
    const declaration = symbol && resolveAlias(symbol).valueDeclaration;
    if (!(declaration && ts.isVariableDeclaration(declaration))) return undefined;
    node = declaration.initializer;
  }
  return undefined;
}

function propertyKey(property) {
  if (!property.name) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    return property.name.text;
  return undefined;
}

/** Entries `{ name, node, value }` of an object literal, following spreads. */
function objectEntries(literal) {
  const out = [];
  if (!literal) return out;
  if (ts.isArrayLiteralExpression(literal)) {
    for (const element of literal.elements) {
      if (ts.isStringLiteral(element))
        out.push({ name: element.text, node: element, value: undefined });
    }
    return out;
  }
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      out.push(...objectEntries(literalOf(property.expression)));
      continue;
    }
    const name = propertyKey(property);
    if (name === undefined) continue;
    const value = ts.isPropertyAssignment(property) ? property.initializer : undefined;
    out.push({ name, node: property, value });
  }
  return out;
}

/** The `defineComponent` options object of a Vue component declaration. */
function vueOptions(declaration) {
  if (
    !(ts.isVariableDeclaration(declaration) && isCallTo(declaration.initializer, 'defineComponent'))
  )
    return undefined;
  return literalOf(declaration.initializer.arguments[0]);
}

function optionEntry(options, key) {
  return objectEntries(options).find((entry) => entry.name === key);
}

/** The written `PropType<T>` argument of a Vue prop definition, if any. */
function vuePropTypeNode(definition) {
  const literal = literalOf(definition);
  const typeEntry =
    literal && ts.isObjectLiteralExpression(literal) ? optionEntry(literal, 'type') : undefined;
  let value = typeEntry ? typeEntry.value : definition;
  while (value && ts.isParenthesizedExpression(value)) value = value.expression;
  if (value && ts.isAsExpression(value) && ts.isTypeReferenceNode(value.type)) {
    const ref = value.type;
    if (ts.isIdentifier(ref.typeName) && ref.typeName.text === 'PropType')
      return ref.typeArguments?.[0];
  }
  return undefined;
}

/** The type a Vue prop definition declares, from `PropType<T>` or a constructor. */
function vuePropType(definition) {
  const typeNode = vuePropTypeNode(definition);
  if (typeNode) return checker.getTypeFromTypeNode(typeNode);
  const literal = literalOf(definition);
  const typeEntry =
    literal && ts.isObjectLiteralExpression(literal) ? optionEntry(literal, 'type') : undefined;
  const ctor = typeEntry ? typeEntry.value : definition;
  if (ctor && ts.isIdentifier(ctor) && ctor.text === 'Number') return checker.getNumberType();
  return undefined;
}

function vueProps(declaration) {
  const options = vueOptions(declaration);
  const props = options && optionEntry(options, 'props');
  return props ? objectEntries(literalOf(props.value)) : [];
}

function vueEmits(declaration) {
  const options = vueOptions(declaration);
  const emits = options && optionEntry(options, 'emits');
  return emits ? objectEntries(literalOf(emits.value)) : [];
}

function camelFromKebab(name) {
  return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function kebabFromCamel(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function walkVueComponent(declaration, exportName) {
  const props = vueProps(declaration);
  const siblings = new Set(props.map((p) => p.name));
  for (const prop of props) {
    const qualified = `${exportName}.props.${prop.name}`;
    checkName(prop.name, 'vue-prop', {
      node: prop.node,
      qualified,
      type: () => vuePropType(prop.value),
      siblings,
    });
    walkTypeNode(vuePropTypeNode(prop.value), qualified);
  }
  for (const emit of vueEmits(declaration)) {
    const qualified = `${exportName}.emits.${emit.name}`;
    const update = emit.name.match(/^update:(.+)$/);
    const name = update
      ? update[1]
      : `on${camelFromKebab(emit.name).replace(/^./, (c) => c.toUpperCase())}`;
    checkName(name, 'vue-emit', { node: emit.node, qualified });
  }
  // The type `defineComponent` infers is generated by Vue; report the `any` it
  // carries so the allowlist states the exemption instead of the code hiding it.
  const type = checker.getTypeAtLocation(declaration.name);
  const args = [
    ...(type.aliasTypeArguments ?? []),
    ...(type.objectFlags & ts.ObjectFlags.Reference ? checker.getTypeArguments(type) : []),
  ];
  if (args.some((arg) => arg.flags & ts.TypeFlags.Any)) {
    report(
      'structure/any',
      declaration,
      `${exportName} [defineComponent]`,
      'type generated by defineComponent carries `any`',
    );
  }
}

// ---------------------------------------------------------------- declarations

/** Walks one exported declaration. */
function walkDeclaration(declaration, exportName) {
  const inHook = /^use[A-Z]/i.test(exportName);
  if (ts.isInterfaceDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
    walkMembers(declaration.members, exportName, { inHook });
    for (const clause of declaration.heritageClauses ?? []) {
      for (const heritage of clause.types) {
        for (const arg of heritage.typeArguments ?? []) walkTypeNode(arg, exportName, { inHook });
      }
    }
  } else if (ts.isTypeAliasDeclaration(declaration)) {
    walkTypeNode(declaration.type, exportName, { named: true, inHook });
  } else if (ts.isFunctionDeclaration(declaration)) {
    if (declaration.body && isOverloadImplementation(declaration)) return;
    walkSignature(declaration, exportName, { inHook });
  } else if (ts.isVariableDeclaration(declaration)) {
    const init = declaration.initializer;
    if (declaration.type) {
      walkTypeNode(declaration.type, exportName, { inHook });
    } else if (isCallTo(init, 'defineComponent')) {
      walkVueComponent(declaration, exportName);
    } else if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
      walkSignature(init, exportName, { inHook });
    } else if (isCallTo(init, 'forwardRef') || isCallTo(init, 'memo')) {
      // The props type is an exported interface and is walked on its own.
    } else {
      checkInferredType(checker.getTypeAtLocation(declaration.name), declaration, exportName);
    }
  }
}

/** Every repo-declared exported declaration with its export name, deduplicated. */
function collectDeclarations() {
  const seen = new Map();
  for (const entry of ENTRIES) {
    for (const exported of exportsOf(entry)) {
      const symbol = resolveAlias(exported);
      for (const declaration of symbol.declarations ?? []) {
        if (!isRepoSource(declaration.getSourceFile().fileName)) continue;
        if (ts.isSourceFile(declaration) || ts.isModuleDeclaration(declaration)) continue;
        if (hasJsDocTag(declaration, 'internal')) continue;
        if (!seen.has(declaration)) seen.set(declaration, exported.getName());
      }
    }
  }
  return [...seen].map(([declaration, name]) => ({ declaration, name }));
}

function declarationFile(declaration) {
  return rel(declaration.getSourceFile().fileName);
}

function checkSurface(files) {
  const declarations = collectDeclarations().filter(
    ({ declaration }) => !files || files.includes(declarationFile(declaration)),
  );
  for (const { declaration, name } of declarations) {
    checkName(name, 'export', { node: declaration, qualified: name });
    walkDeclaration(declaration, name);
  }
  return declarations.length;
}

function checkDeprecated(files) {
  for (const sf of program.getSourceFiles()) {
    if (!isRepoSource(sf.fileName)) continue;
    if (files && !files.includes(rel(sf.fileName))) continue;
    // A doc block is visible from several nodes of the statement it documents.
    const seen = new Set();
    const visit = (node) => {
      for (const doc of ts.getJSDocCommentsAndTags(node)) {
        if (!ts.isJSDoc(doc)) continue;
        for (const tag of doc.tags ?? []) {
          if (tag.tagName.text === 'deprecated' && !seen.has(tag)) {
            seen.add(tag);
            const owner = ts.isVariableStatement(node)
              ? node.declarationList.declarations[0]
              : node;
            const name = owner.name ? owner.name.getText(sf) : ts.SyntaxKind[node.kind];
            report('deprecated', tag, name, '@deprecated tag in the sources');
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

function checkTsconfigs() {
  for (const file of PACKAGE_TSCONFIGS) {
    const parsed = ts.readConfigFile(path.join(ROOT, file), ts.sys.readFile);
    const options = parsed.config?.compilerOptions ?? {};
    if (options.stripInternal !== true) {
      violations.push({
        rule: 'tsconfig/stripInternal',
        file,
        line: 1,
        name: file,
        message: 'compilerOptions.stripInternal is not true',
      });
    }
  }
}

// ---------------------------------------------------------------- parity

function isComponentDeclaration(declaration) {
  return (
    ts.isVariableDeclaration(declaration) && isCallTo(declaration.initializer, 'defineComponent')
  );
}

function repoProperties(type) {
  const out = [];
  if (!type) return out;
  const parts = nonNullable(type);
  for (const part of parts) {
    if (!(part.flags & ts.TypeFlags.Object || part.isIntersection())) continue;
    for (const property of checker.getPropertiesOfType(part)) {
      const declarations = (property.declarations ?? []).filter((d) =>
        isRepoSource(d.getSourceFile().fileName),
      );
      if (declarations.length === 0) continue;
      if (declarations.every((d) => isHiddenMember(d))) continue;
      out.push({ name: property.name, node: declarations[0] });
    }
  }
  return out;
}

/** React prop name → the key its Vue counterpart uses (onXxxChange ↔ update:xxx, onXxx ↔ kebab emit). `xxxClassName` pairs with Vue's `xxxClass` (each framework's word). */
function reactKey(name) {
  const className = name.match(/^(\w+)ClassName$/);
  if (className) return `${className[1]}Class`;
  const change = name.match(/^on([A-Z]\w*)Change$/);
  if (change) return `update:${lowerFirst(change[1])}`;
  const handler = name.match(/^on([A-Z]\w*)$/);
  if (handler) return kebabFromCamel(lowerFirst(handler[1]));
  return name;
}

function callSignature(declaration) {
  const type = checker.getTypeAtLocation(
    ts.isVariableDeclaration(declaration) || ts.isFunctionDeclaration(declaration)
      ? declaration.name
      : declaration,
  );
  return type.getCallSignatures()[0];
}

function reactComponentKeys(declaration) {
  const signature = callSignature(declaration);
  const parameter = signature?.getParameters()[0];
  if (!parameter) return [];
  const propsType = checker.getTypeOfSymbolAtLocation(parameter, declaration);
  return repoProperties(propsType)
    .filter((p) => p.name !== 'ref' && p.name !== 'key')
    .map((p) => ({ key: reactKey(p.name), node: p.node }));
}

function vueComponentKeys(declaration) {
  const keys = vueProps(declaration).map((p) => ({ key: reactKey(p.name), node: p.node }));
  for (const emit of vueEmits(declaration)) {
    const key = emit.name.startsWith('update:') ? emit.name : kebabFromCamel(emit.name);
    keys.push({ key, node: emit.node });
  }
  return keys;
}

/** The value a library ref holds, or the type itself when it is not a ref. */
function unwrapRef(type, location) {
  const value = type.getProperty('value');
  const valueDeclaration = value?.declarations?.[0];
  if (valueDeclaration && !isRepoSource(valueDeclaration.getSourceFile().fileName)) {
    return checker.getTypeOfSymbolAtLocation(value, location);
  }
  return type;
}

/** Return keys and options keys of a hook; Vue refs and `MaybeRefOrGetter` are unwrapped. */
function hookKeys(declaration) {
  const signature = callSignature(declaration);
  if (!signature) return [];
  const keys = repoProperties(
    unwrapRef(checker.getReturnTypeOfSignature(signature), declaration),
  ).map((p) => ({ key: p.name, node: p.node, what: 'return key' }));
  for (const parameter of signature.getParameters()) {
    const type = checker.getTypeOfSymbolAtLocation(parameter, declaration);
    // A getter or ref constituent of `MaybeRefOrGetter<T>` contributes no repo-declared key.
    const parts = nonNullable(type).map((part) => unwrapRef(part, declaration));
    const seen = new Set();
    for (const part of parts) {
      for (const p of repoProperties(part)) {
        if (seen.has(p.name)) continue;
        seen.add(p.name);
        keys.push({ key: `options.${p.name}`, node: p.node, what: 'options key' });
      }
    }
  }
  return keys;
}

function bindingDeclarations(entry) {
  const map = new Map();
  for (const exported of exportsOf(entry)) {
    const symbol = resolveAlias(exported);
    const declaration = (symbol.declarations ?? []).find(
      (d) =>
        isRepoSource(d.getSourceFile().fileName) &&
        (ts.isFunctionDeclaration(d) || ts.isVariableDeclaration(d)),
    );
    if (declaration) map.set(exported.getName(), declaration);
  }
  return map;
}

/** Both bindings export the same names (values and types); only a whole-surface run checks it. */
function checkBarrelParity() {
  const names = (entry) => new Set(exportsOf(entry).map((symbol) => symbol.getName()));
  const reactNames = names(REACT_ENTRY);
  const vueNames = names(VUE_ENTRY);
  const where = (entry) => program.getSourceFile(path.join(ROOT, entry));
  for (const name of reactNames) {
    if (!vueNames.has(name)) {
      report('parity', where(REACT_ENTRY), `export.${name}`, `React-only export '${name}'`);
    }
  }
  for (const name of vueNames) {
    if (!reactNames.has(name)) {
      report('parity', where(VUE_ENTRY), `export.${name}`, `Vue-only export '${name}'`);
    }
  }
}

function checkParity(files) {
  if (!files) checkBarrelParity();
  const react = bindingDeclarations(REACT_ENTRY);
  const vue = bindingDeclarations(VUE_ENTRY);
  let compared = 0;
  for (const [name, vueDeclaration] of vue) {
    const reactDeclaration = react.get(name);
    if (!reactDeclaration) continue;
    const isHook = /^use[A-Z]/.test(name);
    const isComponent = isComponentDeclaration(vueDeclaration);
    if (!(isHook || isComponent)) continue;
    if (
      files &&
      !files.includes(declarationFile(reactDeclaration)) &&
      !files.includes(declarationFile(vueDeclaration))
    ) {
      continue;
    }
    compared++;
    const reactKeys = isHook ? hookKeys(reactDeclaration) : reactComponentKeys(reactDeclaration);
    const vueKeys = isHook ? hookKeys(vueDeclaration) : vueComponentKeys(vueDeclaration);
    const reactSet = new Set(reactKeys.map((k) => k.key));
    const vueSet = new Set(vueKeys.map((k) => k.key));
    const seen = new Set();
    for (const { key, node, what = 'prop/event' } of reactKeys) {
      if (vueSet.has(key) || seen.has(`r:${key}`)) continue;
      seen.add(`r:${key}`);
      report('parity', node, `${name}.${key}`, `React-only ${what} '${key}' of ${name}`);
    }
    for (const { key, node, what = 'prop/event' } of vueKeys) {
      if (reactSet.has(key) || seen.has(`v:${key}`)) continue;
      seen.add(`v:${key}`);
      report('parity', node, `${name}.${key}`, `Vue-only ${what} '${key}' of ${name}`);
    }
  }
  return compared;
}

// ---------------------------------------------------------------- allowlist

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped.replace(/\0/g, '.*')}$`);
}

function loadAllowlist() {
  const entries = JSON.parse(readFileSync(path.join(ROOT, ALLOWLIST), 'utf8'));
  return entries.map((entry, index) => {
    if (!(entry.rule && entry.file && entry.name && entry.reason)) {
      throw new Error(`${ALLOWLIST}[${index}] needs rule, file, name and reason`);
    }
    return {
      ...entry,
      index,
      fileRe: globToRegExp(entry.file),
      nameRe: globToRegExp(entry.name),
      hits: 0,
    };
  });
}

function applyAllowlist(list, allowlist) {
  return list.filter((violation) => {
    const entry = allowlist.find(
      (e) =>
        e.rule === violation.rule && e.fileRe.test(violation.file) && e.nameRe.test(violation.name),
    );
    if (!entry) return true;
    entry.hits++;
    return false;
  });
}

// ---------------------------------------------------------------- main

function format(violation) {
  return `${violation.file}:${violation.line} ${violation.rule} ${violation.name}: ${violation.message}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const allowlist = loadAllowlist();
  const runSurface = args.all || (args.files && !args.parity);

  if (runSurface) {
    const matched = checkSurface(args.files);
    if (args.files && matched === 0) {
      console.error(
        `check-api-surface: no exported declaration comes from ${args.files.join(', ')}`,
      );
      process.exit(2);
    }
    checkDeprecated(args.files);
    if (args.all) checkTsconfigs();
  }
  if (args.parity || args.baseline) {
    const compared = checkParity(args.parity ? args.files : null);
    if (args.files && args.parity && compared === 0) {
      console.error(
        `check-api-surface: no React/Vue component or hook pair is declared in ${args.files.join(', ')}`,
      );
      process.exit(2);
    }
  }

  const remaining = applyAllowlist(violations, allowlist);
  // An entry is stale only when this run covered its rule over the whole surface.
  const coversSurface = args.all;
  const coversParity = (args.parity || Boolean(args.baseline)) && !args.files;
  for (const entry of allowlist) {
    const covered = entry.rule === 'parity' ? coversParity : coversSurface;
    if (!covered || entry.hits > 0) continue;
    remaining.push({
      rule: 'allowlist/stale',
      file: ALLOWLIST,
      line: 1,
      name: `#${entry.index}`,
      message: `entry ${entry.rule} ${entry.file} ${entry.name} matched nothing`,
    });
  }

  remaining.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
  const lines = remaining.map(format);
  if (args.baseline) {
    const byRule = new Map();
    for (const v of remaining) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
    const summary = [
      `violations ${remaining.length}`,
      `by rule: ${[...byRule]
        .sort()
        .map(([k, n]) => `${k}=${n}`)
        .join(' ')}`,
    ];
    writeFileSync(path.resolve(ROOT, args.baseline), `${[...summary, '', ...lines].join('\n')}\n`);
    console.log(summary.join('\n'));
    console.log(`written: ${args.baseline}`);
  } else {
    console.log(`violations ${remaining.length}`);
    for (const line of lines) console.log(line);
  }
  process.exit(remaining.length > 0 ? 1 : 0);
}

main();
