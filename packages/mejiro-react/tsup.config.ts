import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  external: ['@libraz/mejiro', '@libraz/mejiro/*', 'react', 'react/jsx-runtime'],
});
