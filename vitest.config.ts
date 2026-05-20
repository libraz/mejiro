import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
