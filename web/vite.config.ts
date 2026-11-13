import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so dist/ works from any static host path (e.g. GitHub Pages project URL).
  base: './',
  // data/ holds only validated, publishable products; disposable caches live in .cache/.
  publicDir: '../data',
  build: { target: 'es2022', sourcemap: true },
});
