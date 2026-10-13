import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run the real game in Chromium against a throwaway game server (in-memory SQLite,
// separate ports, debug commands on), so they never touch your dev servers or saved games.
const GAME_PORT = 5174;
const API_PORT = 4311;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${GAME_PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'npx nest start',
      cwd: '../server',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), DATABASE_PATH: ':memory:', CORS_ORIGIN: `http://localhost:${GAME_PORT}`, DEBUG_COMMANDS: '1' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${GAME_PORT} --strictPort`,
      url: `http://localhost:${GAME_PORT}`,
      env: { GH_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
