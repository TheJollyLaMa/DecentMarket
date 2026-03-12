import './Header/IPFSStatus.js';
import './Header/AppTitle.js';
import './Header/WalletConnect.js';

class DecentHeader extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.setupHeaderEvents();
  }

  setupHeaderEvents() {
    const peacock = this.shadowRoot.querySelector('.peacock-emoji');
    const aboutModal = document.querySelector('about-modal');
    if (peacock && aboutModal) {
      peacock.addEventListener('click', () => {
        console.log('Peacock icon clicked');
        aboutModal.open();
      });
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
        <link rel="stylesheet" href="css/styles.css" />
        <link rel="stylesheet" href="css/header.css" />
        <header>
            <ipfs-status></ipfs-status>
            <app-title></app-title>
            <wallet-connect></wallet-connect>
        </header>
    `;
    // Removed: global waitingModal DOM injection. Modal is managed by IPFSStatus shadow DOM only.
  }
}

customElements.define('decent-header', DecentHeader);