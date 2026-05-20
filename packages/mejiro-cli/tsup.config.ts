import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  target: 'es2022',
  external: ['@libraz/mejiro'],
  banner: { js: '#!/usr/bin/env node' },
});
