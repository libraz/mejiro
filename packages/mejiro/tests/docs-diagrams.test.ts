/**
 * @vitest-environment happy-dom
 *
 * Pins the documentation figure contract: diagrams are hand-authored SVG under
 * `docs/images` (English under the bare name, other locales with a `-ja`-style
 * suffix), every markdown reference resolves to a file that GitHub can render
 * in both colour themes, the locale variants of one figure never drift apart
 * structurally -- only their labels differ -- and every label fits its box.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCS_DIR = resolve(import.meta.dirname, '../../../docs');
const IMAGES_DIR = join(DOCS_DIR, 'images');
/** Suffix a non-English variant carries before `.svg`. */
const LOCALE_SUFFIX = /-(ja)\.svg$/u;

/** Lists every file under a directory, recursively, as an absolute path. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const markdownFiles = listFiles(DOCS_DIR).filter((path) => path.endsWith('.md'));
const svgFiles = listFiles(IMAGES_DIR).filter((path) => path.endsWith('.svg'));

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

/** Horizontal room a label keeps from the edge of its box. */
const TEXT_PADDING = 6;

/** Font metrics a class sets: size in px, letter spacing in em, and whether it is monospace. */
interface TextStyle {
  /** Font size in px. */
  size?: number;
  /** Letter spacing in em. */
  spacing?: number;
  /** Whether the class sets a monospace family. */
  mono?: boolean;
}

/** Reads per-class font metrics from the light-theme rules of a figure stylesheet. */
function classStyles(css: string): Record<string, TextStyle> {
  const light = css.split('@media')[0];
  const styles: Record<string, TextStyle> = {};
  for (const [, name, body] of light.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/gu)) {
    const size = /font-size:\s*([\d.]+)px/u.exec(body);
    const spacing = /letter-spacing:\s*([\d.]+)em/u.exec(body);
    styles[name] = {
      size: size ? Number(size[1]) : undefined,
      spacing: spacing ? Number(spacing[1]) : 0,
      mono: body.includes('monospace'),
    };
  }
  return styles;
}

/**
 * Estimates a label's rendered width: a CJK or fullwidth glyph advances about
 * 1em, a proportional latin glyph about 0.52em and a monospace one 0.6em.
 */
function estimateWidth(label: string, { size = 12, spacing = 0, mono = false }: TextStyle): number {
  let width = 0;
  for (const char of label) {
    const wide = /[\u2190-\u21ff\u3000-\u9fff\uff00-\uffef]/u.test(char);
    width += size * ((wide ? 1 : mono ? 0.6 : 0.52) + spacing);
  }
  return width;
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
    const variants = svgFiles.filter((path) => LOCALE_SUFFIX.test(path));

    expect(variants.length).toBe(svgFiles.length / 2);
    for (const variant of variants) {
      const englishFile = variant.replace(LOCALE_SUFFIX, '.svg');

      expect(svgFiles, `${relative(DOCS_DIR, englishFile)} is missing`).toContain(englishFile);
      expect(structureOf(variant), `${relative(DOCS_DIR, variant)} drifted`).toEqual(
        structureOf(englishFile),
      );
    }
  });

  it.each(svgFiles.map((path) => [relative(DOCS_DIR, path), path] as const))(
    'fits every label of %s inside its box',
    (_name, path) => {
      const root = parseSvg(path).documentElement;
      const styles = classStyles(root?.getElementsByTagName('style')[0]?.textContent ?? '');
      const rects = Array.from(root?.getElementsByTagName('rect') ?? [], (rect) => {
        const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => Number(rect.getAttribute(a)));
        return { x, y, w, h };
      });
      const overflows = Array.from(root?.getElementsByTagName('text') ?? [])
        .filter((text) => !text.hasAttribute('transform'))
        .flatMap((text) => {
          const x = Number(text.getAttribute('x'));
          const y = Number(text.getAttribute('y'));
          // The innermost rect around the anchor is the box the label belongs to.
          const box = rects
            .filter((r) => r.x <= x && x <= r.x + r.w && r.y <= y && y <= r.y + r.h)
            .sort((a, b) => a.w * a.h - b.w * b.h)[0];
          const label = text.textContent ?? '';
          const width = estimateWidth(label, styles[text.getAttribute('class') ?? ''] ?? {});
          const anchor = text.getAttribute('text-anchor');
          const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
          const fits =
            box && left >= box.x + TEXT_PADDING && left + width <= box.x + box.w - TEXT_PADDING;
          return fits ? [] : [`"${label}" (${Math.round(width)} wide at x=${Math.round(left)})`];
        });

      expect(overflows).toEqual([]);
    },
  );

  it.each(['en', 'ja'])('names every exported subpath in the %s architecture figure', (locale) => {
    const manifest = JSON.parse(
      readFileSync(resolve(DOCS_DIR, '../packages/mejiro/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    const labels = Array.from(
      parseSvg(
        join(IMAGES_DIR, `architecture-layers${locale === 'en' ? '' : `-${locale}`}.svg`),
      ).getElementsByTagName('text'),
      (text) => text.textContent ?? '',
    );
    const missing = Object.keys(manifest.exports)
      // Module entry points only; stylesheet and manifest exports carry an extension.
      .filter((key) => !/\.[a-z]+$/u.test(key))
      .map((key) => (key === '.' ? '@libraz/mejiro' : `@libraz/mejiro/${key.slice(2)}`))
      .filter((name) => !labels.some((label) => label === name || label.startsWith(`${name} (`)));

    expect(missing).toEqual([]);
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
