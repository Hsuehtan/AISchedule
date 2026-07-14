import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  outputDir: './test-results/playwright',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:10086',
    channel: 'chrome',
    colorScheme: 'light',
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'corepack pnpm --filter @ai-schedule/client... build && node tests/e2e/h5-server.mjs',
    port: 10086,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
