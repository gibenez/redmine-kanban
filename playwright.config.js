import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  use: { baseURL: process.env.BOARD_TEST_URL || 'http://127.0.0.1:4173', viewport: { width: 1440, height: 1000 } },
  webServer: process.env.BOARD_TEST_URL ? undefined : { command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
