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
  let musicRequest, uploads = 0;
  await page.route('https://api.pinata.cloud/pinning/pinFileToIPFS', route => {
    uploads++;
    assert.equal(route.request().headers().authorization, 'Bearer synthetic-test-only');
    return route.fulfill({ json: { IpfsHash: manifest.front.slice(7) } });
  });
  await page.route('https://decentbusking.onrender.com/api/media/submit', route => {
    musicRequest = route.request().postDataJSON();
    return route.fulfill({ json: { trackId: 'synthetic-music-1', status: 'pending' } });
  });
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
        if (method === 'personal_sign') return '0x' + '1'.repeat(130);
        throw new Error(`Unexpected wallet request ${method}`);
      },
    });
    const wallets = ['A', 'B'].map((name, i) => ({ info: { name: `Test wallet ${name}`, uuid: `${i + 1}`, icon: 'data:image/png;base64,', rdns: `test.${name}` }, provider: make(name) }));
    window.ethereum = make('wrong-global');
    window.addEventListener('eip6963:requestProvider', () => wallets.forEach(detail => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))));
  });
  await page.goto(base);
  assert.equal(await page.locator('#supporter-listings').count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Open MetaMask', exact: true }).isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.walletCalls), []);
  assert.equal(requests.some(url => /w3s\.link|web3\.storage/.test(url)), false);
  await page.waitForFunction(() => document.querySelector('decent-canvas')._productSprites?.['70']?.sprite?.userData?.twoSided);
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
  await page.getByRole('button', { name: 'Filter DNFTs in space', exact: true }).click();
  await page.locator('#modal-space-filters select').selectOption('music');
  await page.waitForFunction(() => Object.keys(document.querySelector('decent-canvas')._productSprites).length === 0);
  await page.locator('#modal-space-filters select').selectOption('supporter');
  await page.waitForFunction(() => document.querySelector('decent-canvas')._productSprites['70']?.sprite?.userData?.twoSided);
  await page.locator('#modal-space-filters input[type=search]').fill('not-present');
  await page.waitForFunction(() => Object.keys(document.querySelector('decent-canvas')._productSprites).length === 0);
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.getByRole('button', { name: 'Close filters', exact: true }).click();
  await page.getByRole('button', { name: '📜', exact: true }).click();
  const mintPanel = page.getByRole('dialog', { name: 'Mint New DNFT', exact: true });
  await mintPanel.locator('[data-lane=supporter] > summary').click();
  await mintPanel.getByRole('button', { name: 'Load DecentHead v2.0.0', exact: true }).click();
  await mintPanel.locator('#release-summary').filter({ hasText: manifest.creatorAddress }).waitFor();
  assert.equal(await mintPanel.locator('.supporter-studio-embed iframe').count(), 0);
  await mintPanel.locator('[data-lane=music] > summary').click();
  await mintPanel.getByRole('button', { name: 'Submit music for owner approval', exact: true }).click();
  assert.match(await mintPanel.locator('[data-music-status]').textContent(), /consent first/);
  await page.keyboard.press('Escape');
  await page.locator('wallet-connect select').selectOption('1');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.walletCalls.every(call => call.name === 'B')), true);
  assert.equal(await page.evaluate(async () => (await import('./js/market-wallet.mjs')).marketEthereum().selectedAddress), manifest.creatorAddress);
  await page.getByRole('button', { name: '📜', exact: true }).click();
  await page.locator('[data-lane=music] > summary').click();
  const music = page.locator('.music-submission');
  await music.locator('[name=title]').fill('Synthetic song');
  await music.locator('[name=artist]').fill('Synthetic artist');
  await music.locator('[name=recipient]').fill(manifest.creatorAddress);
  await music.locator('[name=mediaFile]').setInputFiles({ name: 'synthetic.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFFxxxxWAVEtest') });
  await music.locator('[name=consent]').check();
  await page.evaluate(() => window.DecentHead.getIpfs().configure({ provider: 'pinata', jwt: 'synthetic-test-only' }));
  await music.getByRole('button', { name: 'Submit music for owner approval', exact: true }).click();
  await music.locator('[data-music-status]').filter({ hasText: 'synthetic-music-1' }).waitFor();
  assert.equal(uploads, 1);
  assert.equal(musicRequest.mediaType, 'audio/wav');
  assert.equal(musicRequest.origin, new URL(base).origin);
  assert.deepEqual(musicRequest.creatorSplits, [{ wallet: manifest.creatorAddress, shareBps: 10000 }]);
  assert.equal(await music.getByRole('button', { name: 'Submitted · awaiting owner review', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  assert.deepEqual(await page.evaluate(async () => (await import('./js/market-wallet.mjs')).marketEthereum().request({ method: 'eth_accounts' })), []);
  assert.equal(await page.evaluate(() => window.walletCalls.some(call => /send/i.test(call.method))), false);
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
  console.log('PASS: Market mint lanes, embedded Studio, Music consent, left space category/search/reset filters, no release shelf or wallet deep-link, verified 3D purchase, provider B, disconnect, mobile dialogs and reduced motion.');
} finally { await browser.close(); }
