// Process entry: reads config, opens the derived releases, serves, and shuts down cleanly on
// SIGINT/SIGTERM (podman stop sends SIGTERM).

import { ConfigError, loadConfig } from './config.ts';
import { Database } from './data/database.ts';
import { findReleases } from './data/releases.ts';
import { createLogger } from './logging.ts';
import { loadWebApp } from './pages/web-app.ts';
import { buildServer } from './server.ts';

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}

const logger = createLogger(config);
const releases = findReleases(config.dataDir);
const db = await Database.open(
  { ...config.duckdb, dataDir: config.dataDir, pinnedRelease: config.pinnedRelease },
  releases,
);
const { current } = db.available();
if (current === null) {
  logger.warn(
    { dataDir: config.dataDir },
    'no derived release found; run scripts/fetch-source.sh and scripts/derive.sh',
  );
} else {
  logger.info({ current, releases: releases.length, duckdb: config.duckdb }, 'releases loaded');
}

const web = config.webDistDir === null ? null : loadWebApp(config.webDistDir);
const app = await buildServer({ db, logger, allowedHosts: config.allowedHosts, web });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}

await app.listen({ host: config.host, port: config.port });
