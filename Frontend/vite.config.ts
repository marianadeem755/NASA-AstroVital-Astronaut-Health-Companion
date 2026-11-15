/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The browser calls /api/... on port 5173; Vite forwards it to the FastAPI backend.
// Change the target if your backend runs on another port.
const BACKEND = 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: BACKEND, changeOrigin: true } },
  },
  preview: {
    proxy: { '/api': { target: BACKEND, changeOrigin: true } },
  },
  test: { environment: 'jsdom', setupFiles: './tests/setup.ts', globals: true },
});
