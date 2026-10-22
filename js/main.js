import './market-head.mjs';

import './components/DecentCanvas.js';

import './components/Footer.js';
import { showPublicReleases } from './market-releases.mjs';
import { loadMarketListings } from './market-listings.mjs';
import { loadModeration } from './market-moderation.mjs';
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
    const result = await loadMarketListings();
    listingStatus(result.errors.length ? `Some listings unavailable: ${result.errors.join(' · ')}`
      : `${result.products.reduce((n, p) => n + p.listings.length, 0)} Base listing(s) · ${result.paused ? 'escrow paused' : 'prices and stock checked'}`);
    document.dispatchEvent(new CustomEvent('market:listed-products', { detail: result }));
    document.dispatchEvent(new CustomEvent('market:gallery-status', { detail: { error: result.errors.join(' · '), loading: false } }));
    for (const error of result.errors) console.error('[Market listing]', error);
  } catch (error) {
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
