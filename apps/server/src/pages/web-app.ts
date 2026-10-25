import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { contentSecurityPolicy } from './csp.ts';

/** The built web app (apps/web/dist), read once at startup. */
export interface WebApp {
  root: string;
  indexHtml: string;
  contentSecurityPolicy: string;
}

export function loadWebApp(distDir: string): WebApp {
  const root = resolve(distDir);
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
  return { root, indexHtml, contentSecurityPolicy: contentSecurityPolicy(indexHtml) };
}
