import { expect, test } from '@playwright/test';
import { axe } from './axe.ts';

test('home searches by gene and lands on the gene page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Browse ClinVar by submission');
  // The home page's own box, under the header's.
  const box = page.getByRole('searchbox', { name: 'Search ClinVar' }).last();
  await box.fill('HFE');
  await box.press('Enter');
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

test('a release not stored says so, asks the API nothing for it, and links the releases stored', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/') && url.includes('release=2020-01-01')) asked.push(url);
  });
  await page.goto('/variants/10?release=2020-01-01');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Release not available');
  await expect(page.getByText('as of ClinVar release 2020-01-01')).toBeVisible();
  expect(asked).toEqual([]);
  await expect(page.getByText('ClinVar release not available')).toBeVisible();
  // The release after it, and the only one stored: this same page as of it.
  await page.getByRole('link', { name: '2026-10-18 (latest)' }).first().click();
  await expect(page).toHaveURL(/\/variants\/10$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'NM_000410.4(HFE):c.187C>G (p.His63Asp)',
  );
});

test('a malformed release says it is not a release date, and keeps the other parameters', async ({
  page,
}) => {
  await page.goto('/search?q=hfe&release=last-week');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Release not available');
  await expect(page.getByText('“last-week” isn’t a ClinVar release date')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nearest' })).toHaveCount(0);
  await page.getByRole('link', { name: '2026-10-18 (latest)' }).click();
  await expect(page).toHaveURL(/\/search\?q=hfe$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Results for “hfe”');
});

test('a release the API no longer serves gets the same page, not "not found"', async ({ page }) => {
  // The browser's list of releases is out of date: it still names one the server doesn't serve.
  const release = (clinvarRelease: string) => ({
    clinvarRelease,
    parquetBuildDate: '2026-10-15',
    gkmSchemaVersion: '1.1.0',
    gkmDataset: 'fixture',
    derivedSchema: 1,
    loadedAt: '2026-10-30 00:00:00',
    tables: [],
  });
  await page.route('**/api/v1/releases', (route) =>
    route.fulfill({
      json: { current: '2026-10-18', data: [release('2026-10-11'), release('2026-10-18')] },
    }),
  );
  await page.goto('/variants/10?release=2026-10-11');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Release not available');
  // The server's list, not the browser's: only the release it serves.
  await expect(page.getByRole('link', { name: '2026-10-11' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '2026-10-18 (latest)' }).first()).toBeVisible();
});

for (const path of [
  '/',
  '/variants/10',
  '/genes/3077',
  '/genes/3077/conflicts',
  '/search?q=hfe',
  '/schema',
  '/variants/10?release=2020-01-01',
  '/stats/aggregate-classification',
  '/stats/clinsig-conflict-variants?conflict=pairs&condition_match=any',
]) {
  test(`${path} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await axe(page).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}

test('the schema page draws each diagram from the doc', async ({ page }) => {
  await page.goto('/schema');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schema diagrams');
  const diagrams = page.getByRole('img', { name: /^Entity-relationship diagram/ });
  await expect(diagrams).toHaveCount(5);
  // Drawn, not just placed: a broken image would show only its alt text, one line high.
  for (const img of await diagrams.all()) {
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect.poll(async () => (await img.boundingBox())?.height ?? 0).toBeGreaterThan(100);
  }
});

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

test("a gene's submitters are counted by significance, and can be searched", async ({ page }) => {
  await page.goto('/genes/3077');
  const table = page.getByRole('region', { name: /^Submitters/ });
  await expect(table.getByRole('columnheader', { name: 'P/LP' })).toBeVisible();
  // Most submissions first.
  await expect(table.getByRole('row').nth(1)).toContainText('Labcorp Genetics');
  await table.getByRole('searchbox').fill('genedx');
  await table.getByRole('searchbox').press('Enter');
  await expect(page).toHaveURL(/submitters_q=genedx/);
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('link', { name: 'GeneDx', exact: true })).toBeVisible();
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

test('the header search box follows the URL, and filters reset every list page', async ({
  page,
}) => {
  await page.goto('/');
  const box = page.getByRole('search', { name: 'ClinVar' }).first().getByRole('searchbox');
  await box.fill('HFE');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=HFE/);
  await page.getByRole('link', { name: 'ClinVar GKM browser' }).click();
  await expect(page.getByRole('searchbox').first()).toHaveValue('');

  await page.goto('/genes/3077/conflicts?variants_page=2&pairs_page=2');
  await page.getByRole('combobox', { name: 'Collection method' }).selectOption('curation');
  await expect(page).toHaveURL(/a\.method=curation/);
  expect(page.url()).not.toMatch(/_page=/);
});

test('the Overview tab stays current while paging', async ({ page }) => {
  await page.goto('/genes/3077?page=2');
  await expect(page.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a slow reload keeps the page, dimmed, with a loading indicator', async ({ page }) => {
  await page.goto('/genes/3077/conflicts');
  await expect(page.getByRole('heading', { name: 'Conflicts', level: 2 })).toBeVisible();
  // Hold the next scorecard request for a second.
  await page.route('**/api/v1/variants/summary**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.getByRole('combobox', { name: 'Conditions' }).selectOption('any');
  const status = page.locator('main ~ div[role=status], div[role=status].fixed');
  await expect(status).toHaveText('Loading…');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
  // The old content stays, and the new choice shows at once.
  await expect(page.getByRole('heading', { name: 'Conflicts', level: 2 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Conditions' })).toHaveValue('any');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(status).toHaveText('');
});

test('the statistics page draws every figure, each linking to its own page', async ({ page }) => {
  await page.goto('/stats');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Statistics');
  const charts = page.locator('section svg[role="img"]');
  // Six figures; the three trends drawn as lines have two charts each.
  await expect(charts).toHaveCount(9);
  const results = await axe(page).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page
    .getByRole('heading', { name: 'How variants’ classifications were reached' })
    .getByRole('link')
    .click();
  await expect(page).toHaveURL(/\/stats\/submitter-agreement$/);
  await expect(page.getByRole('table').first()).toContainText('Single submitter');
});

test("a figure's options are in its URL, and its CSV and citation follow them", async ({
  page,
}) => {
  await page.goto('/stats/clinsig-conflict-variants');
  await page.getByLabel('What counts as a conflict').selectOption('pairs');
  await expect(page).toHaveURL(/conflict=pairs/);
  await page.getByLabel('Conditions of the two submissions').selectOption('any');
  await expect(page).toHaveURL(/condition_match=any/);
  await expect(page.getByRole('link', { name: 'Download the counts as CSV' })).toHaveAttribute(
    'href',
    /conflict=pairs&condition_match=any&format=csv/,
  );
  await expect(page.getByText(/accessed \d{4}-\d{2}-\d{2}/)).toContainText(
    'conflict=pairs&condition_match=any',
  );
  // The chart reads out each point from the keyboard.
  await page.locator('svg[role="img"]').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('figure [role="status"]').first()).toContainText('2026-10-18');
});

test('a chart downloads as SVG and PNG under the content security policy', async ({ page }) => {
  const response = await page.goto('/stats/aggregate-classification');
  expect(response?.status()).toBe(200);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  for (const format of ['SVG', 'PNG']) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: format }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `clinvar-stats-aggregate-classification-2026-10-18.${format.toLowerCase()}`,
    );
    expect(await download.failure()).toBeNull();
  }
  expect(errors).toEqual([]);
});
