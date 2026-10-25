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

for (const path of ['/', '/variants/10', '/genes/3077', '/genes/3077/conflicts', '/search?q=hfe']) {
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

test("a gene's conflicts tab grades its variants and lists the pairs in a grid cell", async ({
  page,
}) => {
  await page.goto('/genes/3077');
  await page.getByRole('link', { name: 'Conflicts' }).click();
  await expect(page).toHaveURL(/\/genes\/3077\/conflicts/);
  await expect(page.getByRole('heading', { name: 'Conflicts', level: 2 })).toBeVisible();
  // H63D: pathogenic against uncertain, the worst level.
  const variants = page.getByRole('region', { name: /Variants in conflict/ });
  await expect(variants.getByRole('link', { name: /p\.His63Asp/ })).toBeVisible();
  // Selecting a cell limits the pair list to that pair of classifications.
  const grid = page.getByRole('region', { name: 'Classifications compared' });
  await grid
    .getByRole('row', { name: /^Uncertain significance/ })
    .getByRole('link')
    .first()
    .click();
  await expect(page).toHaveURL(/terms=vus%2Cp|terms=vus,p/);
  await expect(page.getByText(/Showing Uncertain significance vs Pathogenic only/)).toBeVisible();
  // Looser condition rules compare more pairs.
  await page.getByRole('combobox', { name: 'Conditions' }).selectOption('any');
  await expect(page).toHaveURL(/condition_match=any/);
});

test('a submitter compares with another lab head to head', async ({ page }) => {
  await page.goto('/variants/10');
  await page
    .getByRole('link', { name: /^SCV\d{9}\.\d+$/ })
    .first()
    .click();
  const submitterHref = await page.locator('a[href^="/submitters/"]').first().getAttribute('href');
  expect(submitterHref).not.toBeNull();
  await page.goto(`${submitterHref ?? ''}/conflicts`);
  await expect(page.getByRole('heading', { name: 'Labs it conflicts with' })).toBeVisible();
  const labs = page.getByRole('region', { name: 'Labs it conflicts with' });
  await labs.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/submitters\/\d+\/vs\/\d+/);
  await expect(page.getByRole('heading', { name: /^Compared with/ })).toBeVisible();
  await expect(page.getByText(/submitted by both/)).toBeVisible();
  const results = await axe(page).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('numeric query values survive in the URL and the page', async ({ page }) => {
  // The router decodes numeric-looking values to numbers; the app keeps them as text.
  await page.goto('/genes/3077/conflicts?a.min_stars=2&b.min_stars=2');
  await expect(page).toHaveURL(/b\.min_stars=2/);
  await expect(page.getByRole('combobox', { name: 'Minimum stars' })).toHaveValue('2');
  // A variation ID goes straight to its variant, rather than an empty search.
  await page.goto('/search?q=17661');
  await expect(page).toHaveURL(/\/variants\/17661$/);
});
