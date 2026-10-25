// Logs go to stdout (for `podman logs` and the terminal) and, unless LOG_FILE=off, to
// $CLINVAR_DATA_DIR/logs/server.log, rotated by size and age, with rotated files gzipped and
// the oldest deleted (docs/local-app.md#built-for-the-container-run-natively).

import { join } from 'node:path';
import pino, { type Logger } from 'pino';
import { createStream } from 'rotating-file-stream';
import type { Config } from './config.ts';

export function createLogger(config: Pick<Config, 'logLevel' | 'logFile' | 'dataDir'>): Logger {
  // A stream takes a level to write from; 'silent' is pino's level for writing nothing.
  const level = config.logLevel === 'silent' ? 'fatal' : config.logLevel;
  const streams: pino.StreamEntry[] = [{ level, stream: process.stdout }];
  if (config.logFile !== null) {
    const file = createStream('server.log', {
      path: join(config.dataDir, 'logs'),
      size: config.logFile.size,
      interval: config.logFile.interval,
      maxFiles: config.logFile.maxFiles,
      compress: 'gzip',
    });
    streams.push({ level, stream: file });
  }
  return pino({ level: config.logLevel }, pino.multistream(streams));
}
