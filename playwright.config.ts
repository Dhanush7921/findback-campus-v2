import { defineConfig, devices } from '@playwright/test';

const local = !process.env.CI;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/findback-campus-v2/',
    trace: 'off',
    launchOptions: local ? { executablePath: '/opt/pw-browsers/chromium' } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: local ? { executablePath: '/opt/pw-browsers/chromium' } : {} } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: local ? { executablePath: '/opt/pw-browsers/chromium' } : {} }, grep: /@mobile/ },
  ],
  webServer: {
    command: 'node tests/stack/dev-stack.mjs',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
