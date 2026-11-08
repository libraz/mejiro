import { moveImageOverlayRect } from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import type { ImageOverlayRect } from '../src/useImageOverlay.js';

/** Probe header: the compared types and the identity helpers. */
const PROBE_HEADER = `import type {
  ImageRect as CoreExclusionRect,
  ImageOverlayRect as CoreOverlayRect,
} from '@libraz/mejiro';
import type { ImageOverlayRect, MultiImageItem } from '@libraz/mejiro-vue';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;
`;

/** Each contract a probe line asserts; a broken line fails to compile. */
const CONTRACTS = [
  // `ImageOverlayRect` is the one name for this shape across the package family.
  'Expect<Equal<ImageOverlayRect, CoreOverlayRect>>',
  "Expect<Equal<MultiImageItem['rect'], CoreOverlayRect>>",
  // The overlay rect stays distinct from the exclusion rect.
  'Expect<Not<Equal<CoreExclusionRect, CoreOverlayRect>>>',
  "Expect<Equal<'inlineMargin' extends keyof CoreExclusionRect ? true : false, true>>",
  "Expect<Equal<'inlineMargin' extends keyof CoreOverlayRect ? true : false, false>>",
];

function probe(contracts: readonly string[]): string {
  return PROBE_HEADER + contracts.map((line, i) => `export type C${i} = ${line};`).join('\n');
}

describe('image overlay rect type', () => {
  it('names the overlay rect from the package barrel and keeps it apart from the exclusion rect', () => {
    expectTypeErrors(probe(CONTRACTS), { fails: [] });
  });

  it('fails the probe when a contract is broken', () => {
    const broken = CONTRACTS.map((line, i) =>
      i === 0 ? line.replace('CoreOverlayRect', 'CoreExclusionRect') : line,
    );
    expect(() => expectTypeErrors(probe(broken), { fails: [] })).toThrow(/type probe mismatch/);
  });

  it('feeds the barrel rect straight into the core overlay helpers', () => {
    const rect: ImageOverlayRect = { x: 10, y: 20, width: 100, height: 120 };
    expect(moveImageOverlayRect(rect, 5, -10)).toEqual({ x: 15, y: 10, width: 100, height: 120 });
  });
});
