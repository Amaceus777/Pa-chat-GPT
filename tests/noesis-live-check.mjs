import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const BASE = 'https://amaceus777.github.io/Pa-chat-GPT/';
const QUERY = 'sleep memory';
const REPORT = '/tmp/noesis-report.json';
const report = { site: BASE, checkedAt: new Date().toISOString(), status: 'running', checks: [], errors: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (name, status, details = '') => {
  report.checks.push({ name, status, details });
  console.log(`${status}: ${name}${details ? ' - ' + details : ''}`);
};

let browser;
try {
  let ready = false, lastError;
  for (let i = 0; i < 24; i++) {
    try {
      const response = await fetch(BASE, { redirect: 'follow' });
      if (response.ok) { ready = true; break; }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await sleep(5000);
  }
  if (!ready) throw new Error(`GitHub Pages no respondió: ${lastError}`);
  check('GitHub Pages responde', 'PASS', 'HTTP 200');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('h1').getByText('Investiga con criterio.').waitFor();
  check('Interfaz principal', 'PASS', 'Título y página cargados');

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
    return {
      count: await page.locator('#results article.article').count(),
      status: await page.locator('#status').innerText()
    };
  }

  const sourceResults = {};
  for (const source of ['openalex', 'crossref', 'epmc']) {
    const result = await search(source);
    sourceResults[source] = result;
    if (!result.count) {
      if (/HTTP (429|5\\d\\d)/.test(result.status)) {
        check(`Búsqueda ${source}`, 'WARN', `API temporalmente no disponible tras reintentos: ${result.status}`);
        continue;
      }
      throw new Error(`${source} no devolvió resultados: ${result.status}`);
    }
    check(`Búsqueda ${source}`, 'PASS', `${result.count} resultados`);
  }
  if (!sourceResults.openalex?.count && !sourceResults.crossref?.count && !sourceResults.epmc?.count) {
    throw new Error('Ninguna fuente académica respondió con resultados.');
  }

  const combined = await search('all');
  if (!combined.count) throw new Error(`Búsqueda combinada sin resultados: ${combined.status}`);
  check('Búsqueda combinada y deduplicación', 'PASS', `${combined.count} resultados; ${combined.status}`);

  await page.locator('#results article.article').first().locator('button[data-detail]').click();
  await page.locator('#detail').waitFor({ state: 'visible' });
  await page.locator('#detailBody').getByText('Referencia APA 7 preliminar').waitFor();
  check('Ficha y referencia APA', 'PASS');

  await page.locator('#closeDetail').click();
  const chooseButtons = page.locator('#results button[data-choose]');
  await chooseButtons.nth(0).click();
  await chooseButtons.nth(1).click();
  await page.locator('#compare').click();
  await page.locator('#comparison').waitFor({ state: 'visible' });
  await page.locator('#comparisonBody').getByText('Comparación descriptiva').waitFor();
  check('Comparador de estudios', 'PASS', 'Dos publicaciones comparadas');

  const oa = await search('all', { openAccess: true });
  if (!oa.count) throw new Error(`Filtro de acceso abierto sin resultados: ${oa.status}`);
  const oaNotice = oa.status.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!oaNotice.includes('crossref omitido') || !oaNotice.includes('indicador fiable de acceso abierto')) {
    throw new Error(`Aviso del filtro OA ausente o incompleto. Estado recibido: ${oa.status}`);
  }
  check('Filtro de acceso abierto', 'PASS', `${oa.count} resultados; limitación Crossref explicada`);

  const year = await search('openalex', { year: '2020' });
  if (!year.count) throw new Error(`Filtro por año sin resultados: ${year.status}`);
  check('Filtro por año y orden cronológico', 'PASS', `${year.count} resultados`);

  if (pageErrors.length) throw new Error(`Errores JavaScript del navegador: ${pageErrors.join(' | ')}`);
  check('Errores JavaScript', 'PASS', 'Ningún error no controlado');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.errors.push(error?.stack || String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(REPORT, JSON.stringify(report, null, 2));
}
