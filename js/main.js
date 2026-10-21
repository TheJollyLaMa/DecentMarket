import '../vendor/decent-head/2.0.0/js/main.js';

import './components/DecentCanvas.js';

import './components/Footer.js';
import { showPublicReleases } from './market-releases.mjs';
const header = document.querySelector('decent-header');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--market-header-height', `${header.getBoundingClientRect().height}px`);
  window.dispatchEvent(new Event('resize'));
}).observe(header);
void showPublicReleases();
