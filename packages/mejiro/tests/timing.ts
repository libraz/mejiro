import { expect } from 'vitest';

/**
 * Whether elapsed time measured in this run says anything about the code.
 *
 * It does not under two conditions. V8 coverage instrumentation (flagged by
 * `vitest.config.ts`) multiplies elapsed time by a factor that varies with the
 * input, so a budget or a scaling ratio measured under it describes the
 * instrumentation. A shared CI runner has no speed floor at all, so a budget
 * measured there describes whatever else the host happens to be doing.
 */
const timingIsMeaningless = process.env.MEJIRO_COVERAGE === '1' || Boolean(process.env.CI);

/**
 * Asserts that an operation stayed inside an elapsed-time bound, on runs where
 * elapsed time is worth measuring.
 *
 * The bound is a local smoke check, not a gate: it holds on a developer machine
 * and stands down under coverage and on CI. The surrounding test still runs and
 * still checks what the operation actually produced, so only the timing bound
 * is skipped — never a correctness assertion.
 *
 * A budget that has to be widened for instrumentation or a loaded runner has
 * stopped being a signal, and each widening buys less than the last. What
 * guards these hot paths on every run instead are the deterministic companion
 * assertions that count work rather than time it: the characters fed to
 * `computeBreaks`, and the `buildRenderPage` call count. Those hold whatever
 * the machine is doing, which is what a gate has to do.
 *
 * @param elapsed - Measured duration in milliseconds.
 * @param limit - Upper bound the duration must stay below.
 */
export function expectElapsedUnder(elapsed: number, limit: number): void {
  if (timingIsMeaningless) return;
  expect(elapsed).toBeLessThan(limit);
}
