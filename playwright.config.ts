import { defineConfig, devices } from '@playwright/test';

// Load E2E env from .env.e2e (or .env.local). Requires: E2E_EMAIL, E2E_PASSWORD, E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY
require('dotenv').config({ path: '.env.e2e' });
require('dotenv').config({ path: '.env.local' });

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
