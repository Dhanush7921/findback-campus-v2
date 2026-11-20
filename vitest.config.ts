import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['api/test/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
