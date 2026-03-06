import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/browser/index.ts', 'src/epub/index.ts', 'src/render/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  splitting: true,
  onSuccess: async () => {
    mkdirSync('dist/render', { recursive: true });
    copyFileSync('src/render/mejiro.css', 'dist/render/mejiro.css');
  },
});
