// The Content Security Policy for the web app's pages. Inline scripts in index.html (the theme
// bootstrap) are allowed by hash, computed from the built file at startup, so editing the
// script can't silently break it.

import { createHash } from 'node:crypto';

const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(inlineScript)].map(
    ([, body = '']) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
  );
}

export function contentSecurityPolicy(indexHtml: string): string {
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...inlineScriptHashes(indexHtml)].join(' '),
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
