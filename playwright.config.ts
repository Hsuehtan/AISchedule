import { defineConfig, devices } from '@playwright/test';

const h5Port = Number(process.env.H5_PORT ?? 11086);
const apiPort = Number(process.env.API_PORT ?? 13000);

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/visual-sweep.spec.ts'],
  globalSetup: './tests/e2e/global-setup.ts',
  outputDir: './test-results/playwright',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${h5Port}`,
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
    env: {
      API_PORT: String(apiPort),
      H5_PORT: String(h5Port),
    },
    port: h5Port,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
