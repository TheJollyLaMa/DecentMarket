import { defaultFilters } from '../../market-filters.mjs';
import { openMarketCatalog } from '../../market-card.mjs';

class LeftToolbar extends HTMLElement {
  connectedCallback() {
    this._listingStatus = 'Reading Base listings...';
    this._onListingStatus = event => {
      this._listingStatus = event.detail.text;
      const status = this.filterPanel?.querySelector('[data-listings]');
      if (status) status.textContent = this._listingStatus;
    };
    document.addEventListener('market:listing-status', this._onListingStatus);
    this.style.display = 'flex';
    this.style.flexDirection = 'column';
    this.style.alignItems = 'center';
    this.style.justifyContent = 'space-between';
    this.style.width = '50px';
    this.style.background = 'rgba(0, 0, 0, 0.6)';
    this.style.left = '0';
    this.style.zIndex = '999';
    this.style.padding = '20px 0';

    const buttonCount = 6;
    for (let i = 0; i < buttonCount; i++) {
      const btn = document.createElement('button');
      btn.style.width = '36px';
      btn.style.height = '36px';
      btn.style.borderRadius = '50%';
      btn.style.border = '1px solid orange';
      btn.style.background = 'black';
      btn.style.boxShadow = '0 0 10px orange';
      btn.style.cursor = 'pointer';
      btn.innerHTML = `🔆`;
      if (i === 0) { btn.innerHTML = '🔎'; btn.setAttribute('aria-label', 'Filter DNFTs in space'); btn.title = 'Filter DNFTs in space'; }
      btn.dataset.modal = `modal-left-${i + 1}`;
      btn.addEventListener('click', (e) => {
        this.showModal(e.target.dataset.modal);
      });
      this.appendChild(btn);
    }
  }

  disconnectedCallback() {
    document.removeEventListener('market:listing-status', this._onListingStatus);
    this.filterPanel?.remove();
  }

  showModal(id) {
    if (id === 'modal-left-1') { this.showFilters(); return; }
    // 🧹 Remove any existing modals
    const existingModals = document.querySelectorAll('[id^="modal-"]');
    existingModals.forEach(modal => modal.remove());

    const modal = document.createElement('div');
    modal.id = id;
    modal.style.position = 'fixed';
    modal.style.top = '50%';
    modal.style.left = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.padding = '20px';
    modal.style.background = 'rgba(0, 0, 0, 0.9)';
    modal.style.border = '2px solid magenta';
    modal.style.borderRadius = '12px';
    modal.style.boxShadow = '0 0 20px magenta';
    modal.style.zIndex = '2000';
    modal.style.color = 'white';
    modal.style.fontFamily = 'monospace';
    modal.style.textAlign = 'center';

    modal.innerHTML = `
      <h3>Modal: ${id}</h3>
      <p>This is a placeholder for <strong>${id}</strong></p>
      <button style="margin-top: 10px; padding: 6px 12px; border: 1px solid magenta; background: black; color: magenta;" onclick="document.body.removeChild(document.getElementById('${id}'))">Close</button>
    `;

    document.body.appendChild(modal);
  }

  showFilters() {
    const existing = document.getElementById('modal-space-filters');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('section');
    this.filterPanel = panel;
    panel.id = 'modal-space-filters';
    panel.className = 'market-sidepanel market-filter-panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Filter DNFTs in space');
    const filters = this.filters ||= { ...defaultFilters };
    panel.innerHTML = `<header><h2>DNFTs in space</h2><button type="button" data-close aria-label="Close filters">×</button></header>
      <label>Availability<select name="availability"><option value="sale">Listed for sale</option><option value="minted">All minted editions</option></select></label>
      <label>Show<select name="category"><option value="all">All DNFTs</option><option value="regular">Regular DNFTs</option><option value="supporter">Supporter DNFTs</option><option value="music">Music / video DNFTs</option></select></label>
      <label>Search<input name="search" type="search" placeholder="Title, artist, repository or token ID"></label>
      <p>Minted Market products and funded Base escrow editions, not every NFT on Base. For-sale view shows only offers verified ready to purchase. Unminted registrations are excluded.</p>
      <p role="status" data-listings></p>
      <button type="button" data-browse>Browse / purchase</button>
      <button type="button" data-reset>Reset filters</button><button type="button" data-reload>Refresh Base editions</button>
      <p role="status" data-count>Loading editions…</p>`;
    panel.querySelector('[name="category"]').value = filters.category;
    panel.querySelector('[name="availability"]').value = filters.availability;
    panel.querySelector('[data-listings]').textContent = this._listingStatus;
    panel.querySelector('[name="search"]').value = filters.search;
    const emit = () => {
      filters.category = panel.querySelector('[name="category"]').value;
      filters.availability = panel.querySelector('[name="availability"]').value;
      filters.search = panel.querySelector('[name="search"]').value;
      document.dispatchEvent(new CustomEvent('market:filters', { detail: { ...filters } }));
      if (filters.availability === 'minted') document.dispatchEvent(new Event('market:load-gallery'));
    };
    panel.querySelectorAll('select').forEach(select => { select.onchange = emit; });
    panel.querySelector('input').oninput = emit;
    panel.querySelector('[data-reset]').onclick = () => {
      panel.querySelector('[name="category"]').value = defaultFilters.category;
      panel.querySelector('[name="availability"]').value = defaultFilters.availability;
      panel.querySelector('input').value = ''; emit();
    };
    panel.querySelector('[data-reload]').onclick = () => {
      document.dispatchEvent(new Event('market:refresh-listings'));
      if (filters.availability === 'minted') document.dispatchEvent(new CustomEvent('market:load-gallery', { detail: { refresh: true } }));
    };
    panel.querySelector('[data-browse]').onclick = () => {
      panel.remove();
      openMarketCatalog(document.querySelector('decent-right-toolbar')._listedProducts);
    };
    const count = event => { panel.querySelector('[data-count]').textContent = `${event.detail.visible} shown / ${event.detail.total} loaded${event.detail.loading ? ' · loading…' : ''}${event.detail.error ? ` · ${event.detail.error}` : ''}`; };
    const close = () => panel.remove();
    const key = event => { if (event.key === 'Escape') close(); };
    panel.querySelector('[data-close]').onclick = close;
    document.addEventListener('market:filter-count', count);
    document.addEventListener('keydown', key);
    const observer = new MutationObserver(() => {
      if (!panel.isConnected) { document.removeEventListener('market:filter-count', count); document.removeEventListener('keydown', key); observer.disconnect(); }
    });
    document.body.append(panel); observer.observe(document.body, { childList: true });
    emit();
    panel.querySelector('select').focus();
  }
}

customElements.define('decent-left-toolbar', LeftToolbar);