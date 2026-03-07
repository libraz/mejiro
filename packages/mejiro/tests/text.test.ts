import { describe, expect, it } from 'vitest';
import { toCodepoints } from '../src/text.js';

describe('toCodepoints', () => {
  it('converts basic CJK characters', () => {
    const result = toCodepoints('あいう');
    expect([...result]).toEqual([0x3042, 0x3044, 0x3046]);
  });

  it('converts ASCII characters', () => {
    const result = toCodepoints('ABC');
    expect([...result]).toEqual([0x41, 0x42, 0x43]);
  });

  it('returns empty array for empty string', () => {
    const result = toCodepoints('');
    expect(result.length).toBe(0);
    expect(result).toBeInstanceOf(Uint32Array);
  });

  it('handles surrogate pairs (emoji)', () => {
    // 🎉 is U+1F389 (outside BMP, represented as surrogate pair in JS)
    const result = toCodepoints('🎉');
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0x1f389);
  });

  it('handles mixed BMP and surrogate pair characters', () => {
    // あ (U+3042) + 𠮷 (U+20BB7, CJK Extension B) + い (U+3044)
    const result = toCodepoints('あ𠮷い');
    expect(result.length).toBe(3);
    expect([...result]).toEqual([0x3042, 0x20bb7, 0x3044]);
  });

  it('returns Uint32Array', () => {
    expect(toCodepoints('test')).toBeInstanceOf(Uint32Array);
  });
});
