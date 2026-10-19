import { defineConfig } from 'vitest/config';

// Many tests play out whole matches. They take a second or two here, but CI runs every package's tests at once on a
// small machine, where the default 5 s limit is too tight.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
