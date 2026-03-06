import { describe, expect, it } from 'vitest';
import { isClusterBreakAllowed, resolveClusterBoundaries } from '../src/cluster.js';

describe('resolveClusterBoundaries', () => {
  it('returns all zeros when no cluster IDs provided', () => {
    const text = new Uint32Array([1, 2, 3]);
    const result = resolveClusterBoundaries(text);
    expect([...result]).toEqual([0, 0, 0]);
  });

  it('marks non-breakable positions within clusters', () => {
    const text = new Uint32Array([1, 2, 3, 4, 5]);
    const clusterIds = new Uint32Array([0, 0, 1, 1, 2]);
    const result = resolveClusterBoundaries(text, clusterIds);
    expect([...result]).toEqual([1, 0, 1, 0, 0]);
  });

  it('handles empty text', () => {
    const result = resolveClusterBoundaries(new Uint32Array(0));
    expect(result.length).toBe(0);
  });
});

describe('isClusterBreakAllowed', () => {
  it('allows break when no cluster IDs', () => {
    expect(isClusterBreakAllowed(undefined, 0, 5)).toBe(true);
  });

  it('disallows break within same cluster', () => {
    const ids = new Uint32Array([0, 0, 1, 1, 2]);
    expect(isClusterBreakAllowed(ids, 0, 5)).toBe(false);
    expect(isClusterBreakAllowed(ids, 2, 5)).toBe(false);
  });

  it('allows break at cluster boundary', () => {
    const ids = new Uint32Array([0, 0, 1, 1, 2]);
    expect(isClusterBreakAllowed(ids, 1, 5)).toBe(true);
    expect(isClusterBreakAllowed(ids, 3, 5)).toBe(true);
  });

  it('allows break at last position', () => {
    const ids = new Uint32Array([0, 0, 1]);
    expect(isClusterBreakAllowed(ids, 2, 3)).toBe(true);
  });
});
