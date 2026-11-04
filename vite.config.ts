/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed port and prints its own output.
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // The big import test runs on its own: npm run test:scale.
    exclude: ['tests/scale/**', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
