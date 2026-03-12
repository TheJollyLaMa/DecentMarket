import { SUPPORTED_CHAIN_IDS, getChainConfig } from '../../config/contracts.js';

export class WalletConnect extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.walletAddress = null;
    this.walletConnected = false;
    this.currentChainId = null;
    // Store references to important elements
    this.walletButton = null;
    this.walletDisplay = null;
    this.walletHoverDisplay = null;
    this.walletTickerCircle = null;
    this.networkBanner = null;
    // Bound listeners for cleanup
    this._onAccountsChanged = (accounts) => {
      this.walletAddress = accounts[0] || null;
      this.walletConnected = !!this.walletAddress;
      this.updateWalletUI();
      if (this.walletConnected) this.animateWalletTicker(this.walletAddress);
    };
    this._onChainChanged = (chainId) => {
      this.currentChainId = chainId;
      this.updateNetworkBanner();
    };
  }

  connectedCallback() {
    this.render();

    // Cache elements for use in methods
    this.walletButton = this.shadowRoot.getElementById('wallet-connect');
    this.walletDisplay = this.shadowRoot.getElementById('wallet-display');
    this.walletHoverDisplay = this.shadowRoot.getElementById('walletHoverDisplay');
    this.walletTickerCircle = this.shadowRoot.getElementById('wallet-ticker-circle');
    this.networkBanner = this.shadowRoot.getElementById('network-banner');

    // Attach click event for MetaMask connect
    if (window.ethereum) {
      this.walletButton.addEventListener('click', () => this.connectWallet());

      // Listen for account / chain changes
      window.ethereum.on('accountsChanged', this._onAccountsChanged);
      window.ethereum.on('chainChanged', this._onChainChanged);
    } else {
      this.walletButton.addEventListener('click', () => {
        alert('MetaMask not detected. Please install MetaMask!');
      });
    }

    // Auto-connect if already authorised on page reload
    if (window.ethereum && window.ethereum.selectedAddress) {
      this.walletAddress = window.ethereum.selectedAddress;
      this.walletConnected = true;
      window.ethereum.request({ method: 'eth_chainId' }).then((chainId) => {
        this.currentChainId = chainId;
        this.updateWalletUI();
        this.updateNetworkBanner();
      });
    }
  }

  disconnectedCallback() {
    if (window.ethereum) {
      window.ethereum.removeListener('accountsChanged', this._onAccountsChanged);
      window.ethereum.removeListener('chainChanged', this._onChainChanged);
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
        <link rel="stylesheet" href="css/header.css" />
        <div id="walletHeaderContainer" style="display: flex; align-items: center; justify-content: flex-end; height: 100px;">
          <div id="walletIconWrapper">
            <div class="ticker-wrapper wallet-ticker">
                <div class="ticker-circle-metamask" id="wallet-ticker-circle"></div>
            </div>
            <button id="wallet-connect" class="neon-button disconnected">
                <img id="metamaskIcon" src="img/MetaMaskFox.png" alt="Connect Wallet" />
            </button>
            <div id="wallet-display"></div>
            <div id="walletHoverDisplay" class="wallet-hover-display"></div>
          </div>
        </div>
        <div id="network-banner" class="network-banner"></div>
    `;
  }

  // Shorten Ethereum address for display
  shortenAddress(address) {
    if (!address || address.length < 10) return address;
    return address.substring(0, 6) + '...' + address.substring(address.length - 4);
  }

  // Connect to MetaMask, update UI
  async connectWallet() {
    if (!window.ethereum) {
      alert('MetaMask not detected. Please install MetaMask!');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      this.walletAddress = accounts[0];
      this.walletConnected = true;
      this.currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      this.updateWalletUI();
      this.updateNetworkBanner();
      // Animate the ticker
      this.animateWalletTicker(this.walletAddress);
      // Show the current weight display (global, outside shadow DOM)
      if (window.displayCurrentWeight) {
        window.displayCurrentWeight();
      } else {
        const weightDisplay = document.getElementById('current-weight-display');
        if (weightDisplay) weightDisplay.style.display = 'block';
      }
    } catch (err) {
      alert('Wallet connection failed.');
      this.walletConnected = false;
      this.walletAddress = null;
      this.currentChainId = null;
      this.updateWalletUI();
      this.updateNetworkBanner();
    }
  }

  /** Switch MetaMask to the first supported network (Polygon). */
  async switchToSupportedNetwork() {
    const targetChainId = SUPPORTED_CHAIN_IDS[0]; // Polygon
    const chainConfig = getChainConfig(targetChainId);
    if (!window.ethereum || !chainConfig) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainId }],
      });
    } catch (switchErr) {
      // Chain not yet added to wallet — add it
      if (switchErr.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: chainConfig.chainId,
              chainName: chainConfig.chainName,
              nativeCurrency: chainConfig.nativeCurrency,
              rpcUrls: chainConfig.rpcUrls,
              blockExplorerUrls: chainConfig.blockExplorerUrls,
            }],
          });
        } catch (addErr) {
          console.error('Failed to add network:', addErr);
        }
      }
    }
  }

  /** Render the network-status banner below the wallet button. */
  updateNetworkBanner() {
    if (!this.networkBanner) return;
    if (!this.walletConnected || !this.walletAddress) {
      this.networkBanner.innerHTML = '';
      this.networkBanner.className = 'network-banner';
      return;
    }
    const chainConfig = getChainConfig(this.currentChainId);
    if (chainConfig) {
      this.networkBanner.innerHTML = `
        <span class="network-dot connected-dot"></span>
        Connected to ${chainConfig.chainName}
        <br/>
        <span class="network-address">${this.shortenAddress(this.walletAddress)}</span>
      `;
      this.networkBanner.className = 'network-banner network-connected';
    } else {
      this.networkBanner.innerHTML = `
        <span class="network-dot wrong-dot"></span>
        Wrong network detected.<br/>
        Please switch to Polygon Mainnet.
        <br/>
        <button class="network-switch-btn" id="switch-network-btn">Switch to Polygon</button>
      `;
      this.networkBanner.className = 'network-banner network-wrong';
      // Use a single delegated listener on the banner to avoid accumulating
      // duplicate listeners each time this method is called.
      this.networkBanner.onclick = (e) => {
        if (e.target && e.target.id === 'switch-network-btn') {
          this.switchToSupportedNetwork();
        }
      };
    }
  }

  // Update wallet button, display, and styles based on connection
  updateWalletUI() {
    if (!this.walletButton || !this.walletDisplay) return;
    if (this.walletConnected && this.walletAddress) {
      this.walletButton.classList.remove('disconnected');
      this.walletButton.classList.add('connected');
      // Remove inline label, display nothing here
      this.walletDisplay.innerHTML = '';
      this.positionWalletLetters(this.walletAddress);
      // Add animation to ticker circle
      if (this.walletTickerCircle) {
        this.walletTickerCircle.classList.add('animated');
      }
    } else {
      this.walletButton.classList.remove('connected');
      this.walletButton.classList.add('disconnected');
      this.walletDisplay.innerHTML = '';
      // Remove ticker letters if any
      if (this.walletTickerCircle) {
        this.walletTickerCircle.innerHTML = '';
        this.walletTickerCircle.classList.remove('animated');
      }
    }
  }

  // Position wallet letters in a ticker circle
  positionWalletLetters(address) {
    if (!this.walletTickerCircle) return;
    this.walletTickerCircle.innerHTML = '';
    if (!address) return;
    // Show: first 6 chars, 4 logos, last 4 chars of the address (no 0x)
    const display = [
      ' ', '⚡️', ' ', '⚸', ' ', '⚡️', ' ',
      ...address.slice(0, 6),
      ' ', 'logo', ' ', 'logo', ' ', 'logo', ' ', 'logo', ' ',
      ...address.slice(-4),
    ];
    const n = display.length;
    const radius = 47; // px, fits the ticker circle
    const origin_x = 61; // nudged by 1px to better center
    const origin_y = 60;
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      const x = radius * Math.cos(angle) + origin_x;
      const y = radius * Math.sin(angle) + origin_y;
      if (display[i] === 'logo') {
        const img = document.createElement('img');
        img.src = 'img/Ens_Eth_Breathe.png';
        img.alt = 'breathe';
        img.className = 'ticker-letter-logo';
        img.style.left = `${x}px`;
        img.style.top = `${y}px`;
        img.style.position = 'absolute';
        img.style.width = '12px';
        img.style.height = '12px';
        img.style.padding = '4px';
        img.style.transform = `translate(-50%, -50%) rotate(${-angle}rad) rotate(90deg)`;
        this.walletTickerCircle.appendChild(img);
      } else {
        const span = document.createElement('span');
        span.className = 'ticker-letter';
        span.textContent = display[i];
        span.style.left = `${x}px`;
        span.style.top = `${y}px`;
        span.style.position = 'absolute';
        // Keep text upright: rotate opposite to angle, then rotate 90deg to lock upright
        span.style.transform = `translate(-50%, -50%) rotate(${-angle}rad) rotate(90deg)`;
        this.walletTickerCircle.appendChild(span);
      }
    }
  }

  // Animate ticker letters (simple shimmer or rotation)
  animateWalletTicker(address) {
    this.positionWalletLetters(address);
    // Optionally, add animation using CSS or JS (left as an exercise)
    // This demo only positions the letters statically
  }
}

customElements.define('wallet-connect', WalletConnect);