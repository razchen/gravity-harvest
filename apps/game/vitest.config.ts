import { defineConfig } from 'vitest/config';

// Unit tests cover pure game logic and content integrity; browser behaviour is in e2e/ (Playwright).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
