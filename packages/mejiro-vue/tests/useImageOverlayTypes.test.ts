import type {
  ImageRect as CoreExclusionRect,
  ImageOverlayRect as CoreOverlayRect,
} from '@libraz/mejiro';
import { moveImageOverlayRect } from '@libraz/mejiro';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ImageOverlayRect, ImageRect, UseImageOverlayReturn } from '../src/index.js';

describe('image overlay rect type', () => {
  it('names the overlay rect from the package barrel, aliased by the old name', () => {
    // `ImageOverlayRect` is the name the package family agrees on; `ImageRect`
    // stays as a deprecated alias so the rename is not a breaking change.
    expectTypeOf<ImageOverlayRect>().toEqualTypeOf<CoreOverlayRect>();
    expectTypeOf<ImageRect>().toEqualTypeOf<CoreOverlayRect>();
    expectTypeOf<
      UseImageOverlayReturn['imageRect']['value']
    >().toEqualTypeOf<CoreOverlayRect | null>();
  });

  it('keeps the overlay rect distinct from the exclusion rect', () => {
    expectTypeOf<CoreExclusionRect>().not.toEqualTypeOf<CoreOverlayRect>();
    expectTypeOf<CoreExclusionRect>().toHaveProperty('inlineMargin');
    expectTypeOf<CoreOverlayRect>().not.toHaveProperty('inlineMargin');
  });

  it('feeds the barrel rect straight into the core overlay helpers', () => {
    const rect: ImageRect = { x: 10, y: 20, w: 100, h: 120 };
    expect(moveImageOverlayRect(rect, 5, -10)).toEqual({ x: 15, y: 10, w: 100, h: 120 });
  });
});
