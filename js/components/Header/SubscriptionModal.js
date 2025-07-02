class SubscriptionModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.shadowRoot.querySelector('.modal-close').addEventListener('click', () => {
      this.style.display = 'none';
    });
  }

  open() {
    this.style.display = 'flex';
  }

  render() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="../css/header.css" />
      <div class="modal-overlay">
        <div class="modal-content">
          <span class="modal-close">✖</span>
          <h2 style="text-align:center; color:#00e5ff;">Choose a Subscription Tier</h2>
          <div class="subscription-tiers">
            <!-- Tier 1 -->
            <div class="subscription-card">
              <img src="./img/IPFS_Logo.png" alt="Tier 1" />
              <h3>Tier 1: Donate</h3>
              <input type="number" placeholder="Enter donation amount" />
              <button>Donate with PayPal</button>
              <button>Donate with Crypto</button>
            </div>

            <!-- Tier 2 -->
            <div class="subscription-card">
              <img src="./img/IPFS_Logo.png" alt="Tier 2" />
              <h3>Tier 2: Data Registry Access</h3>
              <p>$10/month</p>
              <button>Subscribe</button>
            </div>

            <!-- Tier 3 -->
            <div class="subscription-card">
              <img src="./img/IPFS_Logo.png" alt="Tier 3" />
              <h3>Tier 3: Model Library Access</h3>
              <p>Includes Tier 2 + Data Models</p>
              <button>Subscribe</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('subscription-modal', SubscriptionModal);