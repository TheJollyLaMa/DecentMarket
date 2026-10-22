import './market-head.mjs';
import { BASE } from './supporter-mint.mjs';
import { loadMarketListings, parseMarketPurchase } from './market-listings.mjs';
import { openCollectibleCard } from './market-card.mjs';

const status = document.getElementById('purchase-status');
const review = document.getElementById('review-purchase');
try {
  const id = parseMarketPurchase(location.search);
  const result = await loadMarketListings();
  if (result.errors.length) throw new Error(result.errors.join('; '));
  const product = result.products.find(product => product.listings.some(listing => listing.id === id));
  const listing = product?.listings.find(listing => listing.id === id);
  if (!listing?.purchasable || listing.nftContract.toLowerCase() !== BASE.DNFT.toLowerCase()
    || listing.priceETH !== 0n || listing.priceToken.toLowerCase() !== BASE.USDC.toLowerCase()
    || listing.priceAmount !== 10000000n)
    throw new Error('This listing is not an active, funded 10-USDC Supporter offer');
  status.textContent = `${product.metadata?.name || `DNFT #${product.tokenId}`} · Base listing #${id} · ${listing.available} editions · 10 USDC each`;
  review.hidden = false;
  review.onclick = () => openCollectibleCard({ ...product, listings: [listing] });
} catch (error) {
  console.error('[Market Supporter purchase]', error);
  status.textContent = `Purchase unavailable: ${error.shortMessage || error.message}`;
  status.setAttribute('role', 'alert');
}
