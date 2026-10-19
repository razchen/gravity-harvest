import { defineConfig } from 'vitest/config';

// These tests play real matches (minutes of game time): give them room when the whole repo is tested at once.
export default defineConfig({ test: { testTimeout: 120_000 } });
