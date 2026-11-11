import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Runs against the built app served by the API server (`pnpm preview`), as in the container, over
// the committed fixture release (apps/server/test/fixture), so results don't change with the data.
// Reuses a server already on the port, otherwise builds and starts one.
//
// The port is its own (E2E_PORT, default 4391), not the preview's 4173: Vite and other projects'
// previews default to 4173, and a server reused there would be tested in place of this one.
//
// E2E_BASE_URL points the suite at a server that is already running instead, such as the
// container image.
const baseURL = process.env['E2E_BASE_URL'];
const port = process.env['E2E_PORT'] ?? '4391';
const fixture = resolve(import.meta.dirname, '../apps/server/test/fixture');

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: baseURL ?? `http://127.0.0.1:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(baseURL === undefined
    ? {
        webServer: {
          command: 'pnpm --dir .. preview',
          url: `http://127.0.0.1:${port}/-/healthz`,
          reuseExistingServer: true,
          env: { CLINVAR_DATA_DIR: fixture, PORT: port, LOG_FILE: 'off', LOG_LEVEL: 'warn' },
        },
      }
    : {}),
});
