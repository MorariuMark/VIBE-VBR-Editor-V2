import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  esbuild: {
    drop: ['console', 'debugger'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    target: 'chrome120',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Exclude volatile/heavy directories from the file watcher. The app
      // keeps its Electron profile (userData) inside the project folder and
      // Chromium locks Code Cache/Cache files while running - watching them
      // makes the dev server crash with EBUSY during a session.
      ignored: [
        '**/node_modules/**',
        '**/userData/**',
        '**/.hf_cache/**',
        '**/models/**',
        '**/tools/**',
        '**/s2.cpp/**',
        '**/dist/**',
        '**/presets/**',
        '**/.git/**',
        '**/.venv/**',
        '**/%TEMP%/**',
      ],
    },
  },
});
