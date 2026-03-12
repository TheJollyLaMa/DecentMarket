/**
 * VersionSwitcher — displays the current app version and lets users
 * navigate to other deployed versions (e.g. v0.1 → v0.2).
 *
 * Version data is sourced from js/config/contracts.js (VERSIONS export).
 * Update that file when new versions are deployed.
 */

import { VERSIONS } from '../../config/contracts.js';

export class VersionSwitcher extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const buttons = VERSIONS.map(v => {
      const disabled = !v.available || v.current;
      const title = v.current
        ? 'Current version'
        : v.available
          ? `Switch to ${v.label}`
          : `${v.label} — coming soon`;
      return `
        <button
          class="version-btn${v.current ? ' active' : ''}${!v.available ? ' unavailable' : ''}"
          data-href="${v.href}"
          ${disabled ? 'disabled' : ''}
          ${v.current ? 'aria-current="page"' : ''}
          title="${title}"
        >${v.label}${!v.available ? ' 🔜' : ''}</button>
      `;
    }).join('');

    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="css/header.css" />
      <div class="version-switcher" role="navigation" aria-label="Version selector">
        <span class="version-label">ver:</span>
        ${buttons}
      </div>
    `;

    this.shadowRoot.querySelectorAll('.version-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const href = btn.dataset.href;
        if (href && !btn.classList.contains('active')) {
          window.location.href = href;
        }
      });
    });
  }
}

customElements.define('version-switcher', VersionSwitcher);
