import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketArrival, arrivalProduct } from '../js/market-arrival.mjs';
import { BASE } from '../js/supporter-mint.mjs';
import { dnftCategory } from '../js/market-filters.mjs';
const query = `?supporters=1&chainId=8453&nftContract=${BASE.DNFT}&tokenId=79`;
test('Supporter Star arrival selects exact Base collection/token, not search/name collisions', () => {
  const selection = parseMarketArrival(query);
  const own = { tokenId: '79', nftContract: BASE.DNFT };
  assert.equal(arrivalProduct([{ tokenId: '78' }, { ...own, nftContract: `0x${'1'.repeat(40)}` }, own], selection), own);
  assert.equal(arrivalProduct([], selection), null);
  assert.equal(parseMarketArrival('?other=1'), null);
});
test('malformed, duplicated, foreign-chain or foreign-collection arrivals fail explicitly', () => {
  for (const q of [query + '&tokenId=78', query.replace('8453', '10'), query.replace('tokenId=79', 'tokenId=-1'),
    query.replace(BASE.DNFT, `0x${'1'.repeat(40)}`), '?supporters=1', query.replace('tokenId=79', `tokenId=${2n ** 256n}`)]) {
    assert.throws(() => parseMarketArrival(q));
  }
});
test('both 10 and 100-USDC Decent Series editions stay in the Supporter category', () => {
  for (const price of ['10 USDC', '100 USDC']) assert.equal(dnftCategory({ properties: { back_image: 'ipfs://art', repo: 'a/b', price } }), 'supporter');
});
