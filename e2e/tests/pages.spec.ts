import { expect, test } from '@playwright/test';
import { axe } from './axe.ts';

test('home searches by gene and lands on the gene page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Browse ClinVar by submission');
  await page.getByRole('searchbox', { name: 'Search ClinVar' }).fill('HFE');
  await page.getByRole('searchbox', { name: 'Search ClinVar' }).press('Enter');
  await expect(page).toHaveURL(/\/search\?q=HFE/);
  await page.getByRole('link', { name: 'HFE', exact: true }).click();
  await expect(page).toHaveURL(/\/genes\/3077$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('HFE');
  await expect(page.getByRole('heading', { name: /^Submissions/ })).toBeVisible();
});

test('an accession search goes straight to the variant page', async ({ page }) => {
  await page.goto('/search?q=VCV000000010');
  await expect(page).toHaveURL(/\/variants\/10$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'NM_000410.4(HFE):c.187C>G (p.His63Asp)',
  );
  await expect(
    page.getByRole('heading', { name: 'ClinVar’s aggregate classification' }),
  ).toBeVisible();
  // Every SCV of the variant is listed, with links to the submission pages.
  const rows = page.getByRole('link', { name: /^SCV\d{9}\.\d+$/ });
  expect(await rows.count()).toBeGreaterThan(50);
});

test('an SCV page shows its classification and variant', async ({ page }) => {
  await page.goto('/variants/10');
  await page
    .getByRole('link', { name: /^SCV\d{9}\.\d+$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/scvs\/\d+$/);
  await expect(page.getByText('Classification', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'VCV000000010' })).toBeVisible();
});

test('an unknown variant shows not found with a 404', async ({ page }) => {
  const response = await page.goto('/nonexistent-page');
  expect(response?.status()).toBe(404);
  await page.goto('/variants/999999999');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
});

for (const path of ['/', '/variants/10', '/genes/3077', '/search?q=hfe']) {
  test(`${path} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await axe(page).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}

test("a gene's variants can include those spanning or near it", async ({ page }) => {
  await page.goto('/genes/3077');
  const variants = page.getByRole('definition').first();
  await expect(variants).toHaveText('334');
  // H63D is within HFE and its antisense gene; its rows say so.
  await expect(page.getByText('also in HFE-AS1').first()).toBeVisible();
  await page.getByRole('checkbox', { name: /Spanning the gene/ }).check();
  await expect(page).toHaveURL(/gene_relationship=single,overlap,spanning/);
  await expect(variants).toHaveText('352');
});
