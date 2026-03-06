import { describe, expect, it } from 'vitest';
import { computeHangingAdjustment, isHangingTarget } from '../src/hanging.js';

describe('isHangingTarget', () => {
  it('identifies Japanese comma as hanging target', () => {
    expect(isHangingTarget(0x3001)).toBe(true); // 、
  });

  it('identifies Japanese period as hanging target', () => {
    expect(isHangingTarget(0x3002)).toBe(true); // 。
  });

  it('identifies fullwidth comma as hanging target', () => {
    expect(isHangingTarget(0xff0c)).toBe(true); // ，
  });

  it('identifies fullwidth period as hanging target', () => {
    expect(isHangingTarget(0xff0e)).toBe(true); // ．
  });

  it('rejects regular characters', () => {
    expect(isHangingTarget(0x3042)).toBe(false); // あ
    expect(isHangingTarget(0x0041)).toBe(false); // A
  });
});

describe('computeHangingAdjustment', () => {
  it('returns advance for hanging targets', () => {
    expect(computeHangingAdjustment(0x3001, 16)).toBe(16);
  });

  it('returns 0 for non-hanging characters', () => {
    expect(computeHangingAdjustment(0x3042, 16)).toBe(0);
  });
});
