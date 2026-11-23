import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8792';
const shots = process.env.SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });
const png = readFileSync(new URL('../img/MetaMaskFox.png', import.meta.url));
const browser = await chromium.launch();
const errors = [], offsite = [];
try {
  for (const { width, height, label } of [{ width: 1280, height: 900, label: 'desktop' }, { width: 375, height: 812, label: '375' }, { width: 320, height: 700, label: '320' }]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (url.hostname === 'gateway.pinata.cloud' || url.hostname === 'example.com') return route.fulfill({ contentType: 'image/png', body: png });
      offsite.push(url.href);
      return route.abort();
    });
    // A wallet that records any request; the studio must never call it.
    await page.addInitScript(() => {
      window.walletRequests = [];
      window.ethereum = { request: async args => { window.walletRequests.push(args); return []; }, on() {}, removeListener() {} };
    });
    await page.goto(`${base}/studio.html`);
    await page.waitForFunction(() => !document.querySelector('#existing-project option[value=""]')
      || document.querySelectorAll('#existing-project option').length > 1);
    assert.equal(await page.locator('#existing-project option:not([disabled])').count(), 3);
    assert.ok(await page.locator('#mint-disabled').isDisabled());
    assert.ok(await page.locator('#list-disabled').isDisabled());
    assert.match(await page.locator('#mint-waiting-note').textContent(), /#47[\s\S]*#84[\s\S]*never connects a wallet/);

    // Existing project prefill and provenance.
    await page.selectOption('#existing-project', 'release:decenthead-v2.0.0');
    await page.click('#start-draft');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'studio-form-heading');
    assert.equal(await page.inputValue('#f-name'), 'DecentHead v2.0.0 Supporter DNFT');
    assert.equal(await page.locator('[data-field="name"] .badge').textContent(), 'from source');
    assert.equal(await page.locator('[data-field="payoutAddress"] .badge').textContent(), 'unknown');
    assert.match(await page.locator('#terms-preview').textContent(), /not an investment, a share, a treasury claim/);
    await page.fill('#f-name', 'Studio Supporter');
    assert.equal(await page.locator('[data-field="name"] .badge').textContent(), 'edited');
    await page.waitForFunction(() => document.querySelector('#card-preview .studio-preview-title')?.textContent === 'Studio Supporter');
    assert.match(await page.locator('#listing-preview').textContent(), /Studio Supporter.*10 USDC · 1000 editions · Preview only/);
    await page.selectOption('#f-priceUSDC', '100');
    await page.waitForFunction(() => /100 USDC/.test(document.querySelector('#card-preview').textContent));
    assert.ok(await page.locator('#card-preview button:has-text("Buy one")').isDisabled());
    await page.locator('#card-preview button:has-text("View back")').click();
    if (shots && label !== '320') await page.screenshot({ path: `${shots}/studio-${label}-existing.png`, fullPage: true });

    // Validation blocks save and focuses the first invalid field.
    await page.fill('#f-payoutAddress', '0x123');
    await page.click('#save-draft');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'f-payoutAddress');
    assert.equal(await page.getAttribute('#f-payoutAddress', 'aria-invalid'), 'true');
    assert.equal(await page.locator('#status').getAttribute('data-error'), 'true');
    await page.fill('#f-payoutAddress', '');

    // Save, edit, reopen, delete.
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'save-draft');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /saved in this browser/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#draft-list li button:has-text("Open")').count(), 1);
    await page.fill('#f-name', 'Unsaved change');
    await page.click('#discard-draft');
    assert.ok(await page.locator('#studio-form').isHidden());
    await page.click('#draft-list button:has-text("Open")');
    assert.equal(await page.inputValue('#f-name'), 'Studio Supporter');
    assert.equal(await page.inputValue('#f-priceUSDC'), '100');

    // New project: defaults and unknowns.
    await page.check('input[value="new"]');
    await page.click('#start-draft');
    assert.equal(await page.inputValue('#f-name'), '');
    assert.equal(await page.locator('[data-field="priceUSDC"] .badge').textContent(), 'default');
    assert.match(await page.locator('#dirty-state').textContent(), /Still unknown: Edition name, Description, Front artwork/);
    await page.fill('#f-name', 'Moonlit Album Supporter');
    await page.fill('#f-description', 'Helps finish the album.');
    await page.fill('#f-image', 'https://example.com/front.png');
    await page.fill('#f-externalUrl', 'https://example.com/canopy');
    await page.selectOption('#f-royaltyBps', '500');
    await page.click('#save-draft');
    await page.waitForFunction(() => document.querySelectorAll('#draft-list button[aria-label^="Open"]').length === 2);
    if (shots && label !== '320') await page.screenshot({ path: `${shots}/studio-${label}-new-saved.png`, fullPage: true });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${label} has ${overflow}px horizontal overflow`);

    await page.click('#draft-list button[aria-label="Delete draft Studio Supporter"]');
    await page.waitForFunction(() => /Deleted draft/.test(document.querySelector('#status').textContent));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'drafts-heading');
    assert.equal(await page.locator('#draft-list button[aria-label^="Open"]').count(), 1);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('decent-market:supporter-studio:drafts')));
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.drafts.map(d => d.fields.name), ['Moonlit Album Supporter']);

    // A corrupted store is reported and never overwritten.
    await page.evaluate(() => localStorage.setItem('decent-market:supporter-studio:drafts', '{broken'));
    await page.reload();
    await page.waitForFunction(() => /could not be read/.test(document.querySelector('#draft-list').textContent));
    assert.equal(await page.evaluate(() => localStorage.getItem('decent-market:supporter-studio:drafts')), '{broken');

    assert.deepEqual(await page.evaluate(() => window.walletRequests), [], 'wallet must never be requested');
    await page.close();
  }
  assert.deepEqual(offsite, [], 'no off-site requests beyond artwork');
  assert.deepEqual(errors, []);
  console.log('Supporter Studio drafts: desktop, 375px and 320px passed with no wallet or network side effects');
} finally { await browser.close(); }
