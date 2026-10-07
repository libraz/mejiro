// @vitest-environment happy-dom
/** @jsxImportSource react */
/**
 * Executes the example sources under `tests/doc-examples/` that the
 * documentation prints verbatim (bound by `docs-example-sources.test.ts`), so
 * a documented example that throws, or a component example that never reaches
 * its rendered state, fails here.
 *
 * Every `fetch` answers with one small EPUB built from a manuscript. The `.vue`
 * examples are compiled with `@vue/compiler-sfc`; their imports are rewritten
 * to read a module table, because this config registers no Vue plugin.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { compileScript, parse } from '@vue/compiler-sfc';
import { mount } from '@vue/test-utils';
import ts from 'typescript';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'vue';
import { MejiroBook } from '../src/book/index.js';
import { EpubProject, parseEditableEpub, parseEpub } from '../src/epub/index.js';
import { paragraphClassName } from '../src/render/index.js';

vi.mock('@libraz/mejiro-react', () => import('../../mejiro-react/src/index.js'));
vi.mock('@libraz/mejiro-vue', () => import('../../mejiro-vue/src/index.js'));

const examplesDir = resolve(import.meta.dirname, 'doc-examples');

/** Body text long enough to fill several columns and both pages of a spread. */
const BODY = Array.from({ length: 6 }, () =>
  '吾輩は｜猫《ねこ》である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。'.repeat(3),
).join('\n\n');

let fixture: ArrayBuffer;
/** Directories holding compiled `.vue` examples, removed after the run. */
const compiledDirs: string[] = [];

beforeAll(async () => {
  fixture = await EpubProject.fromManuscript({
    metadata: { title: '吾輩は猫である', identifier: 'urn:uuid:doc-examples' },
    chapters: [{ title: '第一章', body: BODY }],
    includeTitlePage: false,
  }).export();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(fixture.slice(0), { status: 200 })),
  );
});

afterAll(async () => {
  await Promise.all(compiledDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  document.body.replaceChildren();
});

/** Compiles a `.vue` example into a component, its imports served from `modules`. */
async function compileVueExample(
  file: string,
  modules: Record<string, unknown>,
): Promise<Component> {
  const source = await readFile(resolve(examplesDir, file), 'utf8');
  const { descriptor, errors } = parse(source, { filename: file });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: file, inlineTemplate: true });
  const js = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const table = '__mejiroDocExampleModules';
  const rewritten = js.replace(
    /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/gu,
    (_match, names: string, from: string) => {
      expect(Object.keys(modules), `${file} imports ${from}`).toContain(from);
      const bindings = names.replace(/\bas\b/gu, ':');
      return `const {${bindings}} = globalThis.${table}[${JSON.stringify(from)}];`;
    },
  );
  expect(rewritten, `${file} keeps an import the table cannot serve`).not.toMatch(/^import\s/mu);
  (globalThis as Record<string, unknown>)[table] = modules;
  // Under node_modules the runner hands the file to Node, which loads it as is.
  const cache = resolve(import.meta.dirname, '../../../node_modules/.cache');
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(resolve(cache, 'mejiro-doc-example-'));
  compiledDirs.push(dir);
  const out = resolve(dir, `${file.replace(/\W/gu, '-')}.mjs`);
  await writeFile(out, rewritten);
  return ((await import(/* @vite-ignore */ out)) as { default: Component }).default;
}

async function vueModules(): Promise<Record<string, unknown>> {
  return {
    vue: await import('vue'),
    '@libraz/mejiro/book': await import('../src/book/index.js'),
    '@libraz/mejiro/epub': await import('../src/epub/index.js'),
    '@libraz/mejiro-vue': await import('../../mejiro-vue/src/index.js'),
  };
}

describe('01-getting-started examples', () => {
  it('renders one column per RenderLine with the class and scale the layout measured', async () => {
    const { pageEl, spread } = await import('./doc-examples/01-quick-start.js');
    const paragraphs = spread.right.page.paragraphs;
    const drawn = [...pageEl.children] as HTMLElement[];
    expect(drawn).toHaveLength(paragraphs.length);
    paragraphs.forEach((paragraph, i) => {
      expect(drawn[i].className).toBe(paragraphClassName(paragraph.kind, paragraph.headingLevel));
      expect(drawn[i].querySelectorAll('br')).toHaveLength(paragraph.lines.length - 1);
      if (paragraph.scale != null) {
        expect(drawn[i].style.getPropertyValue('--mejiro-paragraph-scale')).toBe(
          String(paragraph.scale),
        );
      }
    });
    expect(paragraphs.some((paragraph) => paragraph.lines.length > 1)).toBe(true);
    expect(paragraphs.some((paragraph) => paragraph.headingLevel === 1)).toBe(true);
  });

  it('lays out plain paragraphs', async () => {
    const { layoutParagraphs } = await import('./doc-examples/01-plain-paragraphs.js');
    expect((await layoutParagraphs()).totalPages).toBeGreaterThan(0);
  });

  it('renders the React reader', async () => {
    const { Reader } = await import('./doc-examples/01-react-reader.js');
    const { container } = render(<Reader />);
    await waitFor(() => expect(container.querySelectorAll('.mejiro-page')).toHaveLength(2));
  });

  it('renders the Vue reader', async () => {
    const Reader = await compileVueExample('01-vue-reader.vue', await vueModules());
    const wrapper = mount(Reader, { attachTo: document.body });
    await vi.waitFor(() => expect(wrapper.findAll('.mejiro-page')).toHaveLength(2));
    wrapper.unmount();
  });

  it('breaks the headless sample into the printed lines', async () => {
    const { lines } = await import('./doc-examples/01-headless.js');
    expect(lines).toEqual([
      [0, 8],
      [8, 16],
    ]);
  });
});

describe('03-line-breaking examples', () => {
  it('runs every example with the printed break points', async () => {
    await import('./doc-examples/03-basic.js');
    await import('./doc-examples/03-options.js');
    await import('./doc-examples/03-custom-rules.js');
    const modes = await import('./doc-examples/03-modes.js');
    expect([...modes.strict.breakPoints]).toEqual([3, 8]);
    expect([...modes.loose.breakPoints]).toEqual([4, 9]);
    const hanging = await import('./doc-examples/03-hanging.js');
    expect([...hanging.result.breakPoints]).toEqual([5]);
    expect([...hanging.withoutHanging().breakPoints]).toEqual([3, 8]);
    const clusters = await import('./doc-examples/03-clusters.js');
    expect([...clusters.result.breakPoints]).toEqual([2]);
    const ranges = await import('./doc-examples/03-line-ranges.js');
    expect(ranges.lines).toEqual([
      [0, 5],
      [5, 10],
      [10, 15],
    ]);
    const hints = await import('./doc-examples/03-hint-clusters.js');
    expect([...hints.plain.breakPoints]).toEqual([4]);
    expect([...hints.hinted.breakPoints]).toEqual([3]);
    const penalties = await import('./doc-examples/03-break-penalties.js');
    expect([...penalties.plain.breakPoints]).toEqual([5]);
    expect([...penalties.hinted.breakPoints]).toEqual([4]);
  });
});

describe('04-ruby examples', () => {
  it('keeps a group ruby together', async () => {
    const { result } = await import('./doc-examples/04-ruby-breaks.js');
    expect([...result.breakPoints]).not.toContain(0);
  });

  it('lays out ruby through MejiroBrowser', async () => {
    const { chapterResult, result } = await import('./doc-examples/04-ruby-browser.js');
    expect(result.breakPoints).toBeInstanceOf(Uint32Array);
    expect(chapterResult.paragraphs).toHaveLength(2);
  });

  it('walks ruby segments and resolves them to inline nodes', async () => {
    const { page } = await import('./doc-examples/04-render-segments.js');
    const segments = page.paragraphs.flatMap((p) => p.lines.flatMap((line) => line.segments));
    expect(segments.some((segment) => segment.type === 'ruby')).toBe(true);
    const { node } = await import('./doc-examples/04-inline-node.js');
    expect(node).toMatchObject({ type: 'element', tag: 'ruby' });
    expect(node.type === 'element' && node.children.at(-1)).toMatchObject({ tag: 'rt' });
  });
});

describe('05-browser-integration examples', () => {
  it('lays out a paragraph', async () => {
    const { layoutParagraph } = await import('./doc-examples/05-browser-layout.js');
    expect((await layoutParagraph()).breakPoints).toBeInstanceOf(Uint32Array);
  });

  it('lays out a chapter with a multi-character ruby', async () => {
    const { layoutChapter } = await import('./doc-examples/05-browser-layout.js');
    const result = await layoutChapter();
    expect(result.paragraphs.map((paragraph) => paragraph.chars.join(''))).toEqual([
      '第一章',
      '吾輩は猫である。名前はまだ無い。',
      '漢字を読む',
    ]);
  });
});

describe('06-epub examples', () => {
  it('puts the ruby on 本文 and exports the edited book', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { editor, nextBuffer } = await import('./doc-examples/06-epub-editing.js');
    const block = editor.book.chapters[0].paragraphs[2];
    const [ruby] = block.inlineAnnotations;
    expect([...block.text].slice(ruby.startIndex, ruby.endIndex).join('')).toBe('本文');
    expect(nextBuffer.byteLength).toBeGreaterThan(0);
  });

  it('walks blocks with a paragraph index of its own', async () => {
    const { replaceInChapter } = await import('./doc-examples/06-epub-editing.js');
    const editor = await parseEditableEpub(fixture.slice(0));
    replaceInChapter(editor, '吾輩', '我輩');
    const texts = editor.book.chapters[0].paragraphs.map((paragraph) => paragraph.text);
    expect(texts.some((text) => text.includes('我輩'))).toBe(true);
    expect(texts.some((text) => text.includes('吾輩'))).toBe(false);
  });

  it('runs the EPUB-to-render-page pipeline', async () => {
    const { renderPage } = await import('./doc-examples/06-epub-layout.js');
    expect(renderPage.paragraphs.length).toBeGreaterThan(0);
  });
});

describe('07-pagination-and-rendering examples', () => {
  it('runs the walkthrough', async () => {
    const { renderPage } = await import('./doc-examples/07-walkthrough.js');
    expect(renderPage.paragraphs[0]).toMatchObject({ kind: 'heading', headingLevel: 1 });
  });

  it('breaks, measures and draws the heading at one size', async () => {
    const { container, headingSize, measures, result } = await import(
      './doc-examples/07-pipeline.js'
    );
    expect(headingSize).toBe(26);
    expect(measures[0].linePitch).toBe(headingSize * 1.8);
    expect(result.paragraphs[0].chars.join('')).toBe('第一章');
    const heading = container.querySelector('.mejiro-paragraph--h1') as HTMLElement;
    expect(Number(heading.style.getPropertyValue('--mejiro-paragraph-scale')) * 16).toBe(
      headingSize,
    );
    expect(container.querySelectorAll('.mejiro-page').length).toBeGreaterThan(0);
  });
});

describe('08-react-and-vue examples', () => {
  it('renders the measured container on first commit and reaches the spread', async () => {
    const { VerticalReader } = await import('./doc-examples/08-react-vertical-reader.js');
    const paragraphs = [{ text: '吾輩は猫である。名前はまだ無い。' }];
    const { container } = render(<VerticalReader paragraphs={paragraphs} />);
    expect(container.firstElementChild?.textContent).toBe('Loading...');
    await waitFor(() => expect(screen.getByText('Next')).toBeTruthy());
    expect(container.querySelectorAll('.mejiro-page')).toHaveLength(2);
  });

  it('renders the Vue reader', async () => {
    const Reader = await compileVueExample('08-vue-reader.vue', await vueModules());
    const wrapper = mount(Reader, {
      props: { paragraphs: [{ text: '吾輩は猫である。名前はまだ無い。' }] },
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain('Next'));
    expect(wrapper.findAll('.mejiro-page')).toHaveLength(2);
    wrapper.unmount();
  });

  it('lays out with the React reading-position options', async () => {
    const { ReflowReader } = await import('./doc-examples/08-reflow-options.js');
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    const epub = await parseEpub(fixture.slice(0));
    render(<ReflowReader book={book} epub={epub} chapter={0} />);
    await waitFor(() => expect(screen.getByText('spread 0')).toBeTruthy());
  });

  it('lays out with the Vue reading-position options', async () => {
    const { ReflowReader } = await import('./doc-examples/08-reflow-options-vue.js');
    const book = new MejiroBook({ fontFamily: 'serif', fontSize: 16 });
    const epubBook = await parseEpub(fixture.slice(0));
    const wrapper = mount(ReflowReader, { props: { book, epubBook }, attachTo: document.body });
    await vi.waitFor(() => expect(wrapper.text()).toBe('spread 0'));
    wrapper.unmount();
  });

  it('renders the useManuscriptLayout preview', async () => {
    const { CustomPreview } = await import('./doc-examples/08-custom-preview.js');
    const { container } = render(
      <CustomPreview chapter={{ title: '第一章', body: '吾輩は猫である。' }} />,
    );
    await waitFor(() => expect(container.querySelectorAll('.mejiro-page')).toHaveLength(2));
  });
});

describe('09-advanced examples', () => {
  it('runs the core examples', async () => {
    const kinsoku = await import('./doc-examples/09-kinsoku.js');
    expect([...kinsoku.result.breakPoints]).toEqual([3, 8]);
    const tokens = await import('./doc-examples/09-tokens.js');
    expect(tokens.result.breakPoints).toBeInstanceOf(Uint32Array);
    expect(() =>
      tokens.withArray(new Uint32Array(12).fill(0x3042), new Float32Array(12).fill(16)),
    ).not.toThrow();
    const { pages } = await import('./doc-examples/09-headless.js');
    expect(pages).toHaveLength(1);
    const exclusion = await import('./doc-examples/09-exclusion.js');
    expect(exclusion.slots.length).toBeGreaterThan(0);
    const spread = await import('./doc-examples/09-spread-exclusion.js');
    expect(spread.rightSlots.length).toBe(spread.rightSlotCount);
    expect(spread.leftSlots.length).toBeGreaterThan(0);
  });

  it('preloads the font before laying out', async () => {
    const { preload } = await import('./doc-examples/09-preload.js');
    expect((await preload('吾輩は猫である。')).breakPoints).toBeInstanceOf(Uint32Array);
  });

  it('renders the SSR fallback from the server component', async () => {
    const { default: ReaderPage } = await import('./doc-examples/09-ssr/page.js');
    const element = await ReaderPage({ params: { slug: 'neko' } });
    const { container } = render(element);
    expect(container.querySelector('.mejiro-page--static')).not.toBeNull();
  });
});
