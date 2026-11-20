import { defineConfig, devices } from '@playwright/test';

const local = !process.env.CI;
const demoOnly = process.env.DEMO_ONLY === '1';
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
    launchOptions: local ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/usr/bin/chromium' } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: local ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/usr/bin/chromium' } : {} } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: local ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/usr/bin/chromium' } : {} }, grep: /@mobile/ },
  ],
  webServer: {
    command: demoOnly ? 'npx vite preview --port 4173 --host 127.0.0.1 --strictPort' : 'node tests/stack/dev-stack.mjs',
    url: demoOnly ? 'http://127.0.0.1:4173/findback-campus-v2/' : 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
