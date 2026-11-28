import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { Wallet } = require('ethers');
const Records = require('../vendor/decent-canopy/e9fceef0/scripts/creator-records.js');
const market = process.env.MARKET_URL || 'http://127.0.0.1:8792';
const canopy = process.env.CANOPY_URL;
if (!canopy) throw new Error('Set CANOPY_URL to the isolated receiving Canopy app');
const json = async path => { const response = await fetch(`${canopy}/${path}`); assert.ok(response.ok); return response.json(); };
const [accounts, assets] = await Promise.all([json('contributor-accounts.json'), json('payroll-assets.json')]);
const owner = accounts.contributors.find(c => c.role === 'owner').walletAddress;
const signer = Wallet.createRandom(), now = new Date().toISOString(), sha = 'a'.repeat(40);
const record = Records.validate({ format: 'decentcanopy-creator', version: 1, consent: true, wallet: signer.address,
  revision: 1, previousCid: null, updatedAt: now, name: 'Community Maker', bio: 'A published project', website: '',
  avatar: '', location: null, projects: [{ key: 'forest', name: 'Community Forest', description: 'A public project', website: '', image: '', status: 'active' }],
  funding: [], journey: [] });
const message = Records.message(record);
const index = { version: 1, updatedAt: now, creators: [{ record, message, signature: await signer.signMessage(message),
  cid: `baf${'a'.repeat(40)}`, publishedAt: now }] };
const bundle = readFileSync(new URL('../js/vendor/ethers.umd.min.js', import.meta.url));
const shots = process.env.SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [1280, 375, 320]) {
    const errors = [], page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([new URL(market).origin, new URL(canopy).origin].includes(url.origin)) return route.continue();
      if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/ethers')) return route.fulfill({ contentType: 'application/javascript', body: bundle });
      if (url.hostname === 'api.github.com' && url.pathname.endsWith('/commits/main')) return route.fulfill({ json: { sha } });
      if (url.hostname === 'raw.githubusercontent.com' && url.pathname.endsWith('/data/decent-creators.json')) return route.fulfill({ json: index });
      if (url.hostname === 'decentbusking.onrender.com' && url.pathname === '/api/promotions') {
        assert.equal(route.request().method(), 'GET');
        return route.fulfill({ json: { revision: 0, routerAddress: assets.routerAddress,
          features: { firstProject: null, supporterContracts: null }, campaigns: [], claims: [] } });
      }
      return route.abort();
    });
    await page.goto(`${market}/project-supporters.html?creator=${signer.address}&projectKey=forest&listingId=0`);
    await page.waitForFunction(() => document.querySelector('[data-sales-status]').textContent.includes('must be configured'));
    assert.equal(await page.locator('[data-sales-catalog]').textContent(), '');
    assert.equal(await page.locator('[data-sales-listing]').inputValue(), '0');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (shots) await page.screenshot({ path: `${shots}/market-sales-${width}.png`, fullPage: true });
    await page.goto(`${canopy}/?projectKey=forest&listingId=0&mintTxHash=0x${'a'.repeat(64)}`);
    await page.waitForFunction(() => document.querySelector('[name="campaignMonth"]').value !== '');
    await page.locator('.spiral-toolbar [data-first-project-open]').click();
    await page.waitForFunction(() => document.querySelector('#first-project-dialog [data-campaign-status]').textContent.includes('Campaign records loaded'));
    const dialog = page.locator('#first-project-dialog');
    assert.ok(await dialog.locator('button[value="join"]').isDisabled());
    assert.ok(await dialog.locator('button[value="claim"]').isDisabled());
    assert.equal(await dialog.locator('[name="listingId"]').inputValue(), '0');
    assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth));
    if (shots) await page.screenshot({ path: `${shots}/canopy-first-project-${width}.png`, fullPage: true });
    await dialog.locator('[data-campaign-close]').click();
    await page.evaluate(owner => {
      window.walletWrites = [];
      window.ethereum = { on() {}, removeListener() {}, request: async ({ method }) => {
        if (method === 'eth_accounts') return [owner];
        if (method === 'eth_chainId') return '0x2105';
        window.walletWrites.push(method); throw new Error(`Unexpected wallet write ${method}`);
      } };
      const state = { address: owner, chainId: 8453 };
      window.decentCanopyWallet = state;
      window.dispatchEvent(new CustomEvent('decentcanopy:wallet-change', { detail: state }));
    }, owner);
    await page.locator('#payroll-open-button').click();
    const admin = page.locator('#first-project-admin');
    await admin.locator('[data-first-project-draft]').click();
    assert.ok(await admin.locator('[data-campaign-editor]').isVisible());
    await admin.locator('[data-campaign-funding]').click();
    assert.equal(await page.locator('#admin-fund-slug').inputValue(), 'decentcanopy-promotionals');
    assert.equal(await page.locator('#admin-deposit-amount').inputValue(), '60.00');
    await admin.locator('[name="campaignMonth"]').fill('');
    await admin.locator('[name="campaignMonth"]').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('#first-project-admin [data-campaign-status]').textContent.includes('Choose a calendar month'));
    await admin.locator('[name="campaignMonth"]').fill('2028-02');
    await admin.locator('[name="campaignMonth"]').dispatchEvent('change');
    assert.equal(await admin.locator('[data-campaign-date]').count(), 29);
    const approval = admin.locator('[data-project-approval]');
    await approval.locator('[name="creatorWallet"]').fill(signer.address);
    await approval.locator('[name="projectKey"]').fill('forest');
    await approval.locator('[name="reviewed"]').check();
    await approval.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#first-project-admin [data-campaign-status]').textContent.includes('Configure the verified creator collection'));
    assert.ok(await approval.locator('button').isEnabled());
    assert.deepEqual(await page.evaluate(() => window.walletWrites), []);
    assert.ok(await admin.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    assert.deepEqual(errors, []);
    if (shots) await page.screenshot({ path: `${shots}/canopy-admin-${width}.png`, fullPage: true });
    await page.close();
  }
  console.log('Community Supporter receiving pages: desktop, 375px, 320px passed; unconfigured sales/rewards stay unavailable, drafts/funding prefill do not send, approval is wired without broadcasts.');
} finally { await browser.close(); }
