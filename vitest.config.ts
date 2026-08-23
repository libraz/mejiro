import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Whether this run collects coverage.
 *
 * V8 instrumentation inflates elapsed time by a factor that varies with the
 * input, which makes wall-clock budgets and scaling ratios meaningless — a
 * tokenizer measured as linear without coverage reads as superlinear with it.
 * Tests that assert on elapsed time read this flag and stand down, so the
 * coverage run stays a binary signal instead of a machine-speed gate.
 */
const coverageEnabled = process.argv.includes('--coverage');

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@libraz\/mejiro\/render\/(.+\.css)$/u,
        replacement: fileURLToPath(new URL('./packages/mejiro/src/render/$1', import.meta.url)),
      },
      {
        find: /^@libraz\/mejiro\/(book|browser|epub|image|render)$/u,
        replacement: fileURLToPath(new URL('./packages/mejiro/src/$1/index.ts', import.meta.url)),
      },
      {
        find: /^@libraz\/mejiro$/u,
        replacement: fileURLToPath(new URL('./packages/mejiro/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['packages/*/tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/vitest.setup.ts'],
    // biome-ignore lint/style/useNamingConvention: environment variable names are SCREAMING_SNAKE_CASE
    env: { MEJIRO_COVERAGE: coverageEnabled ? '1' : '' },
    // Several tests parse every source file in the workspace or build EPUB
    // archives from scratch; under coverage they run several times longer than
    // the 5s default allows.
    testTimeout: 30_000,
    benchmark: {
      include: ['packages/*/bench/**/*.bench.ts'],
    },
    coverage: {
      provider: 'v8',
      include: ['packages/mejiro/src/**'],
      exclude: ['packages/mejiro/src/browser/**'],
    },
  },
});
