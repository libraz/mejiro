// @vitest-environment happy-dom
/** @jsxImportSource react */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MejiroSelectionLayer } from '../src/MejiroSelectionLayer.js';
import { selectionRect } from './helpers/fixtures.js';

const readerCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../mejiro/src/render/mejiro-reader.css'),
  'utf8',
);

describe('MejiroSelectionLayer (React)', () => {
  it('fills each rectangle with its own colour', () => {
    const { container } = render(
      <MejiroSelectionLayer
        side="right"
        rects={[
          selectionRect({ color: 'rgb(255, 255, 0)' }),
          selectionRect({ y: 60, color: 'rgb(0, 128, 255)' }),
        ]}
      />,
    );

    const rects = [...container.querySelectorAll<HTMLElement>('.mejiro-selection-rect')];
    expect(rects).toHaveLength(2);
    expect(getComputedStyle(rects[0] as HTMLElement).backgroundColor).toBe('rgb(255, 255, 0)');
    expect(getComputedStyle(rects[1] as HTMLElement).backgroundColor).toBe('rgb(0, 128, 255)');
  });

  it('leaves uncoloured rectangles to the shipped stylesheet rule', () => {
    const { container } = render(<MejiroSelectionLayer side="right" rects={[selectionRect()]} />);

    const rect = container.querySelector<HTMLElement>('.mejiro-selection-rect');
    expect(rect?.style.backgroundColor).toBe('');
    // The auto-imported reader stylesheet is the only fill for such rectangles.
    expect(readerCss).toMatch(/\.mejiro-selection-rect\s*\{[^}]*background-color:/u);
    expect(readerCss).toContain('--mejiro-selection-bg');
  });
});
