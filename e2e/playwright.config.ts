import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Runs against the built app served by the API server (`pnpm preview`, port 4173), as in the
// container, over the committed fixture release (apps/server/test/fixture), so results don't
// change with the data. Reuses a running preview, otherwise builds and starts one.
//
// E2E_BASE_URL points the suite at a server that is already running instead, such as the
// container image.
const baseURL = process.env['E2E_BASE_URL'];
const fixture = resolve(import.meta.dirname, '../apps/server/test/fixture');

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: baseURL ?? 'http://127.0.0.1:4173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(baseURL === undefined
    ? {
        webServer: {
          command: 'pnpm --dir .. preview',
          url: 'http://127.0.0.1:4173/-/healthz',
          reuseExistingServer: true,
          env: { CLINVAR_DATA_DIR: fixture, LOG_FILE: 'off', LOG_LEVEL: 'warn' },
        },
      }
    : {}),
});
