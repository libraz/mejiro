import { isClusterBreakAllowed, resolveClusterNoBreakFlags } from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

describe('resolveClusterNoBreakFlags', () => {
  it('returns all zeros when no cluster IDs provided', () => {
    const text = new Uint32Array([1, 2, 3]);
    const result = resolveClusterNoBreakFlags(text);
    expect([...result]).toEqual([0, 0, 0]);
  });

  it('flags with 1 each position after which a break is prohibited, one byte per position', () => {
    const text = new Uint32Array([1, 2, 3, 4, 5]);
    const clusterIds = new Uint32Array([0, 0, 1, 1, 2]);
    const result = resolveClusterNoBreakFlags(text, clusterIds);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toHaveLength(text.length);
    expect([...result]).toEqual([1, 0, 1, 0, 0]);
  });

  it('is the exact complement of isClusterBreakAllowed at every position but the last', () => {
    const text = new Uint32Array(6);
    const clusterIds = new Uint32Array([7, 7, 7, 3, 3, 9]);
    const flags = resolveClusterNoBreakFlags(text, clusterIds);
    for (let pos = 0; pos < text.length - 1; pos++) {
      expect(flags[pos] === 1, `position ${pos}`).toBe(!isClusterBreakAllowed(clusterIds, pos));
    }
  });

  it('handles empty text', () => {
    const result = resolveClusterNoBreakFlags(new Uint32Array(0));
    expect(result.length).toBe(0);
  });

  it('replaces the boundaries name with the no-break name', () => {
    expectTypeErrors(
      `import * as core from '@libraz/mejiro';
export const flags = core.resolveClusterNoBreakFlags(new Uint32Array(1));
export const old = core.resolveClusterBoundaries(new Uint32Array(1));
`,
      { fails: ['const old'] },
    );
  });
});

describe('isClusterBreakAllowed', () => {
  it('allows break when no cluster IDs', () => {
    expect(isClusterBreakAllowed(undefined, 0)).toBe(true);
  });

  it('disallows break within same cluster', () => {
    const ids = new Uint32Array([0, 0, 1, 1, 2]);
    expect(isClusterBreakAllowed(ids, 0)).toBe(false);
    expect(isClusterBreakAllowed(ids, 2)).toBe(false);
  });

  it('allows break at cluster boundary', () => {
    const ids = new Uint32Array([0, 0, 1, 1, 2]);
    expect(isClusterBreakAllowed(ids, 1)).toBe(true);
    expect(isClusterBreakAllowed(ids, 3)).toBe(true);
  });

  it('allows break at last position, bounded by the cluster ID array itself', () => {
    const ids = new Uint32Array([0, 0, 1]);
    expect(isClusterBreakAllowed(ids, 2)).toBe(true);
    expect(isClusterBreakAllowed(ids, 7)).toBe(true);
  });
});
