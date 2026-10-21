import './market-head.mjs';

import './components/DecentCanvas.js';

import './components/Footer.js';
import { showPublicReleases } from './market-releases.mjs';
const header = document.querySelector('decent-header');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--market-header-height', `${header.getBoundingClientRect().height}px`);
  window.dispatchEvent(new Event('resize'));
}).observe(header);
void showPublicReleases().then(() => document.dispatchEvent(new Event('market:load-gallery')));
document.addEventListener('market:load-gallery', event => {
  if (event.detail?.refresh) void showPublicReleases();
});
