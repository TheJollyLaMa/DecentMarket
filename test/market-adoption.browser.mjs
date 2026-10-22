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
const escrow = new ethers.Interface([...ESCROW_ABI, 'function nextListingId() view returns(uint256)',
  'function getETHBalance() view returns(uint256)', 'function getBalance(address) view returns(uint256)',
  'function getNFTBalance(address,uint256) view returns(uint256)', 'function nextPlanId() view returns(uint256)',
  'function getListing(uint256) view returns(tuple(address nftContract,uint256 tokenId,uint256 priceETH,address priceToken,uint256 priceAmount,uint256 available,bool active,string note))']);
const erc20 = new ethers.Interface(['function decimals() view returns(uint8)', 'function symbol() view returns(string)']);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  let musicRequest, uploads = 0, collectionScans = 0;
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
    const unlisted = route.request().url().match(/\/marketToken(\d+)$/);
    if (unlisted) return route.fulfill({ json: { ...metadata, name: `Unlisted edition ${unlisted[1]}` } });
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
        const iface = tx.to.toLowerCase() === BASE.DNFT.toLowerCase() ? nft : tx.to.toLowerCase() === BASE.USDC.toLowerCase() ? erc20 : escrow;
        const parsed = iface.parseTransaction({ data: tx.data });
        if (parsed.name === 'nextTokenId') collectionScans++;
        const values = { uri: [parsed.name === 'uri' && parsed.args[0] < 70n ? `ipfs://marketToken${parsed.args[0]}` : manifest.metadataURI],
          balanceOf: [1000], royaltyInfo: [manifest.creatorAddress, 1000],
          paused: [false], listings: [BASE.DNFT, 70, 0, BASE.USDC, 10000000, 1000, true, 'Supporter'],
          owner: [manifest.creatorAddress], getETHBalance: [0], getBalance: [0], getNFTBalance: [1000], nextPlanId: [0],
          getListing: [[BASE.DNFT, 70, 0, BASE.USDC, 10000000, 1000, true, 'Supporter']],
          nextListingId: [1], decimals: [6], symbol: ['USDC'],
          nextTokenId: [71], kindOf: [parsed.name === 'kindOf' && parsed.args[0] >= 68n ? 0 : 1],
          maxSupply: [1000], totalMinted: [parsed.name === 'totalMinted' && parsed.args[0] === 68n ? 0 : 1000] };
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
  await page.waitForFunction(() => document.querySelector('decent-right-toolbar')._listedProducts?.[0]?.listings?.[0]?.purchasable);
  assert.equal(collectionScans, 0, 'Entry loads prepared releases, not the entire collection');
  assert.equal(requests.some(url => url.includes('mandelblum.webm')), false, 'No Mandelblum video is loaded');
  assert.equal(await page.evaluate(() => document.querySelector('decent-canvas')._productSprites['70'].sprite.userData.star), true);
  await page.waitForFunction(() => {
    const artwork = document.querySelector('decent-canvas')._productSprites['70'].sprite.userData.artwork;
    return artwork?.front === 'ready' && artwork?.back === 'ready';
  });
  assert.deepEqual(await page.evaluate(() => {
    const geometry = document.querySelector('decent-canvas')._productSprites['70'].sprite.geometry;
    return [...new Set(geometry.groups.map(group => group.materialIndex))].sort();
  }), [0, 1, 2], 'Star mesh has rim, front and back material groups');
  assert.equal(await page.evaluate(() => {
    const geometry = document.querySelector('decent-canvas')._productSprites['70'].sprite.geometry;
    const { position, normal, uv } = geometry.attributes;
    for (let index = 0; index < position.count; index++) {
      if (Math.abs(normal.getZ(index)) < .9) continue;
      const sign = normal.getZ(index) > 0 ? 1 : -1;
      if (Math.abs(uv.getX(index) - (.5 + position.getX(index) / 11 * sign)) > .00001
        || Math.abs(uv.getY(index) - (.5 + position.getY(index) / 11)) > .00001) return false;
    }
    return true;
  }), true, 'Front and flipped back artwork are upright and not mirrored');
  const mesh = await page.evaluate(() => {
    const c = document.querySelector('decent-canvas'), sprite = c._productSprites['70'].sprite;
    return { mesh: sprite.isMesh, front: !!sprite.material[1].map, back: !!sprite.material[2].map,
      belowHeader: c.getBoundingClientRect().top >= document.querySelector('decent-header').getBoundingClientRect().bottom,
      rendererHeight: c.renderer.domElement.clientHeight, hostHeight: c.clientHeight };
  });
  assert.deepEqual(mesh, { mesh: true, front: true, back: true, belowHeader: true, rendererHeight: mesh.hostHeight, hostHeight: mesh.hostHeight });
  await page.evaluate(() => document.querySelector('decent-canvas')._productSprites['70'].sprite.onClick());
  await page.getByRole('button', { name: 'Buy one · 10 USDC', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Buy one · 10 USDC', exact: true }).isEnabled(), true);
  assert.match(await page.getByRole('link', { name: 'Purchases / transfers on Base ↗', exact: true }).getAttribute('href'), /a=70/);
  await page.getByRole('button', { name: 'View back', exact: true }).click();
  assert.match(await page.locator('#nft-detail-modal img').getAttribute('src'), new RegExp(manifest.back.slice(7)));
  await page.keyboard.press('Escape');
  const coinPoint = await page.evaluate(() => {
    const c = document.querySelector('decent-canvas'), r = c.renderer.domElement.getBoundingClientRect();
    const v = c._productSprites['70'].sprite.position.clone().project(c.camera);
    return { x: r.left + (v.x + 1) * r.width / 2, y: r.top + (1 - v.y) * r.height / 2 };
  });
  await page.mouse.move(coinPoint.x, coinPoint.y);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.querySelector('decent-canvas')._productSprites['70'].sprite.rotation.y), 0, 'Hover does not flip or resize a coin');
  const flipCoin = page.getByRole('button', { name: `Flip ${metadata.name} coin`, exact: true });
  await flipCoin.click();
  await page.waitForFunction(() => document.querySelector('decent-canvas')._productSprites['70'].sprite.rotation.y > 2.8);
  await page.mouse.move(10, 10);
  await page.waitForTimeout(100);
  assert.equal(await flipCoin.getAttribute('aria-pressed'), 'true', 'Coin stays flipped when the pointer leaves');
  await flipCoin.click();
  await page.waitForFunction(() => document.querySelector('decent-canvas')._productSprites['70'].sprite.rotation.y < .05);
  await page.mouse.click(coinPoint.x, coinPoint.y);
  await page.getByRole('dialog', { name: metadata.name, exact: true }).waitFor();
  await page.locator('#nft-detail-close').click();
  await page.mouse.move(10, 10);
  assert.equal(await page.locator('.market-live-status').count(), 0);
  await page.getByRole('button', { name: 'Filter DNFTs in space', exact: true }).click();
  await page.locator('[data-listings]').filter({ hasText: '1 Base listing(s) · prices and stock checked' }).waitFor();
  assert.equal(await page.locator('[name="availability"]').inputValue(), 'sale');
  assert.equal(collectionScans, 0, 'Opening sale filters does not scan the entire collection');
  await page.getByRole('button', { name: 'Browse / purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Public treasury / subscriptions', exact: true }).click();
  await page.locator('#escrow-plans').filter({ hasText: 'No subscription plans yet' }).waitFor();
  assert.equal(await page.locator('#escrow-owner-section').isVisible(), false);
  assert.equal(await page.locator('#escrow-fn-explorer').locator(':scope > *').count(), 0);
  assert.equal(await page.evaluate(() => !!document.querySelector('decent-canvas')._productSprites['70']), true);
  assert.equal(collectionScans, 0, 'Public treasury does not start the old full inventory scan');
  await page.locator('#escrow-close').click();
  await page.getByRole('button', { name: 'Filter DNFTs in space', exact: true }).click();
  await page.locator('#modal-space-filters [name="availability"]').selectOption('minted');
  await page.waitForFunction(() => !document.querySelector('decent-right-toolbar')._spaceLoading);
  assert.equal(collectionScans, 1, 'Choosing all minted explicitly loads collection');
  await page.waitForFunction(() => document.querySelector('decent-canvas')._productSprites['69']);
  assert.equal(await page.evaluate(() => !!document.querySelector('decent-canvas')._productSprites['68']), false, 'Registered but unminted editions stay out of space');
  await page.getByRole('button', { name: 'Close filters', exact: true }).click();
  assert.equal(await page.locator('decent-foot .market-flight').count(), 1, 'Flight controls are part of the existing footer');
  const footerBounds = await page.locator('.market-footer-console').boundingBox();
  assert.equal(footerBounds.width, 578, 'Preserve original desktop footer width');
  assert.equal(footerBounds.height, 104, 'No extra rows around original footer dials');
  assert.equal(await page.getByRole('slider', { name: 'Star river speed', exact: true }).count(), 0);
  const starDepth = await page.evaluate(() => document.querySelector('decent-canvas').starSprites[0].userData.starPosition.z);
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(depth => document.querySelector('decent-canvas').starSprites[0].userData.starPosition.z > depth, starDepth));
  const starBefore = await page.evaluate(() => document.querySelector('decent-canvas').starSprites.filter(s => s.userData.isBackground).length);
  await page.getByRole('button', { name: '🐄', exact: true }).click();
  assert.equal(await page.evaluate(() => document.querySelector('decent-canvas').starSprites.filter(s => s.userData.isBackground).length), starBefore);
  assert.equal(await page.evaluate(() => {
    const c = document.querySelector('decent-canvas');
    return c.starSprites.filter(s => s.userData.isBackground).every(s => {
      const local = s.position.clone().sub(c.camera.position).applyQuaternion(c.camera.quaternion.clone().invert());
      return local.distanceTo(s.userData.starPosition) < .0001;
    });
  }), true, 'Starfield faces the viewer independently of the DNFT spiral');
  assert.equal(await page.locator('.market-flight details').count(), 0, 'No dropdown flight controls');
  assert.equal(await page.getByRole('link', { name: 'DecentAgency Discord', exact: true }).getAttribute('href'), 'https://discord.gg/DvYjKwVgsF');
  await page.getByRole('button', { name: 'Older edition', exact: true }).click();
  await page.waitForFunction(() => {
    const c = document.querySelector('decent-canvas'), e = c._productSprites['69'];
    return c._selectedEdition === '69' && c.controls.target.distanceTo(e.sprite.position) < .06;
  });
  const flight = await page.evaluate(() => {
    const c = document.querySelector('decent-canvas'), a = c._productSprites['70'], b = c._productSprites['69'];
    return { spiral: a.x !== b.x && a.y !== b.y && a.z - b.z === 12,
      distance: c.camera.position.distanceTo(c.controls.target) };
  });
  assert.equal(flight.spiral, true);
  await page.getByRole('button', { name: 'Back up', exact: true }).click();
  assert.ok(await page.evaluate(() => {
    const c = document.querySelector('decent-canvas'); return c.camera.position.distanceTo(c.controls.target);
  }) > flight.distance);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const beforeWheel = await page.evaluate(() => {
    const c = document.querySelector('decent-canvas'); return c.camera.position.distanceTo(c.controls.target);
  });
  await page.mouse.move(1000, 450);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(distance => {
    const c = document.querySelector('decent-canvas'); return c.camera.position.distanceTo(c.controls.target) > distance;
  }, beforeWheel);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.getByRole('dialog', { name: 'Unlisted edition 69', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('slider', { name: 'Edition timeline', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('decent-canvas')._selectedEdition === '70');
  await page.getByRole('button', { name: 'Spiral overview', exact: true }).click();
  assert.ok(await page.locator('.market-coin-flip:visible').count() <= 2);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.getByRole('button', { name: 'Filter DNFTs in space', exact: true }).click();
  await page.locator('#modal-space-filters [name="availability"]').selectOption('sale');
  await page.waitForFunction(() => Object.keys(document.querySelector('decent-canvas')._productSprites).join() === '70');
  await page.locator('#modal-space-filters [name="category"]').selectOption('music');
  await page.waitForFunction(() => Object.keys(document.querySelector('decent-canvas')._productSprites).length === 0);
  await page.locator('#modal-space-filters [name="category"]').selectOption('supporter');
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
  await page.evaluate(() => { window.DecentHead.getWallet().lookupName = async () => null; });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('decent-header').shadowRoot.querySelector('wallet-connect').shadowRoot.querySelector('#status').hidden);
  await page.evaluate(async () => {
    const wallet = window.DecentHead.getWallet();
    wallet.lookupName = async () => 'thejollylama.eth';
    await wallet.resolveIdentity();
  });
  assert.equal(await page.locator('wallet-connect #status').isVisible(), false, 'Hide the horizontal ENS / Base label, not the orbit');
  assert.match(await page.locator('wallet-connect textPath').textContent(), /thejollylama.eth/);
  await page.evaluate(() => {
    document.querySelector('decent-header').shadowRoot.querySelector('wallet-connect').shadowRoot.querySelector('#status').textContent = 'Wallet connection rejected';
  });
  await page.locator('wallet-connect #status').filter({ hasText: 'Wallet connection rejected' }).waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    const wallet = window.DecentHead.getWallet(); wallet.lookupName = async () => null;
    await wallet.resolveIdentity();
  });
  assert.equal(await page.evaluate(() => window.walletCalls.every(call => call.name === 'B')), true);
  assert.equal(await page.evaluate(async () => (await import('./js/market-wallet.mjs')).marketEthereum().selectedAddress), manifest.creatorAddress);
  await page.getByRole('button', { name: 'Profile menu', exact: true }).click();
  await page.getByRole('button', { name: 'My Profile', exact: true }).click();
  await page.getByRole('link', { name: 'Begin your ENS adventure ↗', exact: true }).waitFor();
  assert.equal(await page.locator('#market-profile').getByRole('listitem').count(), 3);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Admin menu', exact: true }).click();
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  await page.locator('#market-admin').getByLabel(`Hide ${metadata.name}`, { exact: true }).check();
  await page.waitForFunction(() => !document.querySelector('decent-canvas')._productSprites['70']);
  await page.locator('#market-admin').getByRole('button', { name: 'Reset local preview', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('decent-canvas')._productSprites['70']);
  await page.keyboard.press('Escape');
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
  await page.locator('#gallery-card-70').getByRole('button', { name: 'Explore / purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Buy one · 10 USDC', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#gallery-close').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pausedDepth = await page.evaluate(() => document.querySelector('decent-canvas').starSprites[0].userData.starPosition.z);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.querySelector('decent-canvas').starSprites[0].userData.starPosition.z), pausedDepth, 'Reduced motion stops automatic star travel');
  await page.getByRole('button', { name: `Flip ${metadata.name} coin`, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('decent-canvas')._productSprites['70'].sprite.rotation.y === Math.PI);
  await page.getByRole('button', { name: `Flip ${metadata.name} coin`, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('decent-canvas')._productSprites['70'].sprite.rotation.y === 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => document.querySelector('decent-canvas')._collectibleMotion.matches), true);
  await page.getByRole('button', { name: 'Decent Market', exact: true }).click();
  await page.getByRole('dialog', { name: 'About DecentMarket', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'About DecentMarket', exact: true }).isVisible(), true);
  await page.keyboard.press('Escape');
  for (const width of [320, 390, 600, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const root = document.querySelector('decent-header').shadowRoot;
      const title = root.querySelector('app-title').shadowRoot;
      const name = title.querySelector('.name');
      const style = getComputedStyle(name), box = name.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(name);
      return { overflow: document.documentElement.scrollWidth > innerWidth, text: name.textContent,
        wrap: style.overflowWrap, wordBreak: style.wordBreak,
        titleFits: range.getBoundingClientRect().width <= box.width + 1,
        subtitle: title.querySelector('p').textContent,
        hiddenIPFS: getComputedStyle(root.querySelector('ipfs-status').shadowRoot.querySelector('#label')).display === 'none' };
    });
    assert.deepEqual(layout, { overflow: false, text: 'Decent Market', wrap: 'normal', wordBreak: 'normal', titleFits: true,
      subtitle: '(Another Decent Frankenstein)', hiddenIPFS: true }, `Header at ${width}px`);
  }
  await page.getByRole('button', { name: 'Open IPFS controls', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  await page.keyboard.press('Escape');
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH });
  assert.deepEqual(errors, []);
  await page.evaluate(() => {
    const wallet = window.DecentHead.getWallet(); wallet.providers = []; window.ethereum = undefined;
    window.dispatchEvent(new Event('decenthead:providers'));
  });
  assert.equal(await page.locator('wallet-connect #status').isVisible(), false, 'Hide only the redundant no-injected-wallet caption');
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('market:filters', { detail: { category: 'all', search: '', availability: 'minted' } }));
    const products = Array.from({ length: 24 }, (_, index) => ({
      tokenId: String(200 + index), totalMinted: '1', metadata: { name: `Spiral fixture ${index}` }, listings: [],
    }));
    document.dispatchEvent(new CustomEvent('gallery:products-loaded', { detail: { products } }));
  });
  await page.getByRole('button', { name: 'Spiral overview', exact: true }).click();
  assert.equal(await page.evaluate(() => {
    const c = document.querySelector('decent-canvas');
    return Object.values(c._productSprites).every(({ sprite }) => {
      const projected = sprite.position.clone().project(c.camera);
      return Math.abs(projected.x) < .9 && Math.abs(projected.y) < .9 && Math.abs(projected.z) < 1;
    });
  }), true, 'Landing overview fits all 24 spiral coin centers');
  assert.ok(await page.locator('.market-coin-flip:visible').count() <= 2, 'No deep-scene stack of flip buttons');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('.market-coin-flip')].filter(button => !button.hidden);
    return buttons.length > 0 && buttons.length <= 2;
  });
  await page.getByRole('button', { name: 'Older edition', exact: true }).click();
  assert.equal(await page.evaluate(() => document.querySelector('decent-canvas')._selectedEdition), '201');
  const purchaseURL = `${base.replace(/\/$/, '')}/supporter/buy.html?chainId=8453&escrow=${BASE.ESCROW}&listingId=0`;
  await page.goto(purchaseURL);
  await page.getByRole('button', { name: 'Review this release · 10 USDC', exact: true }).waitFor();
  assert.match(await page.locator('#purchase-status').innerText(), /listing #0/);
  await page.getByRole('button', { name: 'Review this release · 10 USDC', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Buy one · 10 USDC', exact: true }).isEnabled(), true);
  assert.deepEqual(await page.evaluate(() => window.walletCalls), [], 'Opening a purchase link never connects or signs');
  await page.goto(purchaseURL.replace('listingId=0', 'listingId=99'));
  await page.getByRole('alert').filter({ hasText: 'Purchase unavailable' }).waitFor();
  assert.equal(await page.locator('#review-purchase').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: Explicit coin flip, sale-first/minted-only filters, live Base offers, large cards, ENS setup, steward preview, mint/music lanes, gallery price preservation, 320-1440px Header and reduced motion; no real signing.');
} finally { await browser.close(); }
