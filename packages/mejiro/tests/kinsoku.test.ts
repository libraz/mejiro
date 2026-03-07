import { describe, expect, it } from 'vitest';
import {
  buildKinsokuRules,
  getDefaultKinsokuRules,
  isLineEndProhibited,
  isLineStartProhibited,
} from '../src/kinsoku.js';

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

  it('uses custom rules when provided', () => {
    const rules = buildKinsokuRules({
      lineStartProhibited: [0x0041], // 'A'
      lineEndProhibited: [0x0042], // 'B'
    });
    expect(isLineStartProhibited(0x0041, 'strict', rules)).toBe(true);
    // Original rules no longer apply when custom rules are passed
    expect(isLineStartProhibited(0x3001, 'strict', rules)).toBe(false);
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

  it('uses custom rules when provided', () => {
    const rules = buildKinsokuRules({
      lineStartProhibited: [0x0041],
      lineEndProhibited: [0x0042], // 'B'
    });
    expect(isLineEndProhibited(0x0042, rules)).toBe(true);
    // Original rules no longer apply
    expect(isLineEndProhibited(0x300c, rules)).toBe(false);
  });
});

describe('getDefaultKinsokuRules / buildKinsokuRules', () => {
  it('returns default rules with lookup sets', () => {
    const rules = getDefaultKinsokuRules();
    expect(rules.lineStartProhibited).toContain(0x3001);
    expect(rules.lineEndProhibited).toContain(0x300c);
    expect(rules.lineStartProhibitedSet.has(0x3001)).toBe(true);
    expect(rules.lineEndProhibitedSet.has(0x300c)).toBe(true);
  });

  it('buildKinsokuRules creates rules with sets', () => {
    const rules = buildKinsokuRules({
      lineStartProhibited: [0x0041],
      lineEndProhibited: [0x0042],
    });
    expect(rules.lineStartProhibitedSet.has(0x0041)).toBe(true);
    expect(rules.lineEndProhibitedSet.has(0x0042)).toBe(true);
  });
});
