import {
  buildKinsokuRules,
  computeBreaks,
  extendKinsokuRules,
  getDefaultKinsokuRules,
  isLineEndProhibited,
  isLineStartProhibited,
  isUnbreakablePair,
  toCodepoints,
} from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

const PERCENT = 0xff05; // ％

describe('custom kinsoku rules', () => {
  describe('buildKinsokuRules', () => {
    it('builds rules from a rule source and answers through the predicates', () => {
      const rules = buildKinsokuRules({
        lineStartProhibited: [0x41],
        lineEndProhibited: [0x42],
        unbreakablePairs: [[0x43, 0x44]],
      });

      expect(isLineStartProhibited(0x41, { kinsoku: rules })).toBe(true);
      expect(isLineEndProhibited(0x42, { kinsoku: rules })).toBe(true);
      expect(isUnbreakablePair(0x43, 0x44, { kinsoku: rules })).toBe(true);
    });

    it('exposes only the rule lists, as read-only copies', () => {
      const lineStart = [0x41];
      const rules = buildKinsokuRules({ lineStartProhibited: lineStart, lineEndProhibited: [] });

      expect(rules.lineStartProhibited).toEqual([0x41]);
      expect(rules.lineEndProhibited).toEqual([]);
      expect(rules.unbreakablePairs).toEqual([]);
      expect(Object.keys(rules).sort()).toEqual([
        'lineEndProhibited',
        'lineStartProhibited',
        'unbreakablePairs',
      ]);
      expect(() => (rules.lineStartProhibited as number[]).push(0x42)).toThrow(TypeError);

      // The rules do not follow later changes to the arrays they were built from.
      lineStart.push(0x42);
      expect(isLineStartProhibited(0x42, { kinsoku: rules })).toBe(false);
    });

    it('rules out the set fields and in-place edits at the type level', () => {
      expectTypeErrors(
        `import { buildKinsokuRules } from '@libraz/mejiro';
const rules = buildKinsokuRules({ lineStartProhibited: [1], lineEndProhibited: [2], unbreakablePairs: [[3, 4]] });
export const starts: readonly number[] = rules.lineStartProhibited;
export const readonlyInput = buildKinsokuRules({ lineStartProhibited: [1] as readonly number[], lineEndProhibited: [] as readonly number[] });
export const sets = rules.lineStartProhibitedSet;
export const push = rules.lineStartProhibited.push(5);
`,
        { fails: ['const sets', 'const push'] },
      );
    });
  });

  describe('extendKinsokuRules', () => {
    it('adds code points to the default rules in one call', () => {
      const base = getDefaultKinsokuRules();
      const extended = extendKinsokuRules(base, { lineStartProhibited: [PERCENT] });

      expect(isLineStartProhibited(PERCENT, { kinsoku: extended })).toBe(true);
      expect(isLineStartProhibited(0x3001, { kinsoku: extended })).toBe(true);
      expect(isLineEndProhibited(0x300c, { kinsoku: extended })).toBe(true);
      expect(isUnbreakablePair(0x2026, 0x2026, { kinsoku: extended })).toBe(true);
      expect(isLineStartProhibited(PERCENT, { kinsoku: base })).toBe(false);
    });

    it('adds line-end and pair rules and leaves omitted lists as they were', () => {
      const base = buildKinsokuRules({ lineStartProhibited: [1], lineEndProhibited: [2] });
      const extended = extendKinsokuRules(base, {
        lineEndProhibited: [3],
        unbreakablePairs: [[4, 5]],
      });

      expect(extended.lineStartProhibited).toEqual([1]);
      expect(extended.lineEndProhibited).toEqual([2, 3]);
      expect(extended.unbreakablePairs).toEqual([[4, 5]]);
    });

    it('moves a break the extended rule forbids', () => {
      const text = toCodepoints('あいうえお％かきくけこ');
      const advances = new Float32Array(text.length).fill(10);
      const input = { text, advances, lineWidth: 50 };
      const plain = computeBreaks({ ...input, kinsoku: getDefaultKinsokuRules() });
      const extended = computeBreaks({
        ...input,
        kinsoku: extendKinsokuRules(getDefaultKinsokuRules(), { lineStartProhibited: [PERCENT] }),
      });

      expect([...plain.breakPoints]).toEqual([4, 9]);
      expect([...extended.breakPoints]).toEqual([3, 8]);
    });

    it('takes the additions as a partial rule source', () => {
      expectTypeErrors(
        `import { extendKinsokuRules, getDefaultKinsokuRules } from '@libraz/mejiro';
import type { KinsokuRuleSource } from '@libraz/mejiro';
const base = getDefaultKinsokuRules();
const additions: Partial<KinsokuRuleSource> = { lineStartProhibited: [0xff05] };
export const ok = extendKinsokuRules(base, additions);
export const wrongField = extendKinsokuRules(base, { lineStartProhibitedSet: new Set<number>() });
`,
        { fails: ['const wrongField'] },
      );
    });
  });
});
