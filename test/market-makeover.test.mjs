import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASE, ethers, validateRelease } from '../js/supporter-mint.mjs';
import { assetKey, listingPrices, listingTerms, readFundedListings, executeMarketPurchase, MARKET_ESCROW_ABI, parseMarketPurchase, parseSupporterPrice } from '../js/market-listings.mjs';
import { validateModeration, moderationKey, isMarketAdmin, ADMIN } from '../js/market-moderation.mjs';
import { coinCaption, starPoints } from '../js/market-coin.mjs';
import { COIN_RADIUS, SPIRAL_RADIUS, timelinePosition, viewingDistance, nearbyFlipKeys, advanceStarDepth } from '../js/market-flight.mjs';

test('Supporter purchase links bind exact Base escrow and accept listing zero, rejecting duplicates and invalid IDs', () => {
  const base = `?chainId=8453&escrow=${BASE.ESCROW}&listingId=`;
  assert.equal(parseMarketPurchase(`${base}0`), '0');
  assert.equal(parseMarketPurchase(`${base}123`), '123');
  for (const search of ['', `${base}-1`, `${base}01`, `${base}1&listingId=2`, `${base}1&chainId=8453`,
    `${base}1`.replace('8453', '10'), `${base}1`.replace(BASE.ESCROW, BASE.DNFT)])
    assert.throws(() => parseMarketPurchase(search));
});
test('Supporter route defaults to historical 10 USDC and accepts only explicit canonical 100 USDC', () => {
  assert.equal(parseSupporterPrice(''), '10000000');
  assert.equal(parseSupporterPrice('?priceUSDC=100000000'), '100000000');
  for (const value of ['100', '1', '0100000000', '', '100000000&priceUSDC=100000000'])
    assert.throws(() => parseSupporterPrice(`?priceUSDC=${value}`));
  const studio = readFileSync(new URL('../supporter.html', import.meta.url), 'utf8');
  assert.doesNotMatch(studio, /1,000 editions · 10 USDC each/);
});
test('starfield gently approaches the viewer and wraps behind at a frame-rate independent speed', () => {
  assert.equal(advanceStarDepth(-50, 1), -47.5);
  assert.equal(advanceStarDepth(-3, 1), -118.5);
  assert.equal(advanceStarDepth(advanceStarDepth(-50, .5), .5), advanceStarDepth(-50, 1));
});
test('collectible outline has five outer tips and five inner notches', () => {
  const points = starPoints();
  assert.equal(points.length, 10);
  points.forEach((point, index) => assert.ok(Math.abs(Math.hypot(point.x, point.y) - COIN_RADIUS * (index % 2 ? .52 : 1)) < 1e-10));
  assert.ok(Math.abs(points[0].x) < 1e-10);
  assert.equal(points[0].y, COIN_RADIUS);
});

test('larger coins follow a spaced spiral and fit a portrait camera', () => {
  assert.equal(COIN_RADIUS, 5.5);
  assert.deepEqual(timelinePosition(0), { x: 0, y: 28, z: -4 });
  const positions = Array.from({ length: 20 }, (_, index) => timelinePosition(index));
  for (let i = 1; i < positions.length; i++) {
    assert.equal(positions[i - 1].z - positions[i].z, 12);
    assert.notEqual(positions[i].x, positions[i - 1].x);
    assert.ok(Math.abs(positions[i].x) <= SPIRAL_RADIUS);
    assert.ok(Math.abs(Math.hypot(positions[i].x, positions[i].y) - SPIRAL_RADIUS) < 1e-10);
  }
  assert.ok(viewingDistance(.5) > viewingDistance(1.5));
  assert.ok(viewingDistance(.5) * Math.tan(75 * Math.PI / 360) * .5 > COIN_RADIUS);
});
test('flip controls are limited to two nearby coins, preferring focus but never distant focus', () => {
  const entries = Array.from({ length: 30 }, (_, i) => [String(i), { x: 0, y: 0, z: -i * 12 }]);
  assert.deepEqual(nearbyFlipKeys(entries, { x: 0, y: 0, z: 0 }, '2'), ['2', '0']);
  assert.deepEqual(nearbyFlipKeys(entries, { x: 0, y: 0, z: 0 }, '29'), ['0', '1']);
  assert.deepEqual(nearbyFlipKeys(entries, { x: 0, y: 0, z: 100 }, '0'), []);
});
test('three-product preparation cannot be mistaken for a mint-ready release', () => {
  const queue = JSON.parse(readFileSync(new URL('../data/supporter-release-queue.json', import.meta.url)));
  assert.equal(queue.status, 'draft-not-mintable');
  assert.deepEqual(queue.products.map(product => product.repo), [
    'TheJollyLaMa/DecentFooter', 'TheJollyLaMa/DecentCanvas', 'TheJollyLaMa/DecentMarket',
  ]);
  for (const product of queue.products) {
    if (product.repo === 'TheJollyLaMa/DecentMarket') {
      const manifest = validateRelease(JSON.parse(readFileSync(new URL(`../${product.preparedManifest}`, import.meta.url))));
      for (const key of ['version', 'commit', 'metadataURI', 'codeArchiveCid']) assert.equal(product[key], manifest[key]);
    } else {
      assert.equal(product.commit, null);
      assert.equal(product.metadataURI, null);
    }
    assert.throws(() => validateRelease(product), /prepared repository/);
  }
});

const raw = (overrides = {}) => ({ nftContract: BASE.DNFT, tokenId: 70n, priceETH: 0n, priceToken: BASE.USDC,
  priceAmount: 10000000n, available: 1000n, active: true, note: 'Head', ...overrides });
function fixture(rows = [raw()], { paused = false, stock = 1000n } = {}) {
  return {
    escrow: { nextListingId: async () => BigInt(rows.length), paused: async () => paused, listings: async id => {
      const row = rows[Number(id)]; if (row instanceof Error) throw row; return row;
    } },
    nftFor: () => ({ uri: async () => 'ipfs://CID/{id}', balanceOf: async () => stock }),
    tokenFor: () => ({ decimals: async () => 6n, symbol: async () => 'USDC' }),
    blockTag: 123, fetchMetadata: async uri => ({ name: uri }),
  };
}
test('listing zero is automatically discovered, priced exactly and ready with funded stock', async () => {
  const result = await readFundedListings(fixture());
  assert.deepEqual(result.errors, []);
  const product = result.products[0], listing = product.listings[0];
  assert.equal(listing.id, '0'); assert.equal(listing.purchasable, true);
  assert.equal(listing.status, 'Ready to purchase');
  assert.deepEqual(listingPrices(listing), [{ method: 'token', label: '10 USDC' }]);
  assert.match(product.metadata.name, /0000000000000046$/);
  assert.equal(coinCaption(product), '10 USDC');
  assert.equal(product.escrowStock, '1000');
});
test('Market ENS preparation uses real local artwork without inventing a website CID or recipient', () => {
  const prepared = JSON.parse(readFileSync(new URL('../data/market-ens.json', import.meta.url)));
  assert.equal(prepared.name, 'decentmarket.decentagency.eth');
  assert.equal(prepared.status, 'prepared-not-published');
  assert.equal(prepared.textRecords.url, 'https://thejollylama.github.io/DecentMarket/');
  assert.equal(prepared.contenthash, null);
  assert.equal(prepared.address, null);
  for (const key of ['avatar', 'header']) {
    const url = new URL(prepared.textRecords[key]);
    assert.equal(url.origin, 'https://thejollylama.github.io');
    assert.equal(url.pathname.startsWith('/DecentMarket/img/ens/'), true);
    const image = readFileSync(new URL(`..${url.pathname.slice('/DecentMarket'.length)}`, import.meta.url));
    assert.equal(image.subarray(1, 4).toString(), 'PNG');
    assert.equal(image.readUInt32BE(16), key === 'avatar' ? 512 : 1500);
  }
});
test('paused, sold-out, uncovered and overlapping reservations never advertise a buy', async () => {
  for (const result of [
    await readFundedListings(fixture([raw()], { paused: true })),
    await readFundedListings(fixture([raw()], { stock: 999n })),
    await readFundedListings(fixture([raw(), raw()], { stock: 1000n })),
  ]) assert.ok(result.products.every(p => p.listings.every(l => !l.purchasable)));
  assert.equal((await readFundedListings(fixture([raw({ available: 0n })]))).products.length, 0);
  assert.equal((await readFundedListings(fixture([raw({ active: false })]))).products.length, 0);
});
test('different collections with the same token ID remain distinct; native and 18-decimal prices stay exact', async () => {
  const result = await readFundedListings(fixture([raw(), raw({ nftContract: '0x' + '2'.repeat(40) })]));
  assert.equal(new Set(result.products.map(assetKey)).size, 2);
  assert.deepEqual(listingPrices(raw({ priceETH: 1234567890123456n, priceAmount: 1000000000000000001n,
    tokenInfo: { symbol: 'TEST', decimals: 18 } })), [
    { method: 'eth', label: '0.001234567890123456 ETH' }, { method: 'token', label: '1.000000000000000001 TEST' },
  ]);
});
test('failed verification is explicit and cannot enable partial unsafe buy offers', async () => {
  const result = await readFundedListings(fixture([raw(), new Error('RPC 429')]));
  assert.match(result.errors[0], /RPC 429/);
  assert.equal(result.products[0].listings[0].purchasable, false);
  const f = fixture(); f.fetchMetadata = async () => { throw new Error('gateway offline'); };
  const metadataFailure = await readFundedListings(f);
  assert.match(metadataFailure.errors[0], /gateway offline/);
  assert.equal(metadataFailure.products[0].listings[0].purchasable, true, 'Metadata failure is not a fabricated stock failure');
});
function purchaseFixture() {
  const f = fixture(), calls = [], account = ADMIN;
  const listing = { ...raw(), id: '0', tokenId: '70', purchasable: true, tokenInfo: { symbol: 'USDC', decimals: 6 } };
  const iface = new ethers.Interface(MARKET_ESCROW_ABI);
  const encoded = iface.encodeEventLog(iface.getEvent('Purchased'), [0n, account, 1n, BASE.USDC, 10000000n]);
  const receipt = { status: 1, logs: [{ address: BASE.ESCROW, ...encoded }] };
  const tx = () => ({ hash: '0x' + '1'.repeat(64), wait: async () => receipt });
  const token = { balanceOf: async () => 10000000n, allowance: async () => 0n,
    approve: async (address, amount) => { calls.push(['approve', address, amount]); return { wait: async () => ({ status: 1 }) }; } };
  Object.assign(f.escrow, { interface: iface,
    purchaseWithToken: async (...args) => { calls.push(['buy-token', ...args]); return tx(); },
    purchaseWithETH: async (...args) => { calls.push(['buy-eth', ...args]); return tx(); } });
  return { ...f, listing, method: 'token', provider: { getNetwork: async () => ({ chainId: 8453n }) },
    tokenFor: () => token, account, assertSession: async () => {}, status: () => {}, token, calls, receipt };
}
test('one-edition purchase approves exact amount, waits and verifies the expected receipt', async () => {
  const f = purchaseFixture();
  assert.match(await executeMarketPurchase(f), /^0x1{64}$/);
  assert.deepEqual(f.calls, [['approve', BASE.ESCROW, 10000000n], ['buy-token', '0', 1n, { chainId: 8453n }]]);
});
test('sufficient allowance skips approval; ETH buys send exact reviewed wei', async () => {
  const f = purchaseFixture(); f.token.allowance = async () => 10000000n;
  await executeMarketPurchase(f);
  assert.equal(f.calls.length, 1);
  const e = purchaseFixture(); e.method = 'eth'; e.listing.priceETH = 123n;
  e.escrow.listings = async () => raw({ priceETH: 123n });
  const iface = e.escrow.interface;
  e.receipt.logs[0] = { address: BASE.ESCROW, ...iface.encodeEventLog(iface.getEvent('Purchased'), [0n, ADMIN, 1n, ethers.ZeroAddress, 123n]) };
  await executeMarketPurchase(e);
  assert.deepEqual(e.calls, [['buy-eth', '0', 1n, { value: 123n, chainId: 8453n }]]);
});
test('price, stock, pause, chain, account and insufficient funds failures happen before approval', async () => {
  const changes = [
    f => { f.escrow.listings = async () => raw({ priceAmount: 12000000n }); },
    f => { f.escrow.paused = async () => true; },
    f => { f.nftFor = () => ({ balanceOf: async () => 0n }); },
    f => { f.provider.getNetwork = async () => ({ chainId: 10n }); },
    f => { f.assertSession = async () => { throw new Error('account changed'); }; },
    f => { f.token.balanceOf = async () => 1n; },
  ];
  for (const change of changes) { const f = purchaseFixture(); change(f); await assert.rejects(executeMarketPurchase(f)); assert.deepEqual(f.calls, []); }
});
test('changed context after approval and missing purchase events never produce success', async () => {
  const f = purchaseFixture(); let checks = 0;
  f.assertSession = async () => { if (++checks === 4) throw new Error('account changed after approval'); };
  await assert.rejects(executeMarketPurchase(f), /account changed/);
  assert.equal(f.calls.length, 1);
  const e = purchaseFixture(); e.receipt.logs = [];
  await assert.rejects(executeMarketPurchase(e), /lacks the expected purchase event/);
  const r = purchaseFixture(); r.receipt.status = 0;
  await assert.rejects(executeMarketPurchase(r), /not confirmed/);
});
test('overlapping reservations and user rejection cannot broadcast a purchase', async () => {
  const f = purchaseFixture(); f.escrow.nextListingId = async () => 2n; f.escrow.listings = async () => raw();
  await assert.rejects(executeMarketPurchase(f), /overlapping/); assert.deepEqual(f.calls, []);
  const rejected = purchaseFixture();
  rejected.token.approve = async () => { throw new Error('User rejected request'); };
  await assert.rejects(executeMarketPurchase(rejected), /User rejected/); assert.deepEqual(rejected.calls, []);
});
test('public moderation uses chain/collection/token keys and only the Base steward can preview', () => {
  const key = moderationKey({ tokenId: '70' });
  assert.deepEqual(validateModeration({ version: 1, hidden: [key, key] }).hidden, [key]);
  assert.throws(() => validateModeration({ version: 1, hidden: ['70'] }));
  assert.equal(isMarketAdmin({ connected: true, address: ADMIN, chainId: '0x2105' }), true);
  assert.equal(isMarketAdmin({ connected: true, address: ADMIN, chainId: '0xa' }), false);
  assert.equal(isMarketAdmin({ connected: false, address: ADMIN, chainId: '0x2105' }), false);
  assert.notEqual(listingTerms(raw()), listingTerms(raw({ tokenId: 71n })));
});
test('published hide policy applies to everyone; local preview applies only to the Base steward', async () => {
  const policy = await import('../js/market-moderation.mjs?policy-test');
  const product = { tokenId: '70' }, key = moderationKey(product), saved = new Map();
  const before = Object.fromEntries(['document', 'localStorage', 'DecentHead', 'fetch'].map(key => [key, globalThis[key]]));
  let state = { connected: false };
  try {
    globalThis.document = new EventTarget();
    globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
    globalThis.DecentHead = { getWallet: () => ({ snapshot: () => state }) };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 1, hidden: [key] }) });
    assert.deepEqual(policy.visibleMarketProducts([product]), [], 'Withhold display while policy is unknown');
    await policy.loadModeration();
    assert.deepEqual(policy.visibleMarketProducts([product]), []);
    assert.throws(() => policy.previewHidden(key, false), /admin wallet/);
    state = { connected: true, address: ADMIN, chainId: '0x2105' };
    policy.previewHidden(key, false);
    assert.deepEqual(policy.visibleMarketProducts([product]), [product]);
    state = { connected: false };
    assert.deepEqual(policy.visibleMarketProducts([product]), [], 'Disconnect must restore published policy');
    state = { connected: true, address: ADMIN, chainId: '0x2105' };
    policy.clearModerationPreview();
    assert.deepEqual(policy.visibleMarketProducts([product]), []);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
