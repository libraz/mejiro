import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeBreaks } from '../src/layout.js';
import type { RubyAnnotation } from '../src/ruby.js';
import { toCodepoints, uniformAdvances } from './helpers.js';

/** Ruby annotation as spelled in a fixture, before it is widened to advances. */
interface FixtureRubyAnnotation {
  startIndex: number;
  endIndex: number;
  rubyText: string;
  rubyAdvanceWidth: number;
  type?: RubyAnnotation['type'];
  jukugoSplitPoints?: number[];
}

interface GoldenFixture {
  description: string;
  input: {
    text: string;
    advanceWidth?: number;
    advances?: number[];
    lineWidth: number;
    rubyAnnotations?: FixtureRubyAnnotation[];
  };
  expected: {
    breakPoints: number[];
    lines?: string[];
    hangingAdjustments?: number[];
    effectiveAdvances?: number[];
    comment?: string;
  };
}

const INPUT_KEYS = ['text', 'advanceWidth', 'advances', 'lineWidth', 'rubyAnnotations'];
const EXPECTED_KEYS = [
  'breakPoints',
  'lines',
  'hangingAdjustments',
  'effectiveAdvances',
  'comment',
];

const modules = import.meta.glob<{ default: GoldenFixture }>('./golden/*.json', { eager: true });
const fixtures = Object.entries(modules)
  .map(([path, module]) => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    fixture: module.default,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

function toAnnotations(specs: FixtureRubyAnnotation[]): RubyAnnotation[] {
  return specs.map((spec) => {
    const rubyText = toCodepoints(spec.rubyText);
    return {
      startIndex: spec.startIndex,
      endIndex: spec.endIndex,
      rubyText,
      rubyAdvances: uniformAdvances(rubyText.length, spec.rubyAdvanceWidth),
      type: spec.type,
      jukugoSplitPoints: spec.jukugoSplitPoints,
    };
  });
}

function linesFromBreakPoints(text: string, breakPoints: Uint32Array): string[] {
  const chars = [...text];
  const lines: string[] = [];
  let start = 0;
  for (const breakPoint of breakPoints) {
    lines.push(chars.slice(start, breakPoint + 1).join(''));
    start = breakPoint + 1;
  }
  if (start < chars.length) lines.push(chars.slice(start).join(''));
  return lines;
}

function runGolden(fixture: GoldenFixture): void {
  const text = toCodepoints(fixture.input.text);
  const advances = fixture.input.advances
    ? new Float32Array(fixture.input.advances)
    : uniformAdvances(text.length, fixture.input.advanceWidth ?? 10);

  const result = computeBreaks({
    text,
    advances,
    lineWidth: fixture.input.lineWidth,
    rubyAnnotations: fixture.input.rubyAnnotations
      ? toAnnotations(fixture.input.rubyAnnotations)
      : undefined,
  });

  expect([...result.breakPoints]).toEqual(fixture.expected.breakPoints);

  if (fixture.expected.lines) {
    expect(linesFromBreakPoints(fixture.input.text, result.breakPoints)).toEqual(
      fixture.expected.lines,
    );
  }

  if (fixture.expected.hangingAdjustments) {
    expect(result.hangingAdjustments ? [...result.hangingAdjustments] : undefined).toEqual(
      fixture.expected.hangingAdjustments,
    );
  }

  if (fixture.expected.effectiveAdvances) {
    expect(result.effectiveAdvances ? [...result.effectiveAdvances] : undefined).toEqual(
      fixture.expected.effectiveAdvances,
    );
  }
}

describe('golden fixtures', () => {
  it('loads every fixture file in the golden directory', () => {
    const onDisk = readdirSync(new URL('./golden', import.meta.url))
      .filter((name) => name.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));

    expect(fixtures.map((entry) => entry.name)).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it('spells every fixture with keys the runner asserts', () => {
    for (const { name, fixture } of fixtures) {
      expect(Object.keys(fixture).sort(), name).toEqual(['description', 'expected', 'input']);
      for (const key of Object.keys(fixture.input)) {
        expect(INPUT_KEYS, `${name}: input.${key}`).toContain(key);
      }
      for (const key of Object.keys(fixture.expected)) {
        expect(EXPECTED_KEYS, `${name}: expected.${key}`).toContain(key);
      }
    }
  });

  for (const { name, fixture } of fixtures) {
    it(`${name}: ${fixture.description}`, () => runGolden(fixture));
  }
});
