import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.ts';

// Design-review prototype only: builds prototype.html on its own, outside the production dist/.
export default mergeConfig(
  base,
  defineConfig({
    build: { outDir: 'dist/proto', emptyOutDir: true, rollupOptions: { input: 'prototype.html' } },
  }),
);
