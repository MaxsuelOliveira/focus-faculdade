import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4317', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx tsx scripts/test-server.ts',
    url: 'http://127.0.0.1:4317/api/health',
    reuseExistingServer: false,
    env: { OLLAMA_URL: 'http://127.0.0.1:11435' },
    timeout: 30000,
  },
  reporter: 'list',
});
