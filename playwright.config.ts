import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running app (local stand-in stack or a real Supabase-backed deploy).
 *   E2E_BASE_URL=http://localhost:3000 E2E_DB_URL=postgres://... npm run test:e2e
 * E2E_DB_URL is used only to look up correct answers so the test can score >= 50%.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'pixel5', use: { ...devices['Pixel 5'] } }],
});
