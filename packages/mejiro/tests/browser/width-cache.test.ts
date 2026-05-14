import { describe, expect, it } from 'vitest';
import { WidthCache } from '../../src/browser/width-cache.js';

describe('WidthCache', () => {
  it('returns undefined for uncached entries', () => {
    const cache = new WidthCache();
    expect(cache.get('16px serif', 0x3042)).toBeUndefined();
  });

  it('stores and retrieves values', () => {
    const cache = new WidthCache();
    cache.set('16px serif', 0x3042, 16);
    expect(cache.get('16px serif', 0x3042)).toBe(16);
  });

  it('isolates entries by font key', () => {
    const cache = new WidthCache();
    cache.set('16px serif', 0x3042, 16);
    cache.set('24px serif', 0x3042, 24);
    expect(cache.get('16px serif', 0x3042)).toBe(16);
    expect(cache.get('24px serif', 0x3042)).toBe(24);
  });

  it('clears all entries', () => {
    const cache = new WidthCache();
    cache.set('16px serif', 0x3042, 16);
    cache.set('24px serif', 0x3042, 24);
    cache.clear();
    expect(cache.get('16px serif', 0x3042)).toBeUndefined();
    expect(cache.get('24px serif', 0x3042)).toBeUndefined();
  });

  it('clears entries for a specific font', () => {
    const cache = new WidthCache();
    cache.set('16px serif', 0x3042, 16);
    cache.set('24px serif', 0x3042, 24);
    cache.clear('16px serif');
    expect(cache.get('16px serif', 0x3042)).toBeUndefined();
    expect(cache.get('24px serif', 0x3042)).toBe(24);
  });

  it('reports size correctly', () => {
    const cache = new WidthCache();
    expect(cache.size()).toBe(0);
    cache.set('16px serif', 0x3042, 16);
    cache.set('16px serif', 0x3043, 16);
    cache.set('24px serif', 0x3042, 24);
    expect(cache.size()).toBe(3);
    expect(cache.size('16px serif')).toBe(2);
    expect(cache.size('24px serif')).toBe(1);
    expect(cache.size('unknown')).toBe(0);
  });

  it('reports stats with both font count and codepoint total', () => {
    const cache = new WidthCache();
    expect(cache.stats()).toEqual({ fonts: 0, codepoints: 0 });
    cache.set('16px serif', 0x3042, 16);
    cache.set('16px serif', 0x3043, 16);
    cache.set('24px serif', 0x3042, 24);
    expect(cache.fontCount()).toBe(2);
    expect(cache.stats()).toEqual({ fonts: 2, codepoints: 3 });
  });

  it('evicts the least-recently-used font when maxFonts is exceeded', () => {
    const cache = new WidthCache({ maxFonts: 2 });
    cache.set('a', 1, 10);
    cache.set('b', 1, 20);
    // Touch 'a' so 'b' becomes LRU.
    cache.get('a', 1);
    cache.set('c', 1, 30);
    expect(cache.get('a', 1)).toBe(10);
    expect(cache.get('b', 1)).toBeUndefined();
    expect(cache.get('c', 1)).toBe(30);
    expect(cache.fontCount()).toBe(2);
  });

  it('evicts the least-recently-used codepoint when maxCodepointsPerFont is exceeded', () => {
    const cache = new WidthCache({ maxCodepointsPerFont: 2 });
    cache.set('serif', 1, 10);
    cache.set('serif', 2, 20);
    // Touch 1 so 2 becomes LRU.
    cache.get('serif', 1);
    cache.set('serif', 3, 30);
    expect(cache.get('serif', 1)).toBe(10);
    expect(cache.get('serif', 2)).toBeUndefined();
    expect(cache.get('serif', 3)).toBe(30);
    expect(cache.size('serif')).toBe(2);
  });
});
