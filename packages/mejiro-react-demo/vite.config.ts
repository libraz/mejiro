import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  publicDir: '../mejiro-demo/public',
  server: { port: 5174 },
});
