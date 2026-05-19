import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const sharedFixture = fileURLToPath(new URL('../../packages/mejiro-demo/public', import.meta.url));

export default defineConfig({
  plugins: [vue()],
  publicDir: existsSync(sharedFixture) ? sharedFixture : 'public',
  server: { port: 5188 },
  build: {
    rollupOptions: {
      // Two entry HTMLs: the host page (no JS) and the reader (the iframe target).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        reader: fileURLToPath(new URL('./reader.html', import.meta.url)),
      },
    },
  },
});
