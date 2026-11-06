import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('current catalog routes bind Head and Voyager replacement IDs at unchanged prices', () => {
  const listings = JSON.parse(readFileSync(new URL('../releases/listings.json', import.meta.url)));
  for (const [tokenId, listingId] of [['70', '11'], ['80', '19']]) {
    const listing = listings.find(item => item.tokenId === tokenId);
    assert.equal(listing.listingId, listingId);
    const url = new URL(listing.purchaseUrl);
    assert.equal(url.origin + url.pathname, 'https://thejollylama.github.io/DecentHead/supporter/buy.html');
    assert.equal(url.searchParams.get('listingId'), listingId);
    assert.equal(url.searchParams.get('priceUSDC'), '10000000');
    assert.equal(url.searchParams.get('chainId'), '8453');
  }
});
