/**
 * Checks the member listings of the API reference and the browser integration
 * guide against the exported TypeScript declarations they describe.
 *
 * Coverage of export names lives in `docs-api-reference.test.ts`; this file
 * goes one level down. Every `**`Name`** …:` block of bullets, every inline
 * `**`Name`** — …: `a`, `b?`` list, every guide table under a type-named heading, every object-literal return type in a
 * signature and every field list of an object constant is compared with the
 * declaration: a documented member must exist, a public member must be
 * documented, and a property's `?` must match.
 */
import { readFileSync } from 'node:fs';
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
  '@libraz/mejiro/analysis': 'packages/mejiro/src/analysis/index.ts',
  '@libraz/mejiro-react': 'packages/mejiro-react/src/index.ts',
  '@libraz/mejiro-vue': 'packages/mejiro-vue/src/index.ts',
};

const LOCALES = ['en', 'ja'] as const;

/** One member name as a document lists it. */
interface DocumentedMember {
  name: string;
  /** `true` / `false` when the text states optionality, `null` when it does not. */
  optional: boolean | null;
}

/** A documented member listing and the declaration it claims to describe. */
interface DocumentedShape {
  /** `file:line` of the listing, for failure messages. */
  where: string;
  /** Subpath whose barrel the name resolves in. */
  subpath: string;
  /** Exported symbol name. */
  name: string;
  /**
   * Set when the listing is the object literal a call returns: the method name,
   * or `''` for the export itself.
   */
  returnOf?: string;
  members: DocumentedMember[];
  /**
   * Set for a constant's table row, whose prose also names things that are not
   * fields: only names the constant declares count, and a row naming two or
   * more of them is a field listing held to the full set.
   */
  lenient?: boolean;
}

/** One declared member. */
interface DeclaredMember {
  optional: boolean;
  /** Whether a listing may leave it out (constructor, deprecated or internal member). */
  omittable: boolean;
}

const program = ts.createProgram(
  Object.values(BARRELS).map((path) => resolve(repoRoot, path)),
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    jsx: ts.JsxEmit.ReactJSX,
  },
);
const checker = program.getTypeChecker();

/** Exported symbols per subpath, aliases resolved. */
const exportsBySubpath = new Map<string, Map<string, ts.Symbol>>(
  Object.entries(BARRELS).map(([subpath, path]) => {
    const sourceFile = program.getSourceFile(resolve(repoRoot, path)) as ts.SourceFile;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile) as ts.Symbol;
    const symbols = new Map<string, ts.Symbol>();
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      symbols.set(exported.getName(), symbol);
    }
    return [subpath, symbols];
  }),
);

function hasTag(declaration: ts.Node, tag: string): boolean {
  return ts.getJSDocTags(declaration).some((t) => t.tagName.text === tag);
}

/** Whether declarations are unreachable for a consumer (private, protected, `#`). */
function isHidden(name: string, declarations: readonly ts.Declaration[]): boolean {
  if (name.startsWith('#') || name.startsWith('__')) return true;
  return declarations.some(
    (declaration) =>
      (ts.getCombinedModifierFlags(declaration) &
        (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !==
      0,
  );
}

function membersOfType(type: ts.Type): Map<string, DeclaredMember> {
  const members = new Map<string, DeclaredMember>();
  for (const property of checker.getPropertiesOfType(type)) {
    const declarations = property.getDeclarations() ?? [];
    if (isHidden(property.getName(), declarations)) continue;
    members.set(property.getName(), {
      optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
      omittable: declarations.some((d) => hasTag(d, 'deprecated') || hasTag(d, 'internal')),
    });
  }
  return members;
}

/**
 * Declared members of an exported class, interface, object type alias or
 * object constant, or `null` when the symbol has no single object shape.
 */
function declaredMembers(symbol: ts.Symbol): Map<string, DeclaredMember> | null {
  if (symbol.flags & ts.SymbolFlags.Class) {
    const members = membersOfType(checker.getDeclaredTypeOfSymbol(symbol));
    for (const [name, member] of membersOfType(checker.getTypeOfSymbol(symbol))) {
      if (name !== 'prototype') members.set(name, member);
    }
    const ctors = (symbol.getDeclarations() ?? [])
      .flatMap((d) => (ts.isClassDeclaration(d) ? [...d.members] : []))
      .filter(ts.isConstructorDeclaration);
    if (!isHidden('constructor', ctors)) {
      members.set('constructor', { optional: false, omittable: true });
    }
    return members;
  }
  if (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) {
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    if (type.isUnion() || !(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) {
      return null;
    }
    return membersOfType(type);
  }
  if (symbol.flags & ts.SymbolFlags.Variable) {
    // A constant annotated with a wide type holds fewer fields than the type
    // declares; its initializer is what the documentation describes.
    const declaration = symbol.valueDeclaration;
    let initializer =
      declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
    while (
      initializer &&
      (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))
    ) {
      initializer = initializer.expression;
    }
    if (initializer && ts.isObjectLiteralExpression(initializer)) {
      const members = new Map<string, DeclaredMember>();
      for (const property of initializer.properties) {
        const name = property.name && ts.isIdentifier(property.name) ? property.name.text : null;
        if (name) members.set(name, { optional: false, omittable: false });
      }
      return members;
    }
    const type = checker.getTypeOfSymbol(symbol);
    const plainObject =
      type.flags & ts.TypeFlags.Object &&
      !checker.isArrayLikeType(type) &&
      checker.getIndexInfosOfType(type).length === 0 &&
      checker.getSignaturesOfType(type, ts.SignatureKind.Call).length === 0;
    return plainObject ? membersOfType(type) : null;
  }
  return null;
}

/** Members of the object a callable export, or one of its methods, returns. */
function returnMembers(symbol: ts.Symbol, method: string): Map<string, DeclaredMember> | null {
  let owner = checker.getTypeOfSymbol(symbol);
  if (method) {
    const instance =
      symbol.flags & ts.SymbolFlags.Class ? checker.getDeclaredTypeOfSymbol(symbol) : owner;
    const property = checker.getPropertyOfType(instance, method);
    if (!property) return null;
    owner = checker.getTypeOfSymbol(property);
  }
  const signature = checker.getSignaturesOfType(owner, ts.SignatureKind.Call)[0];
  if (!signature) return null;
  const returned = signature.getReturnType();
  return membersOfType(checker.getNonNullableType(checker.getAwaitedType(returned) ?? returned));
}

/** Splits a markdown document into chapters keyed by their `## `@libraz/…`` heading. */
function chapters(text: string): Array<{ subpath: string; lines: Array<[number, string]> }> {
  const result: Array<{ subpath: string; lines: Array<[number, string]> }> = [];
  text.split('\n').forEach((line, i) => {
    const heading = line.match(/^##\s+`(@libraz\/[\w/-]+)`/u);
    if (heading) result.push({ subpath: heading[1], lines: [] });
    else result.at(-1)?.lines.push([i + 1, line]);
  });
  return result;
}

function keyOf(segment: string): DocumentedMember[] {
  const match = segment.match(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:/u);
  return match ? [{ name: match[1], optional: match[2] === '?' }] : [];
}

/** Top-level keys of the `{ … }` literal `text` opens with, or `null` if it opens with none. */
function literalKeys(text: string): DocumentedMember[] | null {
  if (!text.startsWith('{')) return null;
  const keys: DocumentedMember[] = [];
  let depth = 0;
  let segment = '';
  for (const ch of text) {
    if ('{([<'.includes(ch)) depth++;
    if ('})]>'.includes(ch)) depth--;
    if (depth === 0) break;
    if (depth === 1 && (ch === ';' || ch === ',')) {
      keys.push(...keyOf(segment));
      segment = '';
    } else if (!(depth === 1 && ch === '{')) {
      segment += ch;
    }
  }
  keys.push(...keyOf(segment));
  return keys;
}

/** Return type text of a `(…) => R` or `name(…): R` signature. */
function returnText(signature: string): string | null {
  let depth = 0;
  for (let i = 0; i < signature.length; i++) {
    const ch = signature[i];
    if ('([{<'.includes(ch)) depth++;
    if (')]}'.includes(ch) || (ch === '>' && signature[i - 1] !== '=')) depth--;
    if (depth !== 0) continue;
    if (signature.startsWith('=>', i)) return signature.slice(i + 2).trim();
    if (ch === ')' && signature[i + 1] === ':') return signature.slice(i + 2).trim();
  }
  return null;
}

/** Parses one backticked member such as `name?: T` or `name(a): R`. */
function memberOf(span: string): (DocumentedMember & { signature: string }) | null {
  const text = span.replace(/^(?:readonly|static|get|async)\s+/u, '');
  const match = text.match(/^([A-Za-z_$][\w$]*)(\?)?\s*([(:<])?/u);
  if (!match) return null;
  const optional = match[2] === '?' ? true : match[3] === ':' ? false : null;
  return { name: match[1], optional, signature: text };
}

/** Separator-joined backticked spans filling the rest of a line: `a`, `b?: T`. */
const INLINE_MEMBER_LIST = /^\s*(`[^`]+`(?:\s*(?:,|、)\s*`[^`]+`)+)[.。]?\s*$/u;

/**
 * Members of an inline listing such as `**`Name`** — Summary: `a`, `b?``: the
 * spans after the first colon outside backticks, when every one of them names
 * a member and they run to the end of the line.
 */
function inlineMembers(rest: string): DocumentedMember[] | null {
  let inCode = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '`') inCode = !inCode;
    if (inCode || (ch !== ':' && ch !== '：')) continue;
    const list = rest.slice(i + 1).match(INLINE_MEMBER_LIST);
    if (!list) continue;
    const members = (list[1].match(/`[^`]+`/gu) ?? []).map((span) => memberOf(span.slice(1, -1)));
    if (members.some((member) => member === null)) return null;
    return (members as DocumentedMember[]).map(({ name, optional }) => ({ name, optional }));
  }
  return null;
}

/**
 * Listings of `docs/<locale>/10-api-reference.md`: `**`Name`** …:` blocks of
 * backticked bullets, `**`Name`** — …: `a`, `b?`` inline lists, object-literal
 * returns in signatures, and the fields an object constant's row names.
 */
function referenceShapes(locale: string): DocumentedShape[] {
  const file = `docs/${locale}/10-api-reference.md`;
  const shapes: DocumentedShape[] = [];
  for (const { subpath, lines } of chapters(readFileSync(resolve(repoRoot, file), 'utf8'))) {
    lines.forEach(([lineNo, line], i) => {
      const header = line.match(/^\*\*`([A-Za-z_$][\w$]*)`\*\*.*:\s*$/u);
      if (header) {
        let j = i + 1;
        if (lines[j]?.[1].trim() === '') j++;
        const members: DocumentedMember[] = [];
        for (; j < lines.length && lines[j][1].startsWith('- `'); j++) {
          const lead = lines[j][1].match(/^- ((?:`[^`]+`)(?:\s*\/\s*`[^`]+`)*)/u);
          for (const span of lead?.[1].match(/`[^`]+`/gu) ?? []) {
            const member = memberOf(span.slice(1, -1));
            if (!member) continue;
            members.push(member);
            const returned = returnText(member.signature);
            const keys = returned ? literalKeys(returned) : null;
            if (keys?.length) {
              shapes.push({
                where: `${file}:${lines[j][0]}`,
                subpath,
                name: header[1],
                returnOf: member.name,
                members: keys,
              });
            }
          }
        }
        if (members.length > 0) {
          shapes.push({
            where: `${file}:${lineNo}`,
            subpath,
            name: header[1],
            members,
          });
        }
      }

      // A line may hold several listings, each running to the next bold name.
      const names =
        /^(?:- )?\*\*`/u.test(line) && !header
          ? [...line.matchAll(/\*\*`([A-Za-z_$][\w$]*)`\*\*/gu)]
          : [];
      names.forEach((match, k) => {
        const start = (match.index ?? 0) + match[0].length;
        const end = names[k + 1]?.index ?? line.length;
        const members = inlineMembers(line.slice(start, end));
        if (members) shapes.push({ where: `${file}:${lineNo}`, subpath, name: match[1], members });
      });

      const row = line.match(/^\|\s*`([A-Za-z_$][\w$]*)`\s*\|\s*`(.+)`\s*\|\s*$/u);
      const returned = row ? returnText(row[2].replace(/\\\|/gu, '|')) : null;
      const keys = returned ? literalKeys(returned) : null;
      if (row && keys?.length) {
        shapes.push({
          where: `${file}:${lineNo}`,
          subpath,
          name: row[1],
          returnOf: '',
          members: keys,
        });
      }

      const constant = line.match(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|(.*)\|\s*$/u);
      if (constant) {
        const named = [...constant[2].matchAll(/`([^`]+)`/gu)].flatMap(([, span]) =>
          span.startsWith('{')
            ? (literalKeys(span) ?? []).map((m) => m.name)
            : /^[a-z][\w$]*$/u.test(span)
              ? [span]
              : [],
        );
        shapes.push({
          where: `${file}:${lineNo}`,
          subpath,
          name: constant[1],
          members: named.map((name) => ({ name, optional: null })),
          lenient: true,
        });
      }
    });
  }
  return shapes;
}

/** Tables of `docs/<locale>/05-browser-integration.md` under a heading naming a type. */
function guideShapes(locale: string): DocumentedShape[] {
  const file = `docs/${locale}/05-browser-integration.md`;
  const lines = readFileSync(resolve(repoRoot, file), 'utf8').split('\n');
  const shapes: DocumentedShape[] = [];
  let heading: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].match(/^#{2,4}\s+(.*)$/u)?.[1].trim();
    if (text !== undefined) {
      heading =
        text.match(/`([A-Z][\w$]*)`\)?$/u)?.[1] ?? (/^[A-Z][\w$]*$/u.test(text) ? text : null);
      continue;
    }
    if (!(heading && lines[i].startsWith('|') && lines[i + 1]?.startsWith('|--'))) continue;
    const hasDefault = lines[i].split('|').length > 5;
    const members: DocumentedMember[] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].startsWith('|'); j++) {
      const cells = lines[j].split(/(?<!\\)\|/u).map((c) => c.trim());
      const name = cells[1].match(/^`([A-Za-z_$][\w$]*)`$/u)?.[1];
      if (name)
        members.push({ name, optional: hasDefault ? !/required|必須/u.test(cells[3]) : null });
    }
    shapes.push({
      where: `${file}:${i + 1}`,
      subpath: '@libraz/mejiro/browser',
      name: heading,
      members,
    });
    heading = null;
    i = j;
  }
  return shapes;
}

/**
 * Compares one documented listing with the declaration it names.
 *
 * @returns One message per disagreement; empty when the listing is faithful or
 *   when the name resolves to no single object shape.
 */
function checkApiReferenceFields(shape: DocumentedShape): string[] {
  const symbol = exportsBySubpath.get(shape.subpath)?.get(shape.name);
  if (!symbol) return [];
  const declared =
    shape.returnOf === undefined ? declaredMembers(symbol) : returnMembers(symbol, shape.returnOf);
  if (!declared) return [];
  const label = shape.returnOf ? `${shape.name}.${shape.returnOf}() return` : shape.name;
  const members = shape.lenient ? shape.members.filter((m) => declared.has(m.name)) : shape.members;
  if (members.length < (shape.lenient ? 2 : 1)) return [];
  const problems: string[] = [];
  for (const member of members) {
    const actual = declared.get(member.name);
    if (!actual) {
      problems.push(`${shape.where} ${label}: lists \`${member.name}\`, which is not declared`);
    } else if (member.optional !== null && member.optional !== actual.optional) {
      const said = member.optional ? 'optional' : 'required';
      problems.push(
        `${shape.where} ${label}.${member.name}: listed as ${said}, declared otherwise`,
      );
    }
  }
  const listed = new Set(members.map((m) => m.name));
  for (const [name, member] of declared) {
    if (!(member.omittable || listed.has(name))) {
      problems.push(`${shape.where} ${label}: omits declared member \`${name}\``);
    }
  }
  return problems;
}

describe('API reference member listings', () => {
  it.each(LOCALES)('match the exported declarations in the %s reference', (locale) => {
    const shapes = referenceShapes(locale);
    expect(shapes.length).toBeGreaterThan(50);
    expect(shapes.flatMap(checkApiReferenceFields)).toEqual([]);
  });

  it.each(LOCALES)('match the exported declarations in the %s browser guide', (locale) => {
    const shapes = guideShapes(locale);
    expect(shapes.map((s) => s.name).sort()).toEqual([
      'ChapterLayoutOptions',
      'LayoutOptions',
      'MejiroBrowserOptions',
      'ParagraphInput',
    ]);
    expect(shapes.flatMap(checkApiReferenceFields)).toEqual([]);
  });

  it.each(LOCALES)('lists the same members in the %s reference as in English', (locale) => {
    const listing = (lang: string) =>
      referenceShapes(lang).map(
        (s) =>
          `${s.subpath} ${s.name}${s.returnOf === undefined ? '' : `.${s.returnOf}()`}: ${s.members.map((m) => m.name).join(', ')}`,
      );
    expect(listing(locale)).toEqual(listing('en'));
  });
});
