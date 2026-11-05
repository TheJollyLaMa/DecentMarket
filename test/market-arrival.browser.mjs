import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { ethers, BASE, NFT_ABI, ESCROW_ABI } from '../js/supporter-mint.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8793/';
const metadata = JSON.parse(readFileSync(new URL('../releases/decenthead-v2.0.0/supporter-metadata.json', import.meta.url)));
const image = readFileSync(new URL('../img/MetaMaskFox.png', import.meta.url));
const nft = new ethers.Interface(NFT_ABI);
const escrow = new ethers.Interface([...ESCROW_ABI, 'function nextListingId() view returns(uint256)']);
const erc20 = new ethers.Interface(['function decimals() view returns(uint8)', 'function symbol() view returns(string)']);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.walletRequests = [];
    window.ethereum = { on() {}, removeListener() {}, request: async r => { window.walletRequests.push(r.method); throw new Error('No wallet consent in discovery'); } };
  });
  await page.route('**/releases/listings.json', route => route.fulfill({ json: [] }));
  await page.route('https://gateway.pinata.cloud/**', route => {
    const url = route.request().url();
    const token = url.endsWith('/arrival79') ? '79' : url.endsWith('/arrival75') ? '75' : null;
    if (token) return route.fulfill({ json: { ...metadata, name: token === '79' ? 'DecentCanopy Supporter v0.1.0' : 'DecentBusking Supporter v1.2.0' } });
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  await page.route('https://mainnet.base.org/**', route => {
    const data = route.request().postDataJSON();
    const reply = call => {
      let result;
      if (call.method === 'eth_chainId') result = '0x2105';
      else if (call.method === 'eth_blockNumber') result = '0x100';
      else {
        assert.equal(call.method, 'eth_call');
        const tx = call.params[0], address = tx.to.toLowerCase();
        const iface = address === BASE.DNFT.toLowerCase() ? nft : address === BASE.USDC.toLowerCase() ? erc20 : escrow;
        const parsed = iface.parseTransaction({ data: tx.data });
        const id = parsed.args.length ? parsed.args[0] : 0n;
        const values = {
          owner: [BASE.DNFT], paused: [false], nextListingId: [2],
          listings: [BASE.DNFT, id === 1n ? 79 : 75, 0, BASE.USDC, id === 1n ? 10000000 : 100000000, 1000, true, 'Supporter'],
          balanceOf: [1000], uri: [`ipfs://arrival${id}`], decimals: [6], symbol: ['USDC'],
        };
        assert.ok(values[parsed.name], parsed.name);
        result = iface.encodeFunctionResult(parsed.name, values[parsed.name]);
      }
      return { jsonrpc: '2.0', id: call.id, result };
    };
    return route.fulfill({ json: Array.isArray(data) ? data.map(reply) : reply(data) });
  });
  const url = new URL(base);
  url.search = `supporters=1&chainId=8453&nftContract=${BASE.DNFT}&tokenId=79`;
  await page.goto(url.href);
  await page.locator('#nft-detail-modal').waitFor();
  assert.match(await page.locator('#nft-detail-modal').innerText(), /DecentCanopy Supporter v0.1.0/);
  assert.match(await page.locator('#nft-detail-modal').innerText(), /10 USDC/);
  assert.equal(await page.locator('#market-catalog .market-catalog-items > button').count(), 2);
  assert.equal(await page.evaluate(() => document.querySelector('decent-canvas')._selectedEdition), '79');
  assert.deepEqual(await page.evaluate(() => window.walletRequests), []);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.locator('#nft-detail-modal').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    if (process.env.SCREENSHOT_DIR) {
      mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/market-arrival-${width}.png` });
    }
  }
  await page.locator('#nft-detail-close').click();
  assert.equal(await page.locator('#market-catalog').isVisible(), true);
  assert.match(await page.locator('#market-catalog').innerText(), /DecentCanopy.*10 USDC/s);
  assert.match(await page.locator('#market-catalog').innerText(), /DecentBusking.*100 USDC/s);
  await page.getByRole('button', { name: 'Refresh listings', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#market-catalog .market-catalog-items > button').length === 2);
  await page.goto(url.href.replace('tokenId=79', 'tokenId=78'));
  await page.locator('#market-catalog').waitFor();
  assert.match(await page.locator('#market-catalog').innerText(), /unavailable.*no replacement token selected/s);
  assert.equal(await page.locator('#nft-detail-modal').count(), 0);
  await page.goto(url.href + '&tokenId=78');
  await page.locator('#market-arrival-error').waitFor();
  assert.match(await page.locator('#market-arrival-error').innerText(), /Exactly one tokenId/);
  assert.deepEqual(await page.evaluate(() => window.walletRequests), []);
  assert.deepEqual(errors, []);
  console.log('PASS: exact Canopy 79 landing, star focus, both Supporter offerings, 10/100-USDC prices, 1440/390/320px, full catalog after closing selection, refresh, no wallet prompt/signing.');
} finally { await browser.close(); }
