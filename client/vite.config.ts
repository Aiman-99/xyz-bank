import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // The production build goes into the server's public folder: Vercel's CDN
    // serves it from there, and elsewhere Express serves the same folder.
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // In dev the API runs separately on :3000.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
