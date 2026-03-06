import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
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
