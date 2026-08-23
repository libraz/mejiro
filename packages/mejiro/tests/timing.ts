import { expect } from 'vitest';

/**
 * Whether the current run collects coverage, as set by `vitest.config.ts`.
 *
 * V8 instrumentation multiplies elapsed time by a factor that varies with the
 * input, so a wall-clock budget or a scaling ratio measured under it describes
 * the instrumentation rather than the code.
 */
const underCoverage = process.env.MEJIRO_COVERAGE === '1';

/**
 * Asserts that an operation stayed inside an elapsed-time bound, except while
 * coverage is being collected.
 *
 * The surrounding test still runs and still checks what the operation actually
 * produced; only the timing bound stands down, because a threshold that has to
 * be widened for instrumentation or a slow runner stops being a signal. The
 * algorithmic guards that hold regardless of machine speed — counting the work
 * fed to a hot function rather than timing it — carry the regression coverage
 * on those runs.
 *
 * @param elapsed - Measured duration in milliseconds.
 * @param limit - Upper bound the duration must stay below.
 */
export function expectElapsedUnder(elapsed: number, limit: number): void {
  if (underCoverage) return;
  expect(elapsed).toBeLessThan(limit);
}
