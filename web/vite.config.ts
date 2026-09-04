import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  // Tailwind 4 compiles through its Vite plugin. Without it, the
  // `@import "tailwindcss"` in main.css is emitted verbatim and every utility
  // and DaisyUI class silently resolves to nothing — a build that succeeds and
  // ships an unstyled app.
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@foundry/protocol': path.resolve(__dirname, '../src/desktop/protocol.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
