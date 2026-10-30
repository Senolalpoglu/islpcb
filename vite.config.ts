import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
  // The layout worker is one classic script: the program is opened from a file, where module scripts cannot be fetched.
  worker: { format: 'iife' },
  test: { include: ['tests/**/*.test.ts'] },
});
