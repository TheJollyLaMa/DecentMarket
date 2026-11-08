import './market-head.mjs';

import './components/DecentCanvas.js';

import './components/Footer.js';
import { showPublicReleases } from './market-releases.mjs';
import { loadMarketListings } from './market-listings.mjs';
import { loadModeration, visibleMarketProducts } from './market-moderation.mjs';
import { openCollectibleCard, openMarketCatalog } from './market-card.mjs';
import { parseMarketArrival, arrivalProduct } from './market-arrival.mjs';
import { dnftCategory } from './market-filters.mjs';
import { openMarketDialog } from './market-dialog.mjs';
let arrival, arrivalHandled = false;
const arrivalLoading = detail => document.dispatchEvent(new CustomEvent('market:arrival-loading', { detail }));
try { arrival = parseMarketArrival(location.search); }
catch (error) {
  arrivalLoading({ done: true });
  console.error('[Market arrival]', error);
  const { body } = openMarketDialog('market-arrival-error', 'Supporter link unavailable');
  const status = document.createElement('p');
  status.setAttribute('role', 'alert'); status.textContent = error.message; body.append(status);
}
if (arrival) arrivalLoading({ ready: true, text: 'Connecting to Base to verify your Supporter edition…' });
const header = document.querySelector('decent-header');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--market-header-height', `${header.getBoundingClientRect().height}px`);
  window.dispatchEvent(new Event('resize'));
}).observe(header);
void showPublicReleases();
void loadModeration();
let refreshing = false;
let refreshRequested = false;
const listingStatus = text => document.dispatchEvent(new CustomEvent('market:listing-status', { detail: { text } }));
async function refreshListings() {
  if (refreshing) { refreshRequested = true; return; }
  refreshing = true;
  listingStatus('Verifying current Base prices and stock...');
  document.dispatchEvent(new CustomEvent('market:listed-products', { detail: { products: [] } }));
  try {
    const result = await loadMarketListings({ onProgress: progress => {
      if (arrival && !arrivalHandled) arrivalLoading({
        ...progress,
        text: progress.stage === 'inventory'
          ? `Checking Base listings · ${progress.checked} of ${progress.total}`
          : `Loading artwork and prices · ${progress.checked} of ${progress.total}`
      });
    } });
    listingStatus(result.errors.length ? `Some listings unavailable: ${result.errors.join(' · ')}`
      : `${result.products.reduce((n, p) => n + p.listings.length, 0)} Base listing(s) · ${result.paused ? 'escrow paused' : 'prices and stock checked'}`);
    document.dispatchEvent(new CustomEvent('market:listed-products', { detail: result }));
    if (arrival && !arrivalHandled) {
      arrivalHandled = true;
      arrivalLoading({ done: true });
      const supporters = visibleMarketProducts(result.products).filter(product => dnftCategory(product.metadata) === 'supporter');
      openMarketCatalog(supporters, { supporters: true });
      const product = arrivalProduct(supporters, arrival);
      if (product) {
        document.dispatchEvent(new CustomEvent('gallery:fly-to', { detail: { tokenId: arrival.tokenId } }));
        openCollectibleCard(product);
      }
      else {
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        status.textContent = 'The linked Supporter edition is unavailable in the current public listing read. Browse the other observed Supporter editions or refresh; no replacement token selected.';
        document.querySelector('#market-catalog .market-dialog-body').prepend(status);
      }
    }
    document.dispatchEvent(new CustomEvent('market:gallery-status', { detail: { error: result.errors.join(' · '), loading: false } }));
    for (const error of result.errors) console.error('[Market listing]', error);
  } catch (error) {
    if (arrival && !arrivalHandled) arrivalLoading({ error: `Could not verify your Supporter edition: ${error.message}` });
    listingStatus(`Base listings unavailable: ${error.message}. Refresh in the filters to retry.`);
    console.error('[Market listings]', error);
    document.dispatchEvent(new CustomEvent('market:gallery-status', { detail: { error: `Base listings unavailable: ${error.message}. Refresh to retry.`, loading: false } }));
  } finally {
    refreshing = false;
    if (refreshRequested) { refreshRequested = false; void refreshListings(); }
  }
}
void refreshListings();
document.addEventListener('market:refresh-listings', refreshListings);
document.addEventListener('market:load-gallery', event => {
  if (event.detail?.refresh) { void showPublicReleases(); void refreshListings(); }
});
