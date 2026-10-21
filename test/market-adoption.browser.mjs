import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ethers, BASE, NFT_ABI, ESCROW_ABI } from '../js/supporter-mint.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8793';
const metadata = JSON.parse(readFileSync(new URL('../releases/decenthead-v2.0.0/supporter-metadata.json', import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL('../releases/decenthead-v2.0.0/supporter-release.json', import.meta.url)));
const image = readFileSync(new URL('../img/MetaMaskFox.png', import.meta.url));
const nft = new ethers.Interface([...NFT_ABI,
  'function nextTokenId() view returns(uint256)', 'function kindOf(uint256) view returns(uint8)',
  'function maxSupply(uint256) view returns(uint256)', 'function totalMinted(uint256) view returns(uint256)',
]);
const escrow = new ethers.Interface(ESCROW_ABI);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(`${error.message} ${error.stack}`));
  page.on('request', request => requests.push(request.url()));
  await page.route('https://gateway.pinata.cloud/**', route => {
    if (route.request().url().endsWith(manifest.metadataURI.slice(7))) return route.fulfill({ json: metadata });
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  await page.route('https://ethereum-rpc.publicnode.com/**', route => {
    const call = route.request().postDataJSON();
    const reply = c => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_chainId' ? '0x1' : '0x' + '0'.repeat(64) });
    return route.fulfill({ json: Array.isArray(call) ? call.map(reply) : reply(call) });
  });
  await page.route('https://mainnet.base.org/**', route => {
    const data = route.request().postDataJSON();
    function reply(call) {
      let result;
      if (call.method === 'eth_chainId') result = '0x2105';
      else if (call.method === 'eth_blockNumber') result = '0x100';
      else if (call.method === 'eth_call') {
        const tx = call.params[0];
        const iface = tx.to.toLowerCase() === BASE.DNFT.toLowerCase() ? nft : escrow;
        const parsed = iface.parseTransaction({ data: tx.data });
        const values = { uri: [manifest.metadataURI], balanceOf: [1000], royaltyInfo: [manifest.creatorAddress, 1000],
          paused: [false], listings: [BASE.DNFT, 70, 0, BASE.USDC, 10000000, 1000, true, 'Supporter'],
          nextTokenId: [71], kindOf: [parsed.name === 'kindOf' && parsed.args[0] === 70n ? 0 : 1], maxSupply: [1000], totalMinted: [1000] };
        if (!values[parsed.name]) throw new Error(`Unexpected public read ${parsed.name}`);
        result = iface.encodeFunctionResult(parsed.name, values[parsed.name]);
      } else throw new Error(`Unexpected RPC ${call.method}`);
      return { jsonrpc: '2.0', id: call.id, result };
    }
    return route.fulfill({ json: Array.isArray(data) ? data.map(reply) : reply(data) });
  });
  await page.addInitScript(() => {
    window.walletCalls = [];
    const make = name => ({
      on() {}, removeListener() {},
      async request({ method }) {
        window.walletCalls.push({ name, method });
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return ['0x807061DF657A7697c04045dA7d16D941861cAABc'];
        if (method === 'eth_chainId') return '0x2105';
        throw new Error(`Unexpected wallet request ${method}`);
      },
    });
    const wallets = ['A', 'B'].map((name, i) => ({ info: { name: `Test wallet ${name}`, uuid: `${i + 1}`, icon: 'data:image/png;base64,', rdns: `test.${name}` }, provider: make(name) }));
    window.ethereum = make('wrong-global');
    window.addEventListener('eip6963:requestProvider', () => wallets.forEach(detail => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))));
  });
  await page.goto(base);
  await page.getByRole('link', { name: 'Review / buy edition' }).waitFor();
  assert.match(await page.locator('#supporter-listing-cards').textContent(), /10 USDC.*1000 available.*Token 70 \/ Listing 0/);
  assert.deepEqual(await page.evaluate(() => window.walletCalls), []);
  assert.equal(requests.some(url => /w3s\.link|web3\.storage/.test(url)), false);
  await page.waitForFunction(() => document.querySelector('decent-canvas')._productSprites['70']?.sprite?.userData?.twoSided);
  const mesh = await page.evaluate(() => {
    const c = document.querySelector('decent-canvas'), sprite = c._productSprites['70'].sprite;
    return { mesh: sprite.isMesh, front: !!sprite.material[4].map, back: !!sprite.material[5].map,
      belowHeader: c.getBoundingClientRect().top >= document.querySelector('decent-header').getBoundingClientRect().bottom,
      rendererHeight: c.renderer.domElement.clientHeight, hostHeight: c.clientHeight };
  });
  assert.deepEqual(mesh, { mesh: true, front: true, back: true, belowHeader: true, rendererHeight: mesh.hostHeight, hostHeight: mesh.hostHeight });
  await page.evaluate(() => document.querySelector('decent-canvas')._productSprites['70'].sprite.onClick());
  await page.getByRole('link', { name: 'Review / buy this edition · 10 USDC on Base', exact: true }).waitFor();
  assert.match(await page.getByRole('link', { name: 'Review / buy this edition · 10 USDC on Base', exact: true }).getAttribute('href'), /listingId=0/);
  await page.locator('#nft-detail-close').click();
  await page.getByRole('button', { name: 'View back', exact: true }).click();
  await page.getByRole('img', { name: `${metadata.name} back`, exact: true }).waitFor();
  await page.locator('wallet-connect select').selectOption('1');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.walletCalls.every(call => call.name === 'B')), true);
  assert.equal(await page.evaluate(async () => (await import('./js/market-wallet.mjs')).marketEthereum().selectedAddress), manifest.creatorAddress);
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  assert.deepEqual(await page.evaluate(async () => (await import('./js/market-wallet.mjs')).marketEthereum().request({ method: 'eth_accounts' })), []);
  assert.equal(await page.evaluate(() => window.walletCalls.some(call => /send|sign/i.test(call.method))), false);
  await page.getByRole('button', { name: '🗿', exact: true }).click();
  await page.locator('#gallery-card-70').waitFor();
  assert.match(await page.locator('#gallery-card-70').textContent(), /DecentHead v2.0.0/);
  await page.locator('#gallery-close').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => document.querySelector('decent-canvas')._collectibleMotion.matches), true);
  await page.getByRole('button', { name: 'DecentMarket', exact: true }).click();
  await page.getByRole('dialog', { name: 'About DecentMarket', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'About DecentMarket', exact: true }).isVisible(), true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open IPFS controls', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  await page.keyboard.press('Escape');
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH });
  assert.deepEqual(errors, []);
  console.log('PASS: migrated Market; public listing zero, verified terms, 3D front/back, gallery discovery, selected EIP6963 wallet B, disconnect, no auto prompts/uploads/signatures, responsive canvas and reduced motion.');
} finally { await browser.close(); }
