import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
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
    command:
      'corepack pnpm --filter @ai-schedule/client build && python3 -m http.server 4173 --directory apps/client/dist',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
