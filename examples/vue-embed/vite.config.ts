import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const sharedFixture = fileURLToPath(new URL('../../packages/mejiro-demo/public', import.meta.url));

export default defineConfig({
  plugins: [vue()],
  publicDir: existsSync(sharedFixture) ? sharedFixture : 'public',
  server: { port: 5184 },
});
