import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../src/render/', import.meta.url));

function readCss(name: string): string {
  return readFileSync(`${root}${name}`, 'utf8');
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
      expect(css).toContain('margin-right: 0.4em');
      expect(css).toContain('margin-right: 1.2em');
      expect(css).not.toContain('margin-left: 0.4em');
      expect(css).not.toContain('margin-left: 1.2em');
    }
  });

  it('mirrors h5 and h6 heading styles in reader CSS', () => {
    const css = readCss('mejiro-reader.css');
    expect(css).toContain('.mejiro-reader-page-content .mejiro-paragraph--h5');
    expect(css).toContain('.mejiro-reader-page-content .mejiro-paragraph--h6');
    expect(css).toContain('margin-right: 0.6em');
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
