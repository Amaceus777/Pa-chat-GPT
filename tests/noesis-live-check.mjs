import { chromium } from 'playwright';

const BASE = 'https://amaceus777.github.io/Pa-chat-GPT/';
const QUERY = 'sleep memory';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForSite() {
  let lastError;
  for (let i = 0; i < 24; i++) {
    try {
      const response = await fetch(BASE, { redirect: 'follow' });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await sleep(5000);
  }
  throw new Error(`GitHub Pages did not become available: ${lastError}`);
}

await waitForSite();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('h1').getByText('Investiga con criterio.').waitFor();
  console.log('PASS: página publicada y título visible');

  async function search(source, { openAccess = false, year = '' } = {}) {
    await page.locator('#q').fill(QUERY);
    await page.locator('#source').selectOption(source);
    await page.locator('#oa').setChecked(openAccess);
    await page.locator('#year').fill(year);
    await page.locator('#sort').selectOption('date');
    await page.locator('#go').click();
    await page.waitForFunction(() => {
      const button = document.querySelector('#go');
      return button && !button.disabled && !document.querySelector('#status')?.textContent.includes('Consultando');
    }, null, { timeout: 90000 });
    const status = await page.locator('#status').innerText();
    const count = await page.locator('#results article.article').count();
    console.log(`${count ? 'PASS' : 'WARN'}: ${source}, OA=${openAccess}, year=${year || 'all'} -> ${count} results; ${status}`);
    return { count, status };
  }

  for (const source of ['openalex', 'crossref', 'epmc']) {
    const result = await search(source);
    if (!result.count) throw new Error(`No results from ${source}: ${result.status}`);
  }

  const combined = await search('all');
  if (!combined.count) throw new Error(`Combined search returned no results: ${combined.status}`);

  const first = page.locator('#results article.article').first();
  await first.locator('button[data-detail]').click();
  await page.locator('#detail').waitFor({ state: 'visible' });
  await page.locator('#detailBody').getByText('Referencia APA 7 preliminar').waitFor();
  console.log('PASS: ficha de estudio y referencia APA');

  await page.locator('#closeDetail').click();
  const chooseButtons = page.locator('#results button[data-choose]');
  await chooseButtons.nth(0).click();
  await chooseButtons.nth(1).click();
  await page.locator('#compare').click();
  await page.locator('#comparison').waitFor({ state: 'visible' });
  await page.locator('#comparisonBody').getByText('Comparación descriptiva').waitFor();
  console.log('PASS: comparación de publicaciones');

  const oa = await search('openalex', { openAccess: true });
  if (!oa.count) throw new Error(`OpenAlex OA filter failed: ${oa.status}`);

  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(' | ')}`);
  console.log('PASS: no uncaught browser JavaScript errors');
} finally {
  await browser.close();
}
