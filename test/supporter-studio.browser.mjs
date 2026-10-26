import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8792';
const embedded = process.env.EMBEDDED_STUDIO === '1';
const quantity = process.env.SUPPORTER_QUANTITY || '1000';
const priceUSDC = process.env.SUPPORTER_PRICE_USDC || '10000000';
const quantityLabel = Number(quantity).toLocaleString('en-US'), priceLabel = `${BigInt(priceUSDC) / 1000000n} USDC`;
const statusSelector = embedded ? '.supporter-studio-embed #status' : 'main #status';
const browser = await chromium.launch();
const errors = [];
let page;
try {
  page = await browser.newPage({ acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  if (embedded) await page.route('https://mainnet.base.org/**', route => {
    const data = route.request().postDataJSON();
    const reply = call => ({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? '0x2105' : '0x' + '0'.repeat(64) });
    return route.fulfill({ json: Array.isArray(data) ? data.map(reply) : reply(data) });
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await page.route('https://gateway.pinata.cloud/**', route => route.fulfill({ contentType: 'image/png', body: png }));
  if (quantity !== '1000' || priceUSDC !== '10000000') await page.route('**/releases/decenthead-v2.0.0/*.json', async route => {
    const response = await route.fetch(), value = await response.json();
    if (route.request().url().endsWith('supporter-release.json')) Object.assign(value, { quantity, priceUSDC });
    else {
      Object.assign(value.properties, { supply: Number(quantity), price: priceLabel });
      for (const trait of value.attributes || []) {
        if (trait.trait_type === 'supply') trait.value = Number(quantity);
        if (trait.trait_type === 'price') trait.value = priceLabel;
      }
    }
    await route.fulfill({ json: value });
  });
  await page.addInitScript({ content: readFileSync(new URL('../js/vendor/ethers.umd.min.js', import.meta.url), 'utf8') });
  await page.addInitScript(({ quantity, priceUSDC }) => {
    const E = window.ethers;
    const account = '0x807061DF657A7697c04045dA7d16D941861cAABc';
    const nftAddress = '0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B';
    const escrowAddress = '0x31b07b83e99A9bdF379bf40225b8A80d3804C89d';
    const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const nft = new E.Interface([
      'function hasRole(bytes32,address) view returns(bool)', 'function uri(uint256) view returns(string)',
      'function royaltyInfo(uint256,uint256) view returns(address,uint256)', 'function balanceOf(address,uint256) view returns(uint256)',
      'function registerToken(uint256,string,uint8,address,uint96) returns(uint256)',
      'function mintProduct(address,uint256,uint256)', 'function safeTransferFrom(address,address,uint256,uint256,bytes)',
      'event TokenRegistered(uint256 indexed tokenId,address indexed creator,uint256 maxSupply,uint8 kind,string uri)',
      'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
    ]);
    const escrow = new E.Interface([
      'function owner() view returns(address)', 'function paused() view returns(bool)',
      'function listDNFT(address,uint256,uint256,address,uint256,uint256,string) returns(uint256)',
      'function listings(uint256) view returns(address nftContract,uint256 tokenId,uint256 priceETH,address priceToken,uint256 priceAmount,uint256 available,bool active,string note)',
      'event Listed(uint256 indexed listingId,address indexed nftContract,uint256 indexed tokenId,uint256 priceETH,address priceToken,uint256 priceAmount,uint256 quantity,string note)',
    ]);
    const key = 'studio-browser-rpc';
    let state = JSON.parse(sessionStorage.getItem(key) || '{"transactions":{},"receipts":{},"nonce":0}');
    const save = () => sessionStorage.setItem(key, JSON.stringify(state));
    const metadataURI = 'ipfs://QmVGmpz63TS9XkTHMxf2sybHv5k9Vdoyr2Spi9QqZ4pzfj';
    const blockHash = '0x' + 'a'.repeat(64);
    window.rpcMethods = [];
    window.ethereum = {
      on() {},
      async request({ method, params = [] }) {
        window.rpcMethods.push(method);
        if (method === 'eth_chainId') return '0x2105';
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_blockNumber') return '0x100';
        if (method === 'eth_getTransactionCount') return E.toQuantity(state.nonce);
        if (method === 'eth_estimateGas') return '0x20000';
        if (method === 'eth_getTransactionByHash') return state.transactions[params[0]] || null;
        if (method === 'eth_getTransactionReceipt') return state.receipts[params[0]] || null;
        if (method === 'eth_call') {
          const tx = params[0], iface = tx.to.toLowerCase() === nftAddress.toLowerCase() ? nft : escrow;
          const call = iface.parseTransaction({ data: tx.data });
          const values = {
            hasRole: [true], owner: [account], paused: [false], uri: [metadataURI], royaltyInfo: [account, 1000], balanceOf: [quantity],
            registerToken: [7], listDNFT: [9],
            listings: [nftAddress, 7, 0, usdc, priceUSDC, quantity, true, 'Supporter'],
          };
          return iface.encodeFunctionResult(call.name, values[call.name] || []);
        }
        if (method === 'eth_sendTransaction') {
          if (window.rejectNextTx) {
            window.rejectNextTx = false;
            throw Object.assign(new Error('User rejected transaction'), { code: 4001 });
          }
          const tx = params[0], iface = tx.to.toLowerCase() === nftAddress.toLowerCase() ? nft : escrow;
          const call = iface.parseTransaction({ data: tx.data });
          const hash = '0x' + (++state.nonce).toString(16).padStart(64, '0');
          state.transactions[hash] = {
            ...tx, hash, input: tx.data, from: account, chainId: '0x2105', value: '0x0', type: '0x0',
            gas: tx.gas || '0x20000', gasPrice: '0x1', blockHash, blockNumber: '0x100',
            transactionIndex: '0x0', r: '0x' + '1'.repeat(64), s: '0x' + '2'.repeat(64), v: '0x1b',
          };
          let event, args;
          if (call.name === 'registerToken') { event = 'TokenRegistered'; args = [7, account, quantity, 0, metadataURI]; }
          if (call.name === 'mintProduct') { event = 'TransferSingle'; args = [account, E.ZeroAddress, account, 7, quantity]; }
          if (call.name === 'safeTransferFrom') { event = 'TransferSingle'; args = [account, account, escrowAddress, 7, quantity]; }
          if (call.name === 'listDNFT') { event = 'Listed'; args = [9, nftAddress, 7, 0, usdc, priceUSDC, quantity, 'Supporter']; }
          if (!event) throw new Error(`Unexpected transaction ${call.name}`);
          const log = iface.encodeEventLog(iface.getEvent(event), args);
          state.receipts[hash] = {
            transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: '0x100',
            from: account, to: tx.to, cumulativeGasUsed: '0x10000', gasUsed: '0x10000', effectiveGasPrice: '0x1',
            contractAddress: null, status: '0x1', type: '0x0', logsBloom: '0x' + '0'.repeat(512),
            logs: [{ ...log, address: tx.to, blockHash, blockNumber: '0x100', transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false }],
          };
          save(); return hash;
        }
        throw new Error(`Unexpected RPC method ${method}`);
      },
    };
  }, { quantity, priceUSDC });
  async function openStudio() {
    if (embedded) {
      await page.getByRole('button', { name: '📜', exact: true }).click();
      await page.locator('[data-lane=supporter] > summary').click();
    }
  }
  await page.goto(embedded ? base : `${base}/supporter.html`);
  await openStudio();
  assert.deepEqual(await page.evaluate(() => window.rpcMethods), []);
  await page.getByRole('button', { name: 'Load DecentMarket v0.3.1', exact: true }).click();
  await page.locator(statusSelector).filter({ hasText: 'Prepared metadata preserved exactly.' }).waitFor();
  assert.match(await page.locator('#release-summary').innerText(), /TheJollyLaMa\/DecentMarket v0\.3\.1/);
  assert.equal(await page.locator('#purchase-base').inputValue(), 'https://thejollylama.github.io/DecentMarket/supporter/buy.html');
  assert.deepEqual(await page.evaluate(() => window.rpcMethods), [], 'Loading Market never connects or signs');
  await page.getByRole('button', { name: 'Load DecentHead v2.0.0' }).click();
  await page.locator(statusSelector).filter({ hasText: 'Prepared metadata preserved exactly.' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.rpcMethods), []);
  await page.getByRole('button', { name: 'Connect creator wallet' }).click();
  await page.locator(statusSelector).filter({ hasText: 'Review and confirm' }).waitFor();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Connect creator wallet' }).click();
  await page.getByText('NFT admin and escrow owner verified', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.rpcMethods.includes('eth_sendTransaction')), false);
  await page.evaluate(() => { window.rejectNextTx = true; });
  await page.getByRole('button', { name: 'Register release', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.error === 'true');
  assert.match(await page.locator(statusSelector).textContent(), /reject|denied/i);
  assert.equal(await page.locator('#progress').getByText('Verified — Register release', { exact: false }).count(), 0);
  for (const label of ['Register release', `Mint ${quantityLabel} editions to creator`, `Transfer ${quantityLabel} editions to escrow`, `List ${quantityLabel} editions at ${priceLabel} each`]) {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    await downloading;
    await page.locator(statusSelector).filter({ hasText: 'Step confirmed and saved.' }).waitFor();
    if (label === 'Register release') {
      await page.reload();
      await openStudio();
      await page.getByRole('button', { name: 'Load DecentHead v2.0.0' }).click();
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Connect creator wallet' }).click();
      await page.getByRole('button', { name: `Mint ${quantityLabel} editions to creator`, exact: true }).waitFor();
    }
  }
  const evidenceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Verify stock and download evidence' }).click();
  const download = await evidenceDownload;
  const evidence = JSON.parse(readFileSync(await download.path()));
  assert.equal(evidence.tokenId, '7'); assert.equal(evidence.listingId, '9');
  assert.match(evidence.purchaseUrl, /listingId=9/);
  assert.equal(new URL(evidence.purchaseUrl).searchParams.get('priceUSDC'), priceUSDC === '10000000' ? null : priceUSDC);
  assert.equal(await page.getByRole('button', { name: 'All steps verified' }).isDisabled(), true);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  console.log(`PASS: ${embedded ? 'embedded' : 'standalone'} studio UI + ethers/EIP1193 fixture; consent, all four transactions, reload resume, evidence export, mobile layout; no page errors or real signing.`);
} catch (error) {
  console.error('Failure:', error.message, 'Page errors:', errors);
  console.error('Page:', page.url(), (await page.content()).slice(0, 600));
  console.error('Studio status:', await page?.locator(statusSelector).count() ? await page.locator(statusSelector).textContent() : await page.locator('body').innerText());
  console.error('Layout:', await page.evaluate(() => {
    const items = [];
    function inspect(root) { for (const e of root.querySelectorAll('*')) { const r=e.getBoundingClientRect(); if (r.right > innerWidth) items.push({ tag:e.tagName, class:e.className?.baseVal ?? e.className, right:r.right, width:r.width }); if(e.shadowRoot) inspect(e.shadowRoot); } }
    inspect(document); return { width:document.documentElement.scrollWidth, items:items.slice(0,20) };
  }));
  throw error;
} finally { await browser.close(); }
