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
});
