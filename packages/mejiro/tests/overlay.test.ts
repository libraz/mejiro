import { describe, expect, it } from 'vitest';
import { moveImageOverlayRect, resizeImageOverlayRect } from '../src/overlay.js';

describe('image overlay rect helpers', () => {
  it('moves an image overlay rectangle without mutating input', () => {
    const rect = { x: 10, y: 20, width: 100, height: 120 };

    expect(moveImageOverlayRect(rect, 5, -10)).toEqual({ x: 15, y: 10, width: 100, height: 120 });
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 120 });
  });

  it('resizes an image overlay rectangle with a minimum size', () => {
    const rect = { x: 10, y: 20, width: 100, height: 120 };

    expect(resizeImageOverlayRect(rect, -90, -100)).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 40,
    });
  });
});
