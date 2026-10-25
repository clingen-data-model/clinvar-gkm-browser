// Environment variables, validated at startup. The process refuses to start on invalid config.
// The same variables configure a native run and the container image (docs/local-app.md).

import { availableParallelism, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';

const onOff = z.enum(['on', 'off']).transform((value) => value === 'on');

const Env = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Everything the app writes goes under here: source and derived data, workspace, logs, temp.
  CLINVAR_DATA_DIR: z.string().min(1).default('data'),
  // Host header values accepted, against DNS rebinding (docs/local-app.md#security).
  CLINVAR_ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1,[::1]'),
  // Serve this derived release by default instead of the newest on disk.
  CLINVAR_RELEASE: z.iso.date().optional(),
  DUCKDB_MEMORY_LIMIT: z.string().optional(),
  DUCKDB_THREADS: z.coerce.number().int().min(1).optional(),
  QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).default(30_000),
  // The built web app (apps/web/dist). Unset in development, where Vite serves it.
  WEB_DIST_DIR: z.string().min(1).optional(),
  LOG_FILE: onOff.default(true),
  LOG_ROTATE_SIZE: z.string().default('50M'),
  LOG_ROTATE_INTERVAL: z.string().default('1d'),
  LOG_MAX_FILES: z.coerce.number().int().min(1).default(14),
});

export type LogLevel = z.infer<typeof Env>['LOG_LEVEL'];

export interface Config {
  host: string;
  port: number;
  logLevel: LogLevel;
  dataDir: string;
  allowedHosts: string[];
  pinnedRelease: string | null;
  webDistDir: string | null;
  duckdb: { memoryLimit: string; threads: number; queryTimeoutMs: number };
  logFile: { size: string; interval: string; maxFiles: number } | null;
}

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    dataDir: resolve(e.CLINVAR_DATA_DIR),
    allowedHosts: e.CLINVAR_ALLOWED_HOSTS.split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== ''),
    pinnedRelease: e.CLINVAR_RELEASE ?? null,
    webDistDir: e.WEB_DIST_DIR ?? null,
    duckdb: {
      // Half the machine (or container) by default, leaving room for Node and the OS.
      memoryLimit: e.DUCKDB_MEMORY_LIMIT ?? `${Math.max(1, Math.floor(totalmem() / 2 ** 31))}GB`,
      threads: e.DUCKDB_THREADS ?? availableParallelism(),
      queryTimeoutMs: e.QUERY_TIMEOUT_MS,
    },
    logFile: e.LOG_FILE
      ? { size: e.LOG_ROTATE_SIZE, interval: e.LOG_ROTATE_INTERVAL, maxFiles: e.LOG_MAX_FILES }
      : null,
  };
}
