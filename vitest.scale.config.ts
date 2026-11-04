import { defineConfig } from 'vitest/config';

// The 50,000-note import test: too slow for every `npm test`, run with `npm run test:scale`.
export default defineConfig({
  test: {
    include: ['tests/scale/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 600_000,
  },
});
