import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const sharedFixture = fileURLToPath(new URL('../../packages/mejiro-demo/public', import.meta.url));

export default defineConfig({
  plugins: [react()],
  publicDir: existsSync(sharedFixture) ? sharedFixture : 'public',
  server: { port: 5185 },
});
