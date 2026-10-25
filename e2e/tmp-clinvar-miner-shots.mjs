// Temporary: screenshot a local ClinVar Miner instance. Delete after use.
// Usage: node tmp-clinvar-miner-shots.mjs <shots.json> <outdir> <base-url>
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [shotsFile, outDir, base] = process.argv.slice(2);
const shots = JSON.parse(fs.readFileSync(shotsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const MAX_H = 14000;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1400, height: process.env.TOP ? 1800 : 900 },
  // The fork aborts with 406 unless the request advertises zstd.
  extraHTTPHeaders: process.env.NO_ZSTD ? {} : { 'Accept-Encoding': 'gzip, deflate, br, zstd' },
});
const page = await context.newPage();
const results = [];
for (const shot of shots) {
  const url = base + shot.url;
  const t0 = Date.now();
  let status = null, err = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
    status = resp ? resp.status() : null;
    if (shot.actions) {
      for (const a of shot.actions) {
        if (a.type === 'fill') await page.fill(a.selector, a.value);
        if (a.type === 'check') await page.check(a.selector);
        if (a.type === 'select') await page.selectOption(a.selector, a.value);
        if (a.type === 'click') await Promise.all([
          page.waitForLoadState('networkidle'), page.click(a.selector)]);
        if (a.type === 'wait') await page.waitForTimeout(a.ms);
      }
      await page.waitForLoadState('networkidle');
    }
  } catch (e) { err = String(e).slice(0, 300); }
  const ms = Date.now() - t0;
  const info = await page.evaluate(() => {
    const h1 = document.querySelector('h1')?.innerText ?? '';
    const tables = [...document.querySelectorAll('table')].map(t => ({
      id: t.id, cls: t.className,
      headers: [...t.querySelectorAll('thead th')].map(th => th.innerText.trim()).slice(0, 25),
      rows: t.querySelectorAll('tbody tr').length,
    }));
    const h2s = [...document.querySelectorAll('h2')].map(h => h.innerText.replace(/#$/, '').trim());
    const totals = [...document.querySelectorAll('.totals div')].map(d => d.innerText.trim());
    const tagline = [...document.querySelectorAll('.tagline')].map(d => d.innerText.trim());
    const selects = [...document.querySelectorAll('select')].map(s => s.name);
    const checkboxes = [...new Set([...document.querySelectorAll('input[type=checkbox]')].map(c => c.name))];
    const svgs = document.querySelectorAll('svg').length;
    return { h1, h2s, totals, tagline, tables, selects, checkboxes, svgs,
      height: document.documentElement.scrollHeight, finalUrl: location.href };
  }).catch(e => ({ evalError: String(e) }));
  const file = path.join(outDir, shot.name + '.png');
  try {
    if (process.env.TOP) {
      await page.screenshot({ path: file });
    } else if ((info.height ?? 0) > MAX_H) {
      await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: 1400, height: MAX_H } });
      info.truncated = true;
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
  } catch (e) { err = (err ?? '') + ' screenshot: ' + String(e).slice(0, 200); }
  results.push({ ...shot, status, ms, err, ...info });
  console.log(`${status} ${ms}ms ${shot.name} ${err ?? ''}`);
}
fs.writeFileSync(path.join(outDir, '_results.json'), JSON.stringify(results, null, 1));
await browser.close();
