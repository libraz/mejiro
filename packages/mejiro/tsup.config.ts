import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/browser/index.ts',
    'src/epub/index.ts',
    'src/render/index.ts',
    'src/book/index.ts',
    'src/image/index.ts',
    'src/analysis/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  splitting: true,
  onSuccess: async () => {
    mkdirSync('dist/render', { recursive: true });
    copyFileSync('src/render/mejiro.css', 'dist/render/mejiro.css');
    copyFileSync('src/render/mejiro-reader.css', 'dist/render/mejiro-reader.css');
    copyFileSync('src/render/mejiro-editor.css', 'dist/render/mejiro-editor.css');
    copyFileSync('src/render/mejiro-fonts.css', 'dist/render/mejiro-fonts.css');
    copyFileSync('src/render/mejiro-print.css', 'dist/render/mejiro-print.css');
  },
});
