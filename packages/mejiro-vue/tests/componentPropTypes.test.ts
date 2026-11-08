// @vitest-environment happy-dom

import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** Path of the in-memory probe module, placed beside this file so its imports resolve. */
const PROBE_FILE = resolve(import.meta.dirname, '__prop-types-probe.ts');

/**
 * Type-checks `source` as a module beside this file and returns the messages
 * of the diagnostics reported in it. `tsc -b` covers `src` only, so this is
 * what makes the type-level assertions below able to fail.
 */
function typeErrors(source: string): string[] {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, language, ...rest) =>
    name === PROBE_FILE
      ? ts.createSourceFile(name, source, language)
      : getSourceFile(name, language, ...rest);
  host.fileExists = (name) => name === PROBE_FILE || fileExists(name);
  const program = ts.createProgram([PROBE_FILE], options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(PROBE_FILE))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

/** Each public props type, one property it must expose, and that property's type. */
const PROP_CONTRACTS: Array<[props: string, property: string, type: string]> = [
  ['MejiroChapterNavProps', 'epub', 'EpubBook'],
  ['MejiroDropZoneProps', 'accept', 'string | undefined'],
  ['MejiroEditorProps', 'epubUrl', 'string | undefined'],
  ['MejiroImagePlaceholderProps', 'rect', 'ImageOverlayRect'],
  ['MejiroManuscriptEditorProps', 'previewProps', 'ManuscriptPreviewProps | undefined'],
  ['MejiroPageProps', 'page', 'RenderPage'],
  ['MejiroPageIndicatorProps', 'index', 'number'],
  ['MejiroPageViewProps', 'result', 'PageResult'],
  ['MejiroReaderProps', 'epubUrl', 'string | undefined'],
  ['MejiroReaderSettingsSlot', 'settings', 'EditableSettings'],
  ['MejiroScrollViewProps', 'layout', 'ChapterLayout'],
  ['MejiroSelectionLayerProps', 'rects', 'readonly SelectionRect[]'],
  ['MejiroSettingsPanelProps', 'settings', 'EditableSettings'],
  ['MejiroShelfProps', 'volumes', 'readonly VolumeInfo<unknown>[]'],
  ['MejiroSpreadProps', 'spread', 'SpreadResult'],
  ['MejiroStatsProps', 'chapter', 'EpubChapter | null | undefined'],
  ['MejiroTocProps', 'epub', 'EpubBook'],
];

/** A probe module asserting each contract as a compile-time type equality. */
function propTypesProbe(contracts: typeof PROP_CONTRACTS): string {
  const names = [...new Set(contracts.map(([props]) => props))];
  return [
    "import type { ImageOverlayRect } from '@libraz/mejiro';",
    "import type { AnchorRect, ChapterLayout, PageResult, SpreadResult } from '@libraz/mejiro/book';",
    "import type { EpubBook, EpubChapter } from '@libraz/mejiro/epub';",
    "import type { RenderPage } from '@libraz/mejiro/render';",
    `import type { EditableSettings, ManuscriptPreviewProps, SelectionRect, VolumeInfo, ${names.join(', ')} } from '../src/index.js';`,
    'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;',
    'type Expect<T extends true> = T;',
    ...contracts.map(
      ([props, property, type], i) =>
        `export type Contract${i} = Expect<Equal<${props}['${property}'], ${type}>>;`,
    ),
  ].join('\n');
}

describe('Vue public component prop types', () => {
  it('exports every public props type with its named property and property type', () => {
    expect(typeErrors(propTypesProbe(PROP_CONTRACTS))).toEqual([]);
  });

  it('fails the probe when a named property is dropped or retyped', () => {
    const renamed = PROP_CONTRACTS.map(([props, property, type], i): [string, string, string] =>
      i === 0 ? [props, `${property}Renamed`, type] : [props, property, type],
    );
    const retyped = PROP_CONTRACTS.map(([props, property, type], i): [string, string, string] =>
      i === 6 ? [props, property, 'string'] : [props, property, type],
    );
    expect(typeErrors(propTypesProbe(renamed)).join('\n')).toMatch(/epubRenamed/u);
    expect(typeErrors(propTypesProbe(retyped))).toHaveLength(1);
  });
});
