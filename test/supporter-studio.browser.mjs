import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8792';
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await page.route('https://gateway.pinata.cloud/**', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.addInitScript({ content: readFileSync(new URL('../js/vendor/ethers.umd.min.js', import.meta.url), 'utf8') });
  await page.addInitScript(() => {
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
            hasRole: [true], owner: [account], paused: [false], uri: [metadataURI], royaltyInfo: [account, 1000], balanceOf: [1000],
            registerToken: [7], listDNFT: [9],
            listings: [nftAddress, 7, 0, usdc, 10000000, 1000, true, 'Supporter'],
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
          if (call.name === 'registerToken') { event = 'TokenRegistered'; args = [7, account, 1000, 0, metadataURI]; }
          if (call.name === 'mintProduct') { event = 'TransferSingle'; args = [account, E.ZeroAddress, account, 7, 1000]; }
          if (call.name === 'safeTransferFrom') { event = 'TransferSingle'; args = [account, account, escrowAddress, 7, 1000]; }
          if (call.name === 'listDNFT') { event = 'Listed'; args = [9, nftAddress, 7, 0, usdc, 10000000, 1000, 'Supporter']; }
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
  });
  await page.goto(`${base}/supporter.html`);
  assert.deepEqual(await page.evaluate(() => window.rpcMethods), []);
  await page.getByRole('button', { name: 'Load DecentHead v2.0.0' }).click();
  await page.getByText('Prepared metadata preserved exactly.', { exact: false }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.rpcMethods), []);
  await page.getByRole('button', { name: 'Connect creator wallet' }).click();
  await page.getByRole('status').getByText('Review and confirm', { exact: false }).waitFor();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Connect creator wallet' }).click();
  await page.getByText('NFT admin and escrow owner verified', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.rpcMethods.includes('eth_sendTransaction')), false);
  await page.evaluate(() => { window.rejectNextTx = true; });
  await page.getByRole('button', { name: 'Register release', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').dataset.error === 'true');
  assert.match(await page.getByRole('status').textContent(), /reject|denied/i);
  assert.equal(await page.locator('#progress').getByText('Verified — Register release', { exact: false }).count(), 0);
  for (const label of ['Register release', 'Mint 1,000 editions to creator', 'Transfer 1,000 editions to escrow', 'List 1,000 editions at 10 USDC each']) {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    await downloading;
    await page.getByRole('status').getByText('Step confirmed and saved.', { exact: false }).waitFor();
    if (label === 'Register release') {
      await page.reload();
      await page.getByRole('button', { name: 'Load DecentHead v2.0.0' }).click();
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Connect creator wallet' }).click();
      await page.getByRole('button', { name: 'Mint 1,000 editions to creator', exact: true }).waitFor();
    }
  }
  const evidenceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Verify stock and download evidence' }).click();
  const download = await evidenceDownload;
  const evidence = JSON.parse(readFileSync(await download.path()));
  assert.equal(evidence.tokenId, '7'); assert.equal(evidence.listingId, '9');
  assert.match(evidence.purchaseUrl, /listingId=9/);
  assert.equal(await page.getByRole('button', { name: 'All steps verified' }).isDisabled(), true);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  console.log('PASS: real studio UI + ethers/EIP1193 fixture; consent, all four transactions, reload resume, evidence export, mobile layout; no page errors or real signing.');
} finally { await browser.close(); }
