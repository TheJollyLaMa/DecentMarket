class RightAnkhDropdown extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="../css/header.css" />
      <div class="ankh-wrapper">
        <div class="ankh-container">
          <span class="ankh-coin">☥</span>
          <div class="dropdown-menu right-ankh-menu" style="position: absolute; top: 100%; left: 50%; transform: translateX(-50%); display: none;">
            <div>
              <div class="token-balance">⧉ ⊙ ⚸ ⊙ ⧉</div>
              <div class="dropdown-option">
                <img src="./img/Uniswap_Logo.png" alt="Uni" class="dropdown-icon" />
                <a href="https://app.uniswap.org/explore/tokens/polygon/0x1a74f818F1b42dBFcE449c7Fa93B107C6e4A2433" target="_blank">
                  Buy/Sell on Uniswap
                </a>
              </div>
            </div>
          </div>
        </div>
        <span class="sparkle sparkle-top">✨</span>
        <span class="sparkle sparkle-bottom">✨</span>
        <span class="sparkle sparkle-left">✨</span>
        <span class="sparkle sparkle-right">✨</span>
      </div>
    `;

    this.setupDropdown();
  }

  async setupDropdown() {
    const ethers = window.ethers;

    const container = this.shadowRoot.querySelector('.ankh-coin');
    const popup = this.shadowRoot.querySelector('.dropdown-menu.right-ankh-menu');
    const balanceDiv = this.shadowRoot.querySelector('.token-balance');

    // Add "Share Data" option after existing dropdown-option
    const dropdownMenu = this.shadowRoot.querySelector('.dropdown-menu.right-ankh-menu > div');
    if (dropdownMenu) {
      // --- Share Data Option ---
      const shareOption = document.createElement('div');
      shareOption.className = 'dropdown-option';

      shareOption.innerHTML = `
        <span style="position: relative; display: inline-block; width: 22px; height: 22px; margin-right: 8px;">
          <img src="./img/Ommm.png" alt="Ommm" style="height: 12px; position: absolute; top: -5px; left: 0px; opacity: 0.9; box-shadow: 0 0 6px #00e5ff; border-radius: 50%; z-index: 10000" />
          <img src="./img/IPFS_Logo.png" alt="MetaMask" style="height: 16px; position: absolute; top: 4px; left: -10px; opacity: 0.6; z-index: 90000" />
          <img src="./img/MetaMaskFox.png" alt="IPFS" style="height: 16px; position: absolute; top: 4px; left: 12px; opacity: 0.6; z-index: 8000" />
        </span>
        <span style="flex-grow: 1;">Share Data</span>
        <label class="switch">
          <input type="checkbox">
          <span class="slider round"></span>
        </label>
      `;
      dropdownMenu.appendChild(shareOption);

      // --- Subscribe Option ---
      const subscribeOption = document.createElement('div');
      subscribeOption.className = 'dropdown-option';

      subscribeOption.innerHTML = `
        <span style="display: flex; align-items: center; gap: 4px; margin-right: 8px;">
          <img src="./img/Ommm.png" alt="Ommm" style="height: 16px; vertical-align: middle; box-shadow: 0 0 6px #00e5ff; border-radius: 50%;" />
          <span>0.42 Ommm</span>
        </span>
        <span style="flex-grow: 1;">Subscribe</span>
        <label class="switch">
          <input type="checkbox" id="subscribe-switch">
          <span class="slider round"></span>
        </label>
      `;
      dropdownMenu.appendChild(subscribeOption);

      const subscribeSwitch = subscribeOption.querySelector('#subscribe-switch');

      // Prevent both click and change from closing the dropdown, with diagnostics
      ['click', 'change'].forEach(eventType => {
        subscribeSwitch.addEventListener(eventType, (e) => {
          e.stopPropagation();
          console.log(`[${eventType}] triggered on subscribe switch`);

          if (eventType === 'change' && e.target.checked) {
            console.log('Checkbox is checked. Attempting to open modal...');
            // Query the modal from inside AppTitle's shadow DOM with delay
            setTimeout(() => {
              const appTitle = document.querySelector('app-title');
              const modal = appTitle?.shadowRoot?.querySelector('subscription-modal');
              if (modal) {
                console.log('subscription-modal found (delayed):', modal);
                modal.open?.();
                console.log('Called modal.open()');
              } else {
                console.warn('subscription-modal still not found in AppTitle shadowRoot');
              }
            }, 50);
          }
        });
      });

      document.addEventListener('click', (e) => {
        const composedPath = e.composedPath();
        if (!composedPath.includes(this)) {
          popup.style.display = 'none';
        }
      });

    }

    container?.addEventListener('click', (e) => {
      popup.style.display = popup.style.display === 'block' ? 'none' : 'block';
      e.stopPropagation();
    });

    document.addEventListener('click', () => {
      if (popup) popup.style.display = 'none';
    });

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = signer.address;

      const ommm = new ethers.Contract(
        '0x1a74f818F1b42dBFcE449c7Fa93B107C6e4A2433',
        [
          "function balanceOf(address owner) view returns (uint256)",
          "function decimals() view returns (uint8)"
        ],
        signer
      );

      const [raw, decimals] = await Promise.all([
        ommm.balanceOf(address),
        ommm.decimals()
      ]);
      
      const formatted = Number(ethers.formatUnits(raw, decimals)).toFixed(2);

      balanceDiv.innerHTML = `
        <span style="color:white; font-size:1.2rem;">
          <img src="./img/Ommm.png" alt="Ommm" style="height:35px; vertical-align:middle; box-shadow: 0 0 6px #00e5ff; border-radius: 50%;" />
          ${formatted}
        </span>
      `;
    } catch (err) {
      console.warn("Failed to get OMMM balance", err);
    }
  }
}

customElements.define('right-ankh', RightAnkhDropdown);