import { afterEach, describe, expect, it } from 'vitest';
import {
  getDefaultKinsokuRules,
  isLineEndProhibited,
  isLineStartProhibited,
  setKinsokuRules,
} from '../src/kinsoku.js';

afterEach(() => {
  setKinsokuRules(null);
});

describe('isLineStartProhibited', () => {
  it('prohibits closing brackets in strict mode', () => {
    expect(isLineStartProhibited(0x300d, 'strict')).toBe(true); // 」
    expect(isLineStartProhibited(0x3011, 'strict')).toBe(true); // 】
  });

  it('prohibits small kana in strict mode', () => {
    expect(isLineStartProhibited(0x3041, 'strict')).toBe(true); // ぁ
    expect(isLineStartProhibited(0x30c3, 'strict')).toBe(true); // ッ
  });

  it('allows small kana in loose mode', () => {
    expect(isLineStartProhibited(0x3041, 'loose')).toBe(false); // ぁ
    expect(isLineStartProhibited(0x30c3, 'loose')).toBe(false); // ッ
    expect(isLineStartProhibited(0x30fc, 'loose')).toBe(false); // ー
  });

  it('still prohibits punctuation in loose mode', () => {
    expect(isLineStartProhibited(0x3001, 'loose')).toBe(true); // 、
    expect(isLineStartProhibited(0x300d, 'loose')).toBe(true); // 」
  });

  it('allows regular characters', () => {
    expect(isLineStartProhibited(0x3042, 'strict')).toBe(false); // あ
    expect(isLineStartProhibited(0x6f22, 'strict')).toBe(false); // 漢
  });
});

describe('isLineEndProhibited', () => {
  it('prohibits opening brackets', () => {
    expect(isLineEndProhibited(0x300c)).toBe(true); // 「
    expect(isLineEndProhibited(0x3010)).toBe(true); // 【
  });

  it('allows regular characters', () => {
    expect(isLineEndProhibited(0x3042)).toBe(false); // あ
  });
});

describe('setKinsokuRules / getDefaultKinsokuRules', () => {
  it('can set custom rules', () => {
    setKinsokuRules({
      lineStartProhibited: [0x0041], // 'A'
      lineEndProhibited: [0x0042], // 'B'
    });
    expect(isLineStartProhibited(0x0041)).toBe(true);
    expect(isLineEndProhibited(0x0042)).toBe(true);
    // Original rules no longer apply
    expect(isLineStartProhibited(0x3001)).toBe(false);
  });

  it('can reset to defaults by passing null', () => {
    setKinsokuRules({ lineStartProhibited: [0x0041], lineEndProhibited: [] });
    setKinsokuRules(null);
    expect(isLineStartProhibited(0x0041)).toBe(false);
    expect(isLineStartProhibited(0x3001)).toBe(true);
  });

  it('returns default rules', () => {
    const rules = getDefaultKinsokuRules();
    expect(rules.lineStartProhibited).toContain(0x3001);
    expect(rules.lineEndProhibited).toContain(0x300c);
  });
});
