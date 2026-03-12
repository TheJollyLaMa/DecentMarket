/**
 * VersionSwitcher — displays the current app version and lets users
 * navigate to other deployed versions (e.g. v0.1 → v0.2).
 *
 * Versions are listed in the VERSIONS array below.  Each entry
 * needs a `label` (shown in the UI) and an `href` (the URL for
 * that deployment).  Set `current: true` on the active version.
 * Set `available: false` to show a version as "coming soon" and
 * disable its button until it is deployed.
 *
 * When a user clicks an available, non-current version button the
 * page is navigated to that URL, so each version can live on its
 * own GitHub Pages branch or subdirectory.
 */

const VERSIONS = [
  {
    label: 'v0.1',
    href: '/',       // current deployment root
    current: true,
    available: true,
  },
  {
    label: 'v0.2',
    href: '/v0.2/',  // update to the real URL once v0.2 is deployed
    current: false,
    available: false, // set to true when the deployment is live
  },
];

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
