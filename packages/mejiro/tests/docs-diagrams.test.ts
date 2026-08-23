/**
 * @vitest-environment happy-dom
 *
 * Pins the documentation figure contract: diagrams are hand-authored SVG under
 * `docs/assets`, every markdown reference resolves to a file that GitHub can
 * render in both colour themes, and the English and Japanese variants of one
 * figure never drift apart structurally -- only their labels differ.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCS_DIR = resolve(import.meta.dirname, '../../../docs');
const ASSETS_DIR = join(DOCS_DIR, 'assets');

/** Lists every file under a directory, recursively, as an absolute path. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const markdownFiles = listFiles(DOCS_DIR).filter((path) => path.endsWith('.md'));
const svgFiles = listFiles(ASSETS_DIR).filter((path) => path.endsWith('.svg'));

/** One `![alt](target)` reference found in a markdown file. */
interface ImageReference {
  /** Markdown file the reference was written in. */
  source: string;
  /** Alt text between the brackets. */
  alt: string;
  /** Link target, as written. */
  target: string;
}

const imageReferences: ImageReference[] = markdownFiles.flatMap((source) => {
  const text = readFileSync(source, 'utf8');
  return [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/gu)].map((match) => ({
    source,
    alt: match[1],
    target: match[2],
  }));
});

const svgReferences = imageReferences.filter((ref) => ref.target.endsWith('.svg'));

/** Parses SVG source into a document, failing the test when it is not well-formed XML. */
function parseSvg(path: string): Document {
  const doc = new DOMParser().parseFromString(readFileSync(path, 'utf8'), 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror'), `${path} is not well-formed XML`).toHaveLength(0);
  return doc;
}

/** Element name plus its attributes, ignoring text content. */
function shapeOf(element: Element): string {
  const attributes = Array.from(element.attributes)
    .map((attr) => `${attr.name}=${attr.value}`)
    .sort()
    .join(' ');
  return `${element.tagName}[${attributes}]`;
}

/** Depth-first shape signature of a document, so two figures can be compared label-blind. */
function structureOf(path: string): string[] {
  const shapes: string[] = [];
  const walk = (element: Element, depth: number): void => {
    shapes.push(`${'  '.repeat(depth)}${shapeOf(element)}`);
    for (const child of Array.from(element.children)) walk(child, depth + 1);
  };
  const root = parseSvg(path).documentElement;
  if (root) walk(root, 0);
  return shapes;
}

describe('documentation diagrams', () => {
  it('finds markdown to check', () => {
    expect(markdownFiles.length).toBeGreaterThan(0);
    expect(svgFiles.length).toBeGreaterThan(0);
  });

  it('uses no text-to-diagram DSL', () => {
    const offenders = markdownFiles.filter((path) =>
      /^```\s*mermaid/mu.test(readFileSync(path, 'utf8')),
    );

    expect(offenders.map((path) => relative(DOCS_DIR, path))).toEqual([]);
  });

  it('resolves every referenced SVG to a file that exists', () => {
    expect(svgReferences.length).toBeGreaterThan(0);
    const missing = svgReferences.filter(
      (ref) => !svgFiles.includes(resolve(dirname(ref.source), ref.target)),
    );

    expect(missing.map((ref) => `${relative(DOCS_DIR, ref.source)} -> ${ref.target}`)).toEqual([]);
  });

  it('references every SVG asset from the docs', () => {
    const referenced = new Set(
      svgReferences.map((ref) => resolve(dirname(ref.source), ref.target)),
    );
    const orphans = svgFiles.filter((path) => !referenced.has(path));

    expect(orphans.map((path) => relative(DOCS_DIR, path))).toEqual([]);
  });

  it('describes every diagram in its alt text', () => {
    const terse = svgReferences.filter((ref) => ref.alt.trim().length < 40);

    expect(terse.map((ref) => `${relative(DOCS_DIR, ref.source)}: "${ref.alt}"`)).toEqual([]);
  });

  it.each(svgFiles.map((path) => [relative(DOCS_DIR, path), path] as const))(
    '%s renders on GitHub',
    (_name, path) => {
      const root = parseSvg(path).documentElement;

      expect(root?.tagName).toBe('svg');
      expect(root?.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/u);
      // GitHub renders documentation SVG through <img>, where foreignObject
      // content is dropped -- every label has to be a <text> element.
      expect(root?.getElementsByTagName('foreignObject')).toHaveLength(0);
      expect(root?.getElementsByTagName('text').length).toBeGreaterThan(0);
      // Hard-coded presentation colours would be unreadable in one of the two
      // GitHub themes; the shared stylesheet carries the dark-scheme override.
      expect(readFileSync(path, 'utf8')).toContain('prefers-color-scheme: dark');
    },
  );

  it('keeps the language variants of a figure structurally identical', () => {
    const englishFiles = svgFiles.filter((path) => path.endsWith('-en.svg'));

    expect(englishFiles.length).toBe(svgFiles.length / 2);
    for (const englishFile of englishFiles) {
      const japaneseFile = englishFile.replace(/-en\.svg$/u, '-ja.svg');

      expect(svgFiles, `${relative(DOCS_DIR, japaneseFile)} is missing`).toContain(japaneseFile);
      expect(structureOf(japaneseFile), `${relative(DOCS_DIR, japaneseFile)} drifted`).toEqual(
        structureOf(englishFile),
      );
    }
  });

  it('styles every figure from the same stylesheet', () => {
    const stylesheets = svgFiles.map((path) => {
      const style = parseSvg(path).documentElement?.getElementsByTagName('style')[0];
      return style?.textContent ?? '';
    });

    for (const stylesheet of stylesheets) {
      expect(stylesheet.length).toBeGreaterThan(0);
      expect(stylesheet).toBe(stylesheets[0]);
    }
  });
});
