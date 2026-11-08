import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../', import.meta.url);
const base = 'https://market-loading.test/';
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname.includes('/js/vendor/')) return route.fulfill({ body: '', contentType: 'text/javascript' });
      if (url.pathname === '/js/main.js') return route.abort();
      const relative = url.pathname.slice(1) || 'index.html';
      const contentType = relative.endsWith('.css') ? 'text/css' : relative.endsWith('.js') ? 'text/javascript' : 'text/html';
      return route.fulfill({ body: await readFile(new URL(relative, root)), contentType });
    });
    await page.goto(`${base}?supporters=1`);
    const loading = page.locator('#market-arrival-loading');
    await loading.waitFor();
    await loading.getByText('A marketplace script could not load. Check your connection and retry.').waitFor();
    assert.equal(await loading.getAttribute('aria-busy'), 'false');
    assert.equal(await loading.getByRole('button', { name: 'Try again' }).isVisible(), true);
    assert.ok(await loading.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth));
    await loading.getByRole('button', { name: 'Close loading panel' }).click();
    assert.equal(await loading.isVisible(), false);
    await page.reload();
    await loading.waitFor();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('market:arrival-loading', { detail: { ready: true } })));
    await loading.getByRole('button', { name: 'Try again' }).click();
    await page.clock.runFor(12001);
    await loading.getByText(/taking longer than usual/).waitFor();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('market:arrival-loading', {
      detail: { text: 'Checking Base listings · 2 of 10', checked: 2, total: 10 }
    })));
    assert.equal(await loading.locator('progress').getAttribute('value'), '2');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('market:arrival-loading', { detail: { error: 'Base RPC unavailable' } })));
    await loading.getByText('Base RPC unavailable', { exact: true }).waitFor();
    await loading.getByRole('button', { name: 'Try again' }).click();
    assert.equal(await loading.getAttribute('aria-busy'), 'true');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('market:arrival-loading', { detail: { done: true } })));
    assert.equal(await loading.count(), 0);
    await page.goto(base);
    assert.equal(await loading.count(), 0, 'ordinary browsing has no arrival overlay');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: immediate mobile/desktop loading, script/RPC failures, slow-network notice, progress, retry, dismissal and normal browsing.');
} finally { await browser.close(); }
