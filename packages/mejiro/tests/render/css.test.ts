import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HEADING_STYLES } from '../../src/book/constants.js';
import { resizeImageOverlayRect } from '../../src/overlay.js';
import { buildParagraphMeasures } from '../../src/render/measures.js';
import type { RenderEntry } from '../../src/render/types.js';

const root = fileURLToPath(new URL('../../src/render/', import.meta.url));

function readCss(name: string): string {
  return readFileSync(`${root}${name}`, 'utf8');
}

function entry(extra: Partial<RenderEntry>): RenderEntry {
  return { chars: ['あ'], breakPoints: new Uint32Array(), inlineAnnotations: [], ...extra };
}

/** Declarations of every rule under `prefix`, keyed by the selector with the prefix removed. */
function cssRules(css: string, prefix: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const name = selector.replace(/\/\*[\s\S]*?\*\//gu, '').trim();
    if (!name.startsWith(prefix)) continue;
    const declarations = new Map<string, string>();
    for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/gu)) {
      declarations.set(property, value.trim());
    }
    rules.set(name.slice(prefix.length), declarations);
  }
  return rules;
}

describe('render CSS', () => {
  it('styles emphasis and tcy annotations in page and reader CSS', () => {
    for (const css of [readCss('mejiro.css'), readCss('mejiro-reader.css')]) {
      expect(css).toContain('.mejiro-emphasis--sesame');
      expect(css).toContain('-webkit-text-emphasis: sesame');
      expect(css).toContain('text-emphasis: sesame');
      expect(css).toContain('.mejiro-emphasis--dot');
      expect(css).toContain('.mejiro-emphasis--circle');
      expect(css).toContain('.mejiro-tcy');
      expect(css).toContain('text-combine-upright: all');
    }
  });

  it('uses right-side vertical paragraph gaps', () => {
    for (const css of [readCss('mejiro.css'), readCss('mejiro-reader.css')]) {
      expect(css).toContain('margin-right: calc(0.4em / var(--mejiro-paragraph-scale))');
      expect(css).toContain('margin-right: calc(1.2em / var(--mejiro-paragraph-scale))');
      expect(css).not.toContain('margin-left: calc(');
      expect(css).not.toContain('margin-left: 0.4em');
    }
  });

  it('mirrors h5 and h6 heading styles in reader CSS', () => {
    const css = readCss('mejiro-reader.css');
    expect(css).toContain('.mejiro-reader-page-content .mejiro-paragraph--h5');
    expect(css).toContain('.mejiro-reader-page-content .mejiro-paragraph--h6');
    expect(css).toContain('margin-right: calc(0.6em / var(--mejiro-paragraph-scale))');
  });

  it('draws every paragraph gap the measures budget, in base em', () => {
    const measures = buildParagraphMeasures(
      [
        entry({ kind: 'blockquote' }),
        entry({ headingLevel: 1 }),
        entry({ headingLevel: 2 }),
        entry({ kind: 'blockquote' }),
        entry({ headingLevel: 3 }),
        entry({ kind: 'sceneBreak' }),
        entry({ kind: 'figure' }),
        entry({}),
      ],
      // Default options: no headingStyles, as a bare MejiroBook or measure call has.
      { fontSize: 10 },
    ).map((m) => m.gapBefore / 10);
    for (const [name, prefix] of [
      ['mejiro.css', ''],
      ['mejiro-reader.css', '.mejiro-reader-page-content '],
    ] as const) {
      const rules = cssRules(readCss(name), prefix);
      // Rendered gap of `cur` after `prev`, following the cascade of the shipped rules.
      const gap = (prev: string, cur: string): number => {
        const scale = Number(rules.get(cur)?.get('--mejiro-paragraph-scale') ?? 1);
        const margin =
          rules.get(`${prev} + .mejiro-paragraph`)?.get('margin-right') ??
          rules.get(cur)?.get('margin-right') ??
          rules.get('.mejiro-paragraph')?.get('margin-right');
        const em = (margin ?? '').match(/^calc\(([\d.]+)em \/ var\(--mejiro-paragraph-scale\)\)$/u);
        // A calc() margin is divided by the element's own scale; a plain em margin is not.
        return em ? Number(em[1]) : Number.parseFloat(margin ?? '') * scale;
      };
      const cls = (suffix: string) => `.mejiro-paragraph--${suffix}`;
      expect([
        gap(cls('blockquote'), cls('h1')),
        gap(cls('h1'), cls('h2')),
        gap(cls('h2'), cls('blockquote')),
        gap(cls('blockquote'), cls('h3')),
        gap(cls('h3'), cls('scene-break')),
        gap(cls('scene-break'), cls('figure')),
        gap(cls('figure'), '.mejiro-paragraph'),
      ]).toEqual(measures.slice(1));
      for (const [level, style] of Object.entries(DEFAULT_HEADING_STYLES)) {
        expect(rules.get(cls(`h${level}`))?.get('--mejiro-paragraph-scale')).toBe(
          String(style.scale),
        );
      }
    }
  });

  it('measures every heading level at the size the stylesheet draws it by default', () => {
    for (const name of ['mejiro.css', 'mejiro-reader.css'] as const) {
      const prefix = name === 'mejiro.css' ? '' : '.mejiro-reader-page-content ';
      const rules = cssRules(readCss(name), prefix);
      for (const level of [1, 2, 3, 4, 5, 6]) {
        const drawn = Number(
          rules.get(`.mejiro-paragraph--h${level}`)?.get('--mejiro-paragraph-scale'),
        );
        const [measure] = buildParagraphMeasures([entry({ headingLevel: level })], {
          fontSize: 10,
          lineSpacing: 1,
        });
        expect(measure.linePitch).toBe(Math.round(10 * drawn));
      }
    }
  });

  it('lets renderEpubStatic paragraphs wrap instead of running as one column', () => {
    const rules = cssRules(readCss('mejiro.css'), '');
    expect(rules.get('.mejiro-page--static .mejiro-paragraph')?.get('white-space')).toBe('normal');
    expect(rules.get('.mejiro-page--static .mejiro-paragraph')?.get('display')).toBe('block');
    expect(rules.get('.mejiro-page--static .mejiro-paragraph--pre')?.get('white-space')).toBe(
      'pre',
    );
  });

  it('declares every token the shelf rules read on a shelf mounted outside a reader', () => {
    const css = readCss('mejiro-reader.css');
    const standalone = '.mejiro-shelf:not(.mejiro-reader .mejiro-shelf)';
    const declared = new Set<string>();
    const used = new Set<string>();
    for (const [, rawSelector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const selectors = rawSelector
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .split(',')
        .map((selector) => selector.trim());
      if (selectors.includes(standalone)) {
        for (const [, name] of body.matchAll(/(--[\w-]+)\s*:/gu)) declared.add(name as string);
      }
      if (selectors.every((selector) => selector.startsWith('.mejiro-shelf'))) {
        for (const [, name] of body.matchAll(/var\(\s*(--[\w-]+)/gu)) used.add(name as string);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('consumes every custom property the editor CSS declares', () => {
    const css = readCss('mejiro-editor.css');
    const declared = [...css.matchAll(/^\s*(--[\w-]+)\s*:/gmu)].map((m) => m[1] as string);
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(new RegExp(`var\\(\\s*${name}\\s*[,)]`, 'u').test(css)).toBe(true);
    }
  });

  it('drives the mirrored editor layout from the data-panel-side attribute', () => {
    const css = readCss('mejiro-editor.css');
    expect(css).toContain('.mejiro-editor[data-panel-side="left"]');
    expect(css).not.toContain('--mejiro-editor-panel-side');
  });

  it('puts the overlay resize handle on the corner the resize arithmetic moves', () => {
    // Growing by (+dx, +dy) keeps x and y: the top-left is fixed, so the grabbed corner is bottom-right.
    const grown = resizeImageOverlayRect({ x: 10, y: 20, w: 100, h: 80 }, 30, 15);
    expect(grown).toEqual({ x: 10, y: 20, w: 130, h: 95 });

    const rules = cssRules(readCss('mejiro-reader.css'), '.mejiro-reader-image-overlay-resize');
    for (const name of ['', '::before']) {
      const rule = rules.get(name);
      expect(rule?.get('right'), name).toBe('0');
      expect(rule?.get('bottom'), name).toBe('0');
      expect(rule?.has('left'), name).toBe(false);
      expect(rule?.has('top'), name).toBe(false);
    }
  });

  it('styles structural paragraph kind classes in page and reader CSS', () => {
    for (const css of [readCss('mejiro.css'), readCss('mejiro-reader.css')]) {
      expect(css).toContain('.mejiro-paragraph--blockquote');
      expect(css).toContain('.mejiro-paragraph--scene-break');
      expect(css).toContain('.mejiro-paragraph--pre');
      expect(css).toContain('.mejiro-paragraph--figure');
      expect(css).not.toContain('.mejiro-paragraph--sceneBreak');
    }
  });
});
