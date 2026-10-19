import { defineConfig, devices } from '@playwright/test';

// Frame-time measurement (npm run perf -w @gravity-harvest/game): not part of the e2e run. Like the e2e tests it
// starts its own throwaway game server (in-memory SQLite, debug commands on) and Vite, on ports of its own, so it can
// run next to your dev servers and the e2e tests.
const GAME_PORT = 5175;
const API_PORT = 4312;

export default defineConfig({
  testDir: '.',
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${GAME_PORT}`,
    viewport: { width: 1440, height: 900 },
  },
  // the real GPU (headless Chromium otherwise draws with a software renderer, which would be all the profile shows);
  // the Metal flag is for macOS, other systems pick their own
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1440, height: 900 },
      launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] },
    },
  }],
  webServer: [
    {
      command: 'npx nest start',
      cwd: '../../server',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), DATABASE_PATH: ':memory:', CORS_ORIGIN: `http://localhost:${GAME_PORT}`, DEBUG_COMMANDS: '1' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${GAME_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${GAME_PORT}`,
      env: { GH_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
