import { CONTRACTS, SUPPORTED_CHAIN_IDS, getChainConfig, VERSIONS } from '../../config/contracts.js';

class RightToolbar extends HTMLElement {
  connectedCallback() {
    this.style.display = 'flex';
    this.style.flexDirection = 'column';
    this.style.alignItems = 'center';
    this.style.justifyContent = 'space-between';
    this.style.width = '50px';
    this.style.background = 'rgba(0, 0, 0, 0.6)';
    this.style.right = '0';
    this.style.zIndex = '999';
    this.style.padding = '20px 0';

    const buttonCount = 6;
    for (let i = 0; i < buttonCount; i++) {
      const btn = document.createElement('button');
      btn.style.width = '36px';
      btn.style.height = '36px';
      btn.style.borderRadius = '50%';
      btn.style.cursor = 'pointer';

      if (i === 0) {
        // Button 1: DNFT Control Panel
        btn.style.border = '2px solid #8b00ff';
        btn.style.background = 'black';
        btn.style.boxShadow = '0 0 10px #8b00ff';
        btn.innerHTML = `💎`;
        btn.title = 'DecentNFT Control Panel';
        btn.dataset.modal = 'modal-dnft';
        btn.addEventListener('click', () => this.showDNFTModal());
      } else {
        btn.style.border = '1px solid cyan';
        btn.style.background = 'black';
        btn.style.boxShadow = '0 0 10px cyan';
        btn.innerHTML = `💧`;
        btn.dataset.modal = `modal-right-${i + 1}`;
        btn.addEventListener('click', (e) => {
          this.showModal(e.target.dataset.modal);
        });
      }

      this.appendChild(btn);
    }
  }

  showModal(id) {
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
    modal.style.border = '2px solid cyan';
    modal.style.borderRadius = '12px';
    modal.style.boxShadow = '0 0 20px cyan';
    modal.style.zIndex = '2000';
    modal.style.color = 'white';
    modal.style.fontFamily = 'monospace';
    modal.style.textAlign = 'center';

    modal.innerHTML = `
      <h3>Modal: ${id}</h3>
      <p>This is a placeholder for <strong>${id}</strong></p>
      <button style="margin-top: 10px; padding: 6px 12px; border: 1px solid cyan; background: black; color: cyan;" onclick="document.body.removeChild(document.getElementById('${id}'))">Close</button>
    `;

    document.body.appendChild(modal);
  }

  // ── DNFT Control Panel Modal ────────────────────────────────────────────────

  async showDNFTModal() {
    // Remove any open modal first
    document.querySelectorAll('[id^="modal-"]').forEach(m => m.remove());

    const modal = document.createElement('div');
    modal.id = 'modal-dnft';
    Object.assign(modal.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '0',
      background: 'rgba(10, 0, 30, 0.97)',
      border: '2px solid #8b00ff',
      borderRadius: '14px',
      boxShadow: '0 0 30px #8b00ff, 0 0 60px rgba(139,0,255,0.3)',
      zIndex: '2000',
      color: 'white',
      fontFamily: 'monospace',
      minWidth: '320px',
      maxWidth: '420px',
      width: '90vw',
      overflow: 'hidden',
    });

    modal.innerHTML = this._buildModalHTML();
    document.body.appendChild(modal);

    // Wire up close
    modal.querySelector('#dnft-modal-close').addEventListener('click', () => modal.remove());

    // Wire up version dropdown
    const versionSelect = modal.querySelector('#dnft-version-select');
    versionSelect.addEventListener('change', () => {
      const selected = versionSelect.options[versionSelect.selectedIndex];
      if (selected.dataset.available === 'false') {
        const currentVersion = VERSIONS.find(v => v.current);
        versionSelect.value = currentVersion ? currentVersion.label : versionSelect.options[0].value;
        return;
      }
      if (selected.dataset.href) window.location.href = selected.dataset.href;
    });

    // Wire up wallet connect inside modal
    const connectBtn = modal.querySelector('#dnft-connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', () => this._connectWalletInModal(modal));
    }

    // Wire up network switch inside modal
    const switchBtn = modal.querySelector('#dnft-switch-network-btn');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => this._switchToPolygon(modal));
    }
  }

  _buildModalHTML() {
    const polygonCfg = CONTRACTS.polygon;

    // Wallet state (read from header WalletConnect or directly from ethereum)
    const address = window.ethereum?.selectedAddress || null;
    const isConnected = !!address;
    const chainId = window.ethereum?.chainId || null;
    const chainCfg = chainId ? getChainConfig(chainId) : null;
    const isOnPolygon = chainCfg && chainCfg.chainId === polygonCfg.chainId;

    // Shorten address
    const shortAddr = address
      ? address.substring(0, 6) + '...' + address.substring(address.length - 4)
      : null;

    // Wallet section HTML
    let walletSection;
    if (!isConnected) {
      walletSection = `
        <div style="margin-bottom: 8px; color: #aaa; font-size: 0.8rem;">No wallet connected</div>
        <button id="dnft-connect-btn" style="
          padding: 8px 18px;
          background: black;
          border: 1px solid #ff9800;
          border-radius: 6px;
          color: #ff9800;
          font-family: monospace;
          font-size: 0.8rem;
          cursor: pointer;
          box-shadow: 0 0 8px #ff9800;
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0 auto;
        ">
          <img src="img/MetaMaskFox.png" style="height:20px;" alt="MetaMask" />
          Connect MetaMask
        </button>
      `;
    } else if (!isOnPolygon) {
      walletSection = `
        <div style="margin-bottom: 6px; font-size: 0.78rem; color: #aaa;">
          Connected: <span style="color: #00e5ff;">${shortAddr}</span>
        </div>
        <div style="color: #ff5722; font-size: 0.78rem; margin-bottom: 8px;">
          ⚠️ Wrong network — please switch to Polygon
        </div>
        <button id="dnft-switch-network-btn" style="
          padding: 6px 14px;
          background: black;
          border: 1px solid #ff5722;
          border-radius: 6px;
          color: #ff5722;
          font-family: monospace;
          font-size: 0.78rem;
          cursor: pointer;
          box-shadow: 0 0 6px #ff5722;
        ">Switch to Polygon</button>
      `;
    } else {
      walletSection = `
        <div style="display: flex; align-items: center; gap: 8px; justify-content: center; margin-bottom: 4px;">
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#00e676; box-shadow: 0 0 5px #00e676;"></span>
          <span style="font-size: 0.85rem; color: #00e676;">Connected to Polygon</span>
        </div>
        <div style="font-size: 0.75rem; color: #00e5ff; letter-spacing: 0.05em;">${shortAddr}</div>
      `;
    }

    // Version options — driven by the centralized VERSIONS config
    const versionOptions = VERSIONS.map(v => `
      <option
        value="${v.label}"
        data-href="${v.href}"
        data-available="${v.available}"
        ${v.current ? 'selected' : ''}
        ${!v.available ? 'disabled' : ''}
      >${v.label} (${v.description})</option>
    `).join('');

    return `
      <!-- Header bar -->
      <div style="
        background: linear-gradient(90deg, #1a003a, #2d0060);
        padding: 14px 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #8b00ff;
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.4rem;">💎</span>
          <div>
            <div style="font-size: 1rem; font-weight: bold; color: #d0aaff; letter-spacing: 0.05em;">DecentNFT</div>
            <div style="font-size: 0.65rem; color: #8b5fcf;">Control Panel</div>
          </div>
        </div>
        <button id="dnft-modal-close" style="
          background: none;
          border: none;
          color: #8b5fcf;
          font-size: 1.2rem;
          cursor: pointer;
          line-height: 1;
          padding: 0;
        ">✕</button>
      </div>

      <div style="padding: 16px 18px; display: flex; flex-direction: column; gap: 14px;">

        <!-- Network section -->
        <div style="
          background: rgba(139,0,255,0.08);
          border: 1px solid #8b00ff44;
          border-radius: 8px;
          padding: 10px 14px;
        ">
          <div style="font-size: 0.65rem; color: #8b5fcf; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Network</div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <span style="font-size: 1.4rem;">🟣</span>
            <div>
              <div style="font-size: 0.85rem; color: #d0aaff;">${polygonCfg.chainName}</div>
              <div style="font-size: 0.65rem; color: #666;">Chain ID: ${parseInt(polygonCfg.chainId, 16)}</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div style="font-size: 0.65rem; color: #8b5fcf; text-transform: uppercase; letter-spacing: 0.08em;">Version</div>
            <select id="dnft-version-select" style="
              background: #0d0020;
              border: 1px solid #8b00ff;
              border-radius: 4px;
              color: #d0aaff;
              font-family: monospace;
              font-size: 0.75rem;
              padding: 3px 8px;
              cursor: pointer;
              flex: 1;
              max-width: 180px;
            ">${versionOptions}</select>
          </div>
        </div>

        <!-- Wallet section -->
        <div id="dnft-wallet-section" style="
          background: rgba(0,229,255,0.05);
          border: 1px solid #00e5ff33;
          border-radius: 8px;
          padding: 10px 14px;
          text-align: center;
        ">
          <div style="font-size: 0.65rem; color: #00a0b0; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px;">🦊 Wallet</div>
          ${walletSection}
        </div>

        <!-- DNFT Contract section -->
        <div style="
          background: rgba(139,0,255,0.05);
          border: 1px solid #8b00ff33;
          border-radius: 8px;
          padding: 10px 14px;
        ">
          <div style="font-size: 0.65rem; color: #8b5fcf; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px;">📄 DNFT Contract</div>
          <div style="font-size: 0.65rem; color: #666; margin-bottom: 4px;">${polygonCfg.chainName}</div>
          <div style="
            font-size: 0.72rem;
            color: #d0aaff;
            word-break: break-all;
            margin-bottom: 6px;
            letter-spacing: 0.02em;
          ">${polygonCfg.addresses.DNFT}</div>
          <a
            href="${polygonCfg.blockExplorerUrls[0]}/address/${polygonCfg.addresses.DNFT}"
            target="_blank"
            rel="noopener noreferrer"
            style="
              font-size: 0.68rem;
              color: #8b00ff;
              text-decoration: none;
              border-bottom: 1px dashed #8b00ff55;
            "
          >View on PolygonScan ↗</a>
        </div>

      </div>
    `;
  }

  async _connectWalletInModal(modal) {
    if (!window.ethereum) {
      alert('MetaMask not detected. Please install MetaMask!');
      return;
    }
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      // Refresh modal to reflect connection
      modal.remove();
      this.showDNFTModal();
    } catch (err) {
      // Show error inline in the wallet section
      const walletSection = modal.querySelector('#dnft-wallet-section');
      if (walletSection) {
        const errDiv = walletSection.querySelector('#dnft-connect-error') || document.createElement('div');
        errDiv.id = 'dnft-connect-error';
        errDiv.style.cssText = 'color:#ff5722; font-size:0.75rem; margin-top:8px;';
        errDiv.textContent = err.code === 4001
          ? 'Connection cancelled by user.'
          : 'Wallet connection failed. Please try again.';
        walletSection.appendChild(errDiv);
      }
    }
  }

  async _switchToPolygon(modal) {
    const targetChainId = CONTRACTS.polygon.chainId;
    const chainConfig = CONTRACTS.polygon;
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainId }],
      });
      // Refresh modal
      modal.remove();
      this.showDNFTModal();
    } catch (switchErr) {
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
          modal.remove();
          this.showDNFTModal();
        } catch (addErr) {
          console.error('Failed to add Polygon network:', addErr);
        }
      }
    }
  }
}

customElements.define('decent-right-toolbar', RightToolbar);