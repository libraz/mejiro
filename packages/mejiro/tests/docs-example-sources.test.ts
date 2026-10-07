/**
 * Binds every layout and render example in `docs/{en,ja}` to an example source
 * under `tests/doc-examples/`, which `docs-example-run.test.tsx` executes.
 *
 * A fence that lays out or renders (it calls a layout, pagination or render
 * API, or feeds a layout to a page component) must be preceded by
 *
 *     <!-- doc-example: <file>#<region> -->
 *
 * naming the source and the `#region doc:<region>` it is copied from; `.vue`
 * sources are bound whole, without a region. The English fence must equal the
 * region byte for byte, and the Japanese fence must carry the same code with
 * only its comments translated. The sources are type-checked here against the
 * package sources, so an example cannot call an undefined helper or a removed
 * field and still ship.
 *
 * `<MejiroReader>` / `<MejiroManuscriptEditor>` prop illustrations are not
 * bound: those components own their measurement and the fences only show props.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const examplesDir = resolve(import.meta.dirname, 'doc-examples');
const LANGS = ['en', 'ja'] as const;

/** A call or element that makes a fence a layout or render example. */
const LAYOUT_OR_RENDER =
  /\b(?:computeBreaks|layout|layoutChapter|paginate|buildParagraphMeasures|buildRenderPage|segmentToInlineNode|renderEpubStatic|getSpread|useChapterLayout|useManuscriptLayout)\(|<Mejiro(?:PageView|Page|Spread)\b/u;
const FENCE_LANGS = new Set(['ts', 'tsx', 'vue']);
const MARKER = /^<!-- doc-example: (\S+?)(?:#([\w-]+))? -->$/u;
const REGION_START = /^\s*(?:\/\/|\{\/\*|<!--)\s*#region doc(?::([\w-]+))?\s*(?:\*\/\}|-->)?\s*$/u;
const REGION_END = /^\s*(?:\/\/|\{\/\*|<!--)\s*#endregion doc(?::([\w-]+))?\s*(?:\*\/\}|-->)?\s*$/u;

interface Fence {
  doc: string;
  line: number;
  lang: string;
  body: string;
  /** `<file>#<region>` from the marker line, if bound. */
  ref?: string;
}

function docFences(lang: string): Fence[] {
  const dir = resolve(repoRoot, 'docs', lang);
  const fences: Fence[] = [];
  for (const doc of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
    const lines = readFileSync(resolve(dir, doc), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const open = lines[i].match(/^```(\w*)\s*$/u);
      if (!open) continue;
      let end = i + 1;
      while (end < lines.length && !lines[end].startsWith('```')) end++;
      const marker = i > 0 ? lines[i - 1].match(MARKER) : null;
      fences.push({
        doc: `docs/${lang}/${doc}`,
        line: i + 1,
        lang: open[1],
        body: lines.slice(i + 1, end).join('\n'),
        ref: marker ? `${marker[1]}${marker[2] ? `#${marker[2]}` : ''}` : undefined,
      });
      i = end;
    }
  }
  return fences;
}

/** The text of a region, dedented; a file without region markers is one region. */
function regionText(ref: string): string {
  const [file, name] = ref.split('#');
  const lines = readFileSync(resolve(examplesDir, file), 'utf8').replace(/\n$/u, '').split('\n');
  let body: string[] | undefined;
  if (!lines.some((line) => REGION_START.test(line))) {
    if (name == null) body = lines;
  } else {
    let collecting = false;
    let buffer: string[] = [];
    for (const line of lines) {
      const start = line.match(REGION_START);
      const end = line.match(REGION_END);
      if (start && start[1] === name) {
        collecting = true;
        buffer = [];
      } else if (end && collecting && end[1] === name) {
        body = buffer;
        collecting = false;
      } else if (collecting) {
        buffer.push(line);
      }
    }
  }
  if (!body) throw new Error(`no region ${ref} in tests/doc-examples`);
  while (body.length > 0 && body[0].trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  const indent = Math.min(
    ...body.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length),
  );
  return body.map((line) => (line.trim() ? line.slice(indent) : '')).join('\n');
}

/** Example source files, as paths relative to `tests/doc-examples/`. */
function exampleFiles(): string[] {
  return readdirSync(examplesDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => ['.ts', '.tsx', '.vue'].includes(extname(file)))
    .sort();
}

/** Every region a source declares, as `<file>#<region>`, plus whole `.vue` files. */
function declaredRegions(): string[] {
  const refs: string[] = [];
  for (const file of exampleFiles()) {
    if (file.endsWith('.vue')) {
      refs.push(file);
      continue;
    }
    for (const line of readFileSync(resolve(examplesDir, file), 'utf8').split('\n')) {
      const start = line.match(REGION_START);
      if (start) refs.push(`${file}#${start[1]}`);
    }
  }
  return refs;
}

/** Code lines with comments and blank lines removed, for comparing translations. */
function codeOnly(text: string): string[] {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/\{\/\*.*?\*\/\}/gu, '')
        .replace(/<!--.*?-->/gu, '')
        .replace(/(^|\s)\/\/.*$/u, '$1')
        .trimEnd(),
    )
    .filter((line) => line.trim() !== '');
}

const fencesByLang = Object.fromEntries(LANGS.map((lang) => [lang, docFences(lang)]));

describe('documentation example binding', () => {
  it.each(LANGS)('binds every layout and render fence in docs/%s', (lang) => {
    const unbound = fencesByLang[lang]
      .filter((fence) => FENCE_LANGS.has(fence.lang) && LAYOUT_OR_RENDER.test(fence.body))
      .filter((fence) => fence.ref == null)
      .map((fence) => `${fence.doc}:${fence.line}`);
    expect(unbound, 'fences without a <!-- doc-example: … --> marker').toEqual([]);
  });

  it('copies the English fences verbatim from their sources', () => {
    for (const fence of fencesByLang.en.filter((f) => f.ref != null)) {
      expect(fence.body, `${fence.doc}:${fence.line} differs from ${fence.ref}`).toBe(
        regionText(fence.ref as string),
      );
    }
  });

  it('keeps the code of the Japanese fences identical to their sources', () => {
    for (const fence of fencesByLang.ja.filter((f) => f.ref != null)) {
      expect(codeOnly(fence.body), `${fence.doc}:${fence.line} differs from ${fence.ref}`).toEqual(
        codeOnly(regionText(fence.ref as string)),
      );
    }
  });

  it('prints every source region in both languages', () => {
    for (const lang of LANGS) {
      const used = new Set(fencesByLang[lang].map((fence) => fence.ref));
      const unused = declaredRegions().filter((ref) => !used.has(ref));
      expect(unused, `regions docs/${lang} does not print`).toEqual([]);
    }
  });
});

describe('documentation example sources', () => {
  it('type-check against the package sources', () => {
    const files = exampleFiles()
      .filter((file) => !file.endsWith('.vue'))
      .map((file) => resolve(examplesDir, file));
    const ambient = resolve(examplesDir, '__ambient.d.ts');
    const options: ts.CompilerOptions = {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      noEmit: true,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      jsx: ts.JsxEmit.ReactJSX,
      types: [],
      paths: {
        '@libraz/mejiro': [resolve(repoRoot, 'packages/mejiro/src/index.ts')],
        '@libraz/mejiro/*': [resolve(repoRoot, 'packages/mejiro/src/*/index.ts')],
        '@libraz/mejiro-react': [resolve(repoRoot, 'packages/mejiro-react/src/index.ts')],
        '@libraz/mejiro-vue': [resolve(repoRoot, 'packages/mejiro-vue/src/index.ts')],
      },
    };
    // Stylesheet imports are side-effect only; the host application's bundler resolves them.
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    host.getSourceFile = (name, language, ...rest) =>
      name === ambient
        ? ts.createSourceFile(name, "declare module '*.css';\n", language)
        : getSourceFile(name, language, ...rest);
    host.fileExists = (name) => name === ambient || fileExists(name);
    const program = ts.createProgram([...files, ambient], options, host);
    const errors = files.flatMap((file) =>
      ts.getPreEmitDiagnostics(program, program.getSourceFile(file)).map((diagnostic) => {
        const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        const where = diagnostic.file
          ? `${diagnostic.file.fileName.slice(repoRoot.length + 1)}:${(position?.line ?? 0) + 1}`
          : '';
        return `${where} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
      }),
    );
    expect(errors).toEqual([]);
  }, 120_000);
});
