import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultFilters, dnftCategory, filterDnfts } from '../js/market-filters.mjs';
import { validateMusicSubmission, musicCID } from '../js/market-music.mjs';
import { CONTRACTS, getChainConfig, VERSIONS } from '../js/config/contracts.js';
const metadata = JSON.parse(readFileSync(new URL('../releases/decenthead-v2.0.0/supporter-metadata.json', import.meta.url)));
const artist = '0x807061DF657A7697c04045dA7d16D941861cAABc';
test('Head Supporter HTML animation is not misclassified as music', () => {
  assert.equal(dnftCategory(metadata), 'supporter');
  assert.equal(dnftCategory({ animation_url: 'ipfs://music', audioUrl: 'ipfs://music' }), 'music');
  assert.equal(dnftCategory({ animation_url: 'ipfs://video', mediaType: 'video/mp4' }), 'music');
  assert.equal(dnftCategory({ name: 'Regular art' }), 'regular');
});
test('space filters cover category, text, artist, token ID, reset and empty results', () => {
  const products = [{ tokenId: '70', metadata, escrowStock: '1000', listings: [{ purchasable: true }] },
    { tokenId: '71', totalMinted: '1', metadata: { name: 'A song', artist, audioUrl: 'ipfs://music' } },
    { tokenId: '72', totalMinted: '2', metadata: { name: 'Art' } },
    { tokenId: '73', totalMinted: '0', metadata: { name: 'Not minted' } },
    { tokenId: '74', escrowStock: '1', listings: [{ purchasable: false }], metadata: { name: 'Paused listing' } }];
  assert.deepEqual(filterDnfts(products, defaultFilters).map(p => p.tokenId), ['70']);
  assert.equal(filterDnfts(products, { ...defaultFilters, availability: 'minted' }).length, 4);
  assert.deepEqual(filterDnfts(products, { category: 'music', search: artist, availability: 'minted' }).map(p => p.tokenId), ['71']);
  assert.deepEqual(filterDnfts(products, { category: 'supporter', search: 'decenthead' }).map(p => p.tokenId), ['70']);
  assert.deepEqual(filterDnfts(products, { category: 'all', search: '72', availability: 'minted' }).map(p => p.tokenId), ['72']);
  assert.equal(filterDnfts(products, { category: 'all', search: 'missing' }).length, 0);
});
test('Optimism is sunset, not selectable or routable by active configuration', () => {
  assert.equal(CONTRACTS.optimism, undefined);
  assert.equal(getChainConfig('0xa'), undefined);
  assert.equal(CONTRACTS.base.chainId, '0x2105');
  assert.equal(VERSIONS.find(v => v.href === '/v0.2/').available, false);
});
test('music submissions preserve Busking artist/tip/parent and exact DJuke split requirements', () => {
  const payload = { title: 'Original song', artist: 'Artist', recipient: artist, tipWallet: artist, parentTokenId: 0 };
  assert.deepEqual(validateMusicSubmission(payload), [{ wallet: artist, shareBps: 10000 }]);
  assert.throws(() => validateMusicSubmission({ ...payload, title: '' }), /title/);
  assert.throws(() => validateMusicSubmission({ ...payload, recipient: '0x' + '0'.repeat(40) }), /nonzero/);
  assert.throws(() => validateMusicSubmission({ ...payload, parentTokenId: -1 }), /Parent/);
  assert.throws(() => validateMusicSubmission({ ...payload, creatorSplits: [{ wallet: artist, shareBps: 5000 }] }), /100%/);
  assert.throws(() => validateMusicSubmission({ ...payload, creatorSplits: [{ wallet: artist, shareBps: 5000 }, { wallet: artist, shareBps: 5000 }] }), /unique/);
});
test('music inputs require file CIDs instead of gateway/folder guesses', () => {
  const cid = metadata.image.slice(7);
  assert.equal(musicCID(`ipfs://${cid}`), cid);
  assert.throws(() => musicCID(`https://gateway.pinata.cloud/ipfs/${cid}`), /file CID/);
  assert.throws(() => musicCID(`${cid}/song.mp3`), /file CID/);
});
