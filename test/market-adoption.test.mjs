import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGalleryProducts, publicMarketProvider, resolveMarketAsset } from '../js/market-gallery.mjs';
import { verifyPublicListing } from '../js/market-releases.mjs';
import { BASE } from '../js/supporter-mint.mjs';
import { IPFSSession } from '../vendor/decent-head/2.0.0/js/ipfs.js';
import { uploadFileToIPFS, uploadMetadataToIPFS } from '../js/ipfs.js';
const manifest = JSON.parse(readFileSync(new URL('../releases/decenthead-v2.0.0/supporter-release.json', import.meta.url)));
const entry = JSON.parse(readFileSync(new URL('../releases/listings.json', import.meta.url)))[0];
const cid = manifest.front.slice(7);
globalThis.window = new EventTarget();
test('public RPC has a ten-second deadline and at most ten calls per batch', () => {
  const provider = publicMarketProvider({
    FetchRequest: class { constructor(url) { this.url = url; } },
    JsonRpcProvider: class { constructor(request, network, options) { this.request = request; this.network = network; this.options = options; } },
  }, 'https://mainnet.base.org');
  assert.equal(provider.request.timeout, 10000);
  assert.equal(provider.options.batchMaxCount, 10);
});

test('gallery publishes newest token before blocked older metadata and limits concurrency', async () => {
  let releaseOld, active = 0, peak = 0;
  const blocked = new Promise(resolve => { releaseOld = resolve; });
  const seen = [], progress = [];
  const contract = {
    nextTokenId: async () => 71n,
    kindOf: async id => { seen.push(id); return id >= 69 ? 0 : 1; },
    uri: async id => String(id), maxSupply: async () => 1000n, totalMinted: async () => 1000n,
  };
  const loading = loadGalleryProducts(contract, { concurrency: 2,
    fetchJSON: async uri => { active++; peak = Math.max(peak, active); if (uri === '69') await blocked; active--; return { name: `Token ${uri}` }; },
    onProgress: products => progress.push(products.map(p => p.tokenId)),
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(seen[0], 70);
  assert.deepEqual(progress[0], ['70']);
  releaseOld();
  const result = await loading;
  assert.deepEqual(result.products.map(p => p.tokenId), ['70', '69']);
  assert.ok(peak <= 2);
});
test('gallery never invents supply after failed chain reads and reports partial metadata explicitly', async () => {
  const result = await loadGalleryProducts({
    nextTokenId: async () => 3n, kindOf: async () => 0n, uri: async id => String(id),
    maxSupply: async id => { if (id === 1) throw new Error('RPC unavailable'); return 1000n; },
    totalMinted: async () => 800n,
  }, { fetchJSON: async () => { throw new Error('Metadata HTTP 503'); } });
  assert.equal(result.products.length, 2);
  assert.equal(result.errors.length, 3);
  assert.match(result.products[0].metadata.name, /unavailable/);
  assert.equal(result.products[0].totalMinted, '800');
});
test('assets use configured non-retired gateway and reject unsafe schemes', () => {
  assert.match(resolveMarketAsset(`ipfs://${cid}`), /^https:\/\/gateway.pinata.cloud\/ipfs\//);
  assert.throws(() => resolveMarketAsset('javascript:alert(1)'), /Unsupported/);
});
function listingFixture() {
  const listing = { nftContract: BASE.DNFT, tokenId: 70n, priceETH: 0n, priceToken: BASE.USDC, priceAmount: 10000000n, available: 1000n, active: true };
  const nft = { uri: async () => manifest.metadataURI, balanceOf: async () => 1000n, royaltyInfo: async () => [manifest.creatorAddress, 1000n] };
  const escrow = { listings: async id => { assert.equal(id, '0'); return listing; }, paused: async () => false };
  return { listing, nft, escrow, entry, manifest };
}
test('real listing zero is accepted only with exact URI, royalty, price and covered stock', async () => {
  assert.deepEqual(await verifyPublicListing(listingFixture()), { available: '1000', purchasable: true, paused: false });
});
for (const field of ['nftContract', 'tokenId', 'priceETH', 'priceToken', 'priceAmount']) {
  test(`public listing rejects changed ${field}`, async () => {
    const f = listingFixture();
    f.listing[field] = typeof f.listing[field] === 'bigint' ? f.listing[field] + 1n : '0x0000000000000000000000000000000000000000';
    await assert.rejects(verifyPublicListing(f));
  });
}
test('uncovered, paused and sold-out listings never produce a buy action', async () => {
  const f = listingFixture(); f.nft.balanceOf = async () => 999n;
  await assert.rejects(verifyPublicListing(f), /stock/);
  f.nft.balanceOf = async () => 1000n; f.escrow.paused = async () => true;
  assert.equal((await verifyPublicListing(f)).purchasable, false);
  f.escrow.paused = async () => false; f.listing.available = 0n;
  assert.equal((await verifyPublicListing(f)).purchasable, false);
});
test('wrong prepared metadata and purchase binding are rejected', async () => {
  const f = listingFixture(); f.nft.uri = async () => 'ipfs://different';
  await assert.rejects(verifyPublicListing(f), /metadata/);
  const g = listingFixture(); g.entry = { ...entry, purchaseUrl: entry.purchaseUrl.replace('listingId=0', 'listingId=1') };
  await assert.rejects(verifyPublicListing(g), /Purchase/);
});
test('file and metadata uploads use shared session only; no implicit credentials, invalid CID or swallowed HTTP errors', async () => {
  const session = new IPFSSession();
  globalThis.DecentHead = { getIpfs: () => session };
  const calls = [];
  session.request = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ IpfsHash: cid }));
  };
  await assert.rejects(uploadFileToIPFS(new File(['image'], 'front.png')), /Enter your Pinata/);
  assert.equal(calls.length, 0);
  session.configure({ provider: 'pinata', jwt: 'synthetic-test-only' });
  assert.equal(await uploadFileToIPFS(new File(['image'], 'front.png')), `ipfs://${cid}`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-test-only');
  assert.equal(await calls[0].options.body.get('file').text(), 'image');
  await uploadMetadataToIPFS({ name: 'Metadata stays intact', properties: { version: '2' } });
  assert.equal(JSON.parse(await calls[1].options.body.get('file').text()).properties.version, '2');
  session.request = async () => new Response('{"IpfsHash":"bad"}');
  await assert.rejects(uploadFileToIPFS(new File(['x'], 'x')), /invalid CID/);
  session.request = async () => { throw new Error('IPFS request failed (HTTP 401)'); };
  await assert.rejects(uploadMetadataToIPFS({ name: 'x' }), /401/);
});
test('local uploads use Kubo multipart, no Pinata authorization, and final NDJSON CID', async () => {
  const session = new IPFSSession();
  globalThis.DecentHead = { getIpfs: () => session };
  session.configure({ provider: 'local' });
  session.request = async (url, options) => {
    assert.match(url, /api\/v0\/add\?pin=true$/);
    assert.equal(options.headers, undefined);
    return new Response(`{"Bytes":1}\n{"Hash":"${cid}"}\n`);
  };
  assert.equal(await uploadFileToIPFS(new File(['x'], 'x')), `ipfs://${cid}`);
});
test('legacy wallet facade respects selected provider, consent, disconnect and multi-wallet choice', async () => {
  const { marketEthereum, marketBrowserProvider } = await import('../js/market-wallet.mjs');
  let state = { connected: false, address: null, chainId: null, provider: null }, prompts = 0, forwarded = 0;
  const provider = { selected: 'EIP6963 provider B' };
  const wallet = {
    rawProvider: null, snapshot: () => state, available: () => [{ provider }],
    async connect() { prompts++; wallet.rawProvider = { request: async () => { forwarded++; return 'selected-B'; } }; state = { connected: true, address: manifest.creatorAddress, chainId: '0x2105', provider }; },
  };
  globalThis.DecentHead = { getWallet: () => wallet };
  const facade = marketEthereum();
  assert.deepEqual(await facade.request({ method: 'eth_accounts' }), []);
  assert.equal(await facade.request({ method: 'eth_chainId' }), '0x2105');
  assert.equal(prompts, 0);
  assert.equal(await marketBrowserProvider(), provider);
  assert.equal(prompts, 1);
  assert.equal(await facade.request({ method: 'eth_sendTransaction', params: [] }), 'selected-B');
  assert.equal(forwarded, 1);
  state = { connected: false, address: null, chainId: null, provider: null }; wallet.rawProvider = null;
  await assert.rejects(facade.request({ method: 'eth_sendTransaction' }), /Connect/);
  assert.deepEqual(await facade.request({ method: 'eth_accounts' }), []);
  wallet.available = () => [{}, {}];
  await assert.rejects(marketBrowserProvider(), /Choose your wallet/);
  assert.equal(prompts, 1);
});
