import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, inlineScriptHashes } from './csp.ts';

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

describe('inlineScriptHashes', () => {
  it('hashes each inline script body exactly, whitespace included', () => {
    const body = '\n  document.documentElement.dataset.theme = "dark";\n';
    expect(inlineScriptHashes(`<head><script>${body}</script></head>`)).toEqual([sha256(body)]);
  });

  it('ignores scripts loaded from a file', () => {
    const html = '<script type="module" crossorigin src="/assets/index-abc.js"></script>';
    expect(inlineScriptHashes(html)).toEqual([]);
  });
});

describe('contentSecurityPolicy', () => {
  it('allows only same-origin resources plus the inline scripts by hash', () => {
    const policy = contentSecurityPolicy('<script>a()</script>');
    expect(policy).toContain(`script-src 'self' ${sha256('a()')}`);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-inline');
  });
});
