import { CONTRACTS, getChainConfig, PAYPAL_CONFIG } from '../../config/contracts.js';
import {
  uploadFileToIPFS,
  uploadMetadataToIPFS,
  buildDNFTMetadata,
  validateDNFTFields,
} from '../../ipfs.js';

// js/components/DecentCanvas/RightToolbar.js
// Right-side toolbar with 4 main buttons:
// Button 1: 📜 Mint New DNFT (primary action)
// Button 2: ⚙️ Settings (power users / admin)
// Button 3: 🗿 Product Gallery
// Button 4: 🏦 Escrow Panel (DNFT marketplace + treasury)

// ── Minimal ABI subset used by the mint/role-check flow ──────────────────────
const DECENT_NFT_ABI = [
  // Roles
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  // Mint lanes
  "function mintProduct(address to, uint256 tokenId, uint256 amount)",
  "function mintAchievement(address to, uint256 tokenId, uint256 amount)",
  // Registration
  "function registerToken(uint256 maxSupply_, string tokenURI_, uint8 kind_, address royaltyReceiver, uint96 royaltyFeeBps) returns (uint256 tokenId)",
];

// ── Minimal ABI for DecentEscrow v0.1 ────────────────────────────────────────
const ESCROW_ABI = [
  "function owner() view returns (address)",
  "function getETHBalance() view returns (uint256)",
  "function getBalance(address token) view returns (uint256)",
  "function getNFTBalance(address nftContract, uint256 tokenId) view returns (uint256)",
  "function nextListingId() view returns (uint256)",
  "function nextPlanId() view returns (uint256)",
  "function getListing(uint256 listingId) view returns (tuple(address nftContract, uint256 tokenId, uint256 priceETH, address priceToken, uint256 priceAmount, uint256 available, bool active, string note))",
  "function getPlan(uint256 planId) view returns (tuple(string name, address paymentToken, uint256 pricePerPeriod, uint256 periodSeconds, bool active))",
  "function isSubscribed(uint256 planId, address account) view returns (bool)",
  "function depositETH(string note) payable",
  "function depositToken(address token, uint256 amount, string note)",
  "function withdrawETH(uint256 amount, string reason)",
  "function withdrawToken(address token, uint256 amount, string reason)",
  "function listDNFT(address nftContract, uint256 tokenId, uint256 priceETH, address priceToken, uint256 priceAmount, uint256 quantity, string note) returns (uint256 listingId)",
  "function delistDNFT(uint256 listingId)",
  "function purchaseWithETH(uint256 listingId, uint256 amount) payable",
  "function purchaseWithToken(uint256 listingId, uint256 amount)",
  "function createPlan(string name, address paymentToken, uint256 pricePerPeriod, uint256 periodSeconds) returns (uint256 planId)",
  "function deactivatePlan(uint256 planId)",
  "function subscribe(uint256 planId) payable",
  "function withdrawNFT(address nftContract, uint256 tokenId, uint256 amount, address to)",
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
];

// ── Known token addresses ─────────────────────────────────────────────────────
const USDC_OPTIMISM  = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"; // native USDC (Circle)
const USDCE_OPTIMISM = "0x7F5c764cBc14f9669B88837ca1490cCa17c31607"; // USDCe (bridged)

// Human-readable labels for known Optimism tokens
const KNOWN_TOKENS = {
  [USDC_OPTIMISM.toLowerCase()]:  "native USDC (Circle)",
  [USDCE_OPTIMISM.toLowerCase()]: "USDCe (bridged)",
};

// Values >= this threshold are displayed with an ETH equivalent (1 trillion wei = 0.000001 ETH).
const WEI_DISPLAY_THRESHOLD = 1_000_000_000_000n;

class RightToolbar extends HTMLElement {
  connectedCallback() {
    this._galleryCache = null;

    this.style.display = "flex";
    this.style.flexDirection = "column";
    this.style.alignItems = "center";
    this.style.justifyContent = "space-between";
    this.style.width = "50px";
    this.style.background = "rgba(0, 0, 0, 0.6)";
    this.style.right = "0";
    this.style.zIndex = "999";
    this.style.padding = "20px 0";

    // ── Button 1: 📜 Mint New DNFT ───────────────────────────────────────────
    const mintBtn = document.createElement("button");
    mintBtn.title = "Mint New DNFT";
    mintBtn.innerHTML = "📜";
    Object.assign(mintBtn.style, {
      width: "38px",
      height: "38px",
      borderRadius: "50%",
      border: "2px solid #00e676",
      background: "#000",
      boxShadow: "0 0 10px #00e676",
      cursor: "pointer",
      fontSize: "1.2rem",
    });
    mintBtn.addEventListener("click", () => this._openMintDNFTModal());
    this.appendChild(mintBtn);

    // ── Button 2: ⚙️ Settings ────────────────────────────────────────────────
    const settingsBtn = document.createElement("button");
    settingsBtn.title = "Settings";
    settingsBtn.innerHTML = "⚙️";
    Object.assign(settingsBtn.style, {
      width: "38px",
      height: "38px",
      borderRadius: "50%",
      border: "1px solid cyan",
      background: "#000",
      boxShadow: "0 0 10px cyan",
      cursor: "pointer",
      fontSize: "1.2rem",
    });
    settingsBtn.addEventListener("click", () => this._openSettingsPanel());
    this.appendChild(settingsBtn);

    // ── Button 3: 🗿 Product Gallery ─────────────────────────────────────────
    const galleryBtn = document.createElement("button");
    galleryBtn.title = "Product Gallery";
    galleryBtn.innerHTML = "🗿";
    Object.assign(galleryBtn.style, {
      width: "38px",
      height: "38px",
      borderRadius: "50%",
      border: "1px solid #ffd700",
      background: "#000",
      boxShadow: "0 0 10px #ffd700",
      cursor: "pointer",
      fontSize: "1.2rem",
    });
    galleryBtn.addEventListener("click", () => this._openProductGallery());
    this.appendChild(galleryBtn);

    // ── Button 4: 🏦 Escrow Panel ─────────────────────────────────────────────
    const escrowBtn = document.createElement("button");
    escrowBtn.title = "DecentEscrow — DNFT Marketplace & Treasury";
    escrowBtn.innerHTML = "🏦";
    Object.assign(escrowBtn.style, {
      width: "38px",
      height: "38px",
      borderRadius: "50%",
      border: "1px solid #00ff88",
      background: "#000",
      boxShadow: "0 0 10px #00ff88",
      cursor: "pointer",
      fontSize: "1.2rem",
    });
    escrowBtn.addEventListener("click", () => this._openEscrowPanel());
    this.appendChild(escrowBtn);

    // ── Listen for dnft:minted to live-refresh gallery ────────────────────────
    document.addEventListener("dnft:minted", (e) => {
      this._galleryCache = null;
      if (document.getElementById("modal-gallery")) {
        this._refreshGalleryWithMint(e.detail);
      }
    });

    // ── Listen for gallery:highlight-card to sync canvas → panel ─────────────
    document.addEventListener("gallery:highlight-card", (e) => {
      this._highlightGalleryCard(e.detail.tokenId);
    });
  }

  _clearModals() {
    document.querySelectorAll("[id^='modal-']").forEach((m) => m.remove());
  }

  // ── ⚙️ Settings panel ────────────────────────────────────────────────────
  async _openSettingsPanel() {
    this._clearModals();

    const chainId = window.ethereum?.chainId || null;
    const chainCfg = chainId ? getChainConfig(chainId) : null;
    const address = window.ethereum?.selectedAddress || null;
    const isConnected = !!address;
    const shortAddr = address ? address.slice(0, 6) + "…" + address.slice(-4) : null;

    const opCfg = CONTRACTS.optimism;
    const polygonCfg = CONTRACTS.polygon;

    const panel = document.createElement("div");
    panel.id = "modal-settings";
    Object.assign(panel.style, {
      position: "fixed",
      top: "110px",
      right: "60px",
      width: "320px",
      maxHeight: "calc(100vh - 170px)",
      overflowY: "auto",
      background: "rgba(0,5,20,0.97)",
      border: "2px solid cyan",
      borderRadius: "12px",
      boxShadow: "0 0 24px cyan, 0 0 8px #00e5ff",
      zIndex: "2000",
      color: "#fff",
      fontFamily: "monospace",
      fontSize: "0.78rem",
      padding: "0",
    });

    panel.innerHTML = `
      <!-- Header -->
      <div style="
        background:linear-gradient(90deg,#001525,#002540);
        padding:12px 16px;
        display:flex;align-items:center;justify-content:space-between;
        border-bottom:1px solid cyan;
        border-radius:10px 10px 0 0;
      ">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.3rem;">⚙️</span>
          <div>
            <div style="font-size:0.9rem;font-weight:bold;color:cyan;letter-spacing:0.05em;">Settings</div>
            <div style="font-size:0.6rem;color:#0088aa;">DecentMarket — Configuration</div>
          </div>
        </div>
        <button id="settings-close" style="background:none;border:none;color:#0088aa;font-size:1.1rem;cursor:pointer;line-height:1;padding:0;">✕</button>
      </div>

      <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;">

        <!-- Version badge -->
        <div style="
          background:rgba(0,229,255,0.06);
          border:1px solid #00e5ff33;
          border-radius:8px;
          padding:8px 12px;
          display:flex;align-items:center;justify-content:space-between;
        ">
          <span style="font-size:0.65rem;color:#0088aa;text-transform:uppercase;letter-spacing:0.1em;">DecentNFT Version</span>
          <span style="background:#00e5ff;color:#000;border-radius:4px;padding:2px 8px;font-size:0.7rem;font-weight:bold;">v0.2</span>
        </div>

        <!-- Network switcher -->
        <div style="
          background:rgba(0,229,255,0.04);
          border:1px solid #00e5ff22;
          border-radius:8px;
          padding:10px 12px;
        ">
          <div style="font-size:0.65rem;color:#0088aa;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">🌐 Network</div>
          <select id="settings-network-select" style="
            width:100%;background:#000;color:#00e5ff;
            border:1px solid #00e5ff88;border-radius:4px;
            padding:6px 8px;font-size:0.75rem;font-family:monospace;cursor:pointer;
          ">
            <option value="0xa" ${chainId === '0xa' ? 'selected' : ''}>🔴 Optimism (v0.2 — active)</option>
            <option value="0x89" ${chainId === '0x89' ? 'selected' : ''}>🟣 Polygon v0.1 (legacy)</option>
          </select>
          <div id="settings-chain-status" style="font-size:0.65rem;color:#888;margin-top:6px;"></div>
        </div>

        <!-- Active Contract -->
        <div style="
          background:rgba(0,229,255,0.04);
          border:1px solid #00e5ff22;
          border-radius:8px;
          padding:10px 12px;
        ">
          <div style="font-size:0.65rem;color:#0088aa;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">📄 Active Contract</div>
          <div style="font-size:0.7rem;color:#ff6680;margin-bottom:2px;">Optimism v0.2</div>
          <div style="
            font-size:0.68rem;color:#aaa;word-break:break-all;margin-bottom:6px;
            padding:4px 6px;background:rgba(0,0,0,0.3);border-radius:4px;
          ">${opCfg.addresses.DNFT}</div>
          <a href="${opCfg.blockExplorerUrls[0]}/address/${opCfg.addresses.DNFT}"
             target="_blank" rel="noopener noreferrer"
             style="font-size:0.65rem;color:#ff0420;text-decoration:none;border-bottom:1px dashed #ff042055;">
            View on Optimistic Etherscan ↗
          </a>

          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #00e5ff11;">
            <div style="font-size:0.7rem;color:#666;margin-bottom:2px;">Polygon v0.1 (legacy)</div>
            <div style="
              font-size:0.65rem;color:#666;word-break:break-all;margin-bottom:4px;
              padding:4px 6px;background:rgba(0,0,0,0.2);border-radius:4px;
            ">${polygonCfg.addresses.DNFT}</div>
            <a href="${polygonCfg.blockExplorerUrls[0]}/address/${polygonCfg.addresses.DNFT}"
               target="_blank" rel="noopener noreferrer"
               style="font-size:0.62rem;color:#8247e5;text-decoration:none;border-bottom:1px dashed #8247e555;">
              View on PolygonScan ↗
            </a>
          </div>
        </div>

        <!-- Wallet + Role -->
        <div style="
          background:rgba(0,229,255,0.04);
          border:1px solid #00e5ff22;
          border-radius:8px;
          padding:10px 12px;
        ">
          <div style="font-size:0.65rem;color:#0088aa;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">🦊 Wallet</div>
          <div id="settings-wallet-info">
            ${isConnected
              ? `<div style="font-size:0.75rem;color:#00e5ff;margin-bottom:4px;">${shortAddr}</div>`
              : `<div style="color:#888;font-size:0.75rem;margin-bottom:8px;">Not connected</div>
                 <button id="settings-connect-btn" style="
                   padding:6px 14px;background:#000;border:1px solid #ff9800;
                   border-radius:4px;color:#ff9800;font-family:monospace;
                   font-size:0.75rem;cursor:pointer;box-shadow:0 0 6px #ff9800;
                   display:flex;align-items:center;gap:6px;
                 ">
                   <img src="img/MetaMaskFox.png" style="height:16px;" alt="MetaMask"/>
                   Connect MetaMask
                 </button>`
            }
          </div>
          <div style="font-size:0.65rem;color:#0088aa;text-transform:uppercase;letter-spacing:0.1em;margin-top:8px;margin-bottom:4px;">Your Role</div>
          <div id="settings-role-status" style="
            padding:5px 8px;background:rgba(0,0,0,0.3);border:1px solid #333;
            border-radius:4px;min-height:22px;color:#888;font-size:0.72rem;
          ">
            ${isConnected ? 'Checking…' : 'Connect wallet to check role'}
          </div>
        </div>

      </div>
    `;

    document.body.appendChild(panel);

    // Close button — also removes the chainChanged listener
    const removeChainListener = () => {
      window.ethereum?.off?.("chainChanged", updateChainStatus);
    };
    panel.querySelector("#settings-close").onclick = () => {
      removeChainListener();
      panel.remove();
    };

    // Outside-click close
    setTimeout(() => {
      const outside = (e) => {
        if (!panel.contains(e.target) && !e.target.closest("decent-right-toolbar")) {
          removeChainListener();
          panel.remove();
          document.removeEventListener("click", outside);
        }
      };
      document.addEventListener("click", outside);
    }, 0);

    // Chain status display
    const chainStatusEl = panel.querySelector("#settings-chain-status");
    const updateChainStatus = async () => {
      if (!window.ethereum) {
        chainStatusEl.textContent = "No wallet detected";
        chainStatusEl.style.color = "#f80";
        return;
      }
      try {
        const id = await window.ethereum.request({ method: "eth_chainId" });
        const cfg = getChainConfig(id);
        if (cfg) {
          chainStatusEl.textContent = `✓ Connected to ${cfg.chainName}`;
          chainStatusEl.style.color = id === "0xa" ? "#ff0420" : "#8247e5";
        } else {
          chainStatusEl.textContent = `⚠️ Unknown network (${parseInt(id, 16)})`;
          chainStatusEl.style.color = "#f80";
        }
      } catch {
        chainStatusEl.textContent = "—";
      }
    };
    updateChainStatus();
    window.ethereum?.on?.("chainChanged", updateChainStatus);

    // Network switcher dropdown
    panel.querySelector("#settings-network-select").addEventListener("change", async (e) => {
      await this._switchChain(e.target.value, chainStatusEl);
    });

    // Connect button (shown when not connected)
    const connectBtn = panel.querySelector("#settings-connect-btn");
    if (connectBtn) {
      connectBtn.addEventListener("click", async () => {
        if (!window.ethereum) {
          alert("MetaMask not detected. Please install MetaMask!");
          return;
        }
        try {
          await window.ethereum.request({ method: "eth_requestAccounts" });
          panel.remove();
          this._openSettingsPanel();
        } catch (err) {
          const walletInfo = panel.querySelector("#settings-wallet-info");
          if (walletInfo) {
            let errEl = walletInfo.querySelector("#settings-connect-error");
            if (!errEl) {
              errEl = document.createElement("div");
              errEl.id = "settings-connect-error";
              errEl.style.cssText = "color:#f44;font-size:0.7rem;margin-top:6px;";
              walletInfo.appendChild(errEl);
            }
            errEl.textContent = err.code === 4001 ? "Cancelled by user." : "Connection failed.";
          }
        }
      });
    }

    // Auto-detect role if connected
    if (isConnected) {
      this._detectRole(panel.querySelector("#settings-role-status"), address);
    }
  }

  async _switchChain(hexId, statusEl) {
    if (!window.ethereum) return;
    const cfg = getChainConfig(hexId);
    if (!cfg) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexId }],
      });
      if (statusEl) {
        statusEl.textContent = `✓ Switched to ${cfg.chainName}`;
        statusEl.style.color = hexId === "0xa" ? "#ff0420" : "#8247e5";
      }
    } catch (err) {
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: cfg.chainId,
              chainName: cfg.chainName,
              nativeCurrency: cfg.nativeCurrency,
              rpcUrls: cfg.rpcUrls,
              blockExplorerUrls: cfg.blockExplorerUrls,
            }],
          });
          if (statusEl) {
            statusEl.textContent = `✓ Switched to ${cfg.chainName}`;
            statusEl.style.color = hexId === "0xa" ? "#ff0420" : "#8247e5";
          }
        } catch {
          if (statusEl) {
            statusEl.textContent = `✗ Failed to add network`;
            statusEl.style.color = "#f44";
          }
        }
      } else {
        if (statusEl) {
          statusEl.textContent = `✗ ${err.message || "Switch failed"}`;
          statusEl.style.color = "#f44";
        }
      }
    }
  }

  async _detectRole(roleEl, account) {
    const ethers = window.ethers;
    if (!roleEl || !ethers || !account) return;
    try {
      const contractAddr = CONTRACTS.optimism.addresses.DNFT;
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(contractAddr, DECENT_NFT_ABI, provider);
      const [adminRole, minterRole] = await Promise.all([
        contract.DEFAULT_ADMIN_ROLE(),
        contract.MINTER_ROLE(),
      ]);
      const [isAdmin, isMinter] = await Promise.all([
        contract.hasRole(adminRole, account),
        contract.hasRole(minterRole, account),
      ]);
      const parts = [];
      if (isAdmin) parts.push('<span style="color:#8247e5;">👑 ADMIN</span>');
      if (isMinter) parts.push('<span style="color:#00bcd4;">🏅 MINTER</span>');
      if (!isAdmin && !isMinter) parts.push('<span style="color:#888;">No privileged role</span>');
      roleEl.innerHTML = parts.join(" &nbsp; ");
    } catch (e) {
      roleEl.style.color = "#f44";
      roleEl.textContent = `Error: ${e.message}`;
    }
  }

  // ── 📜 Mint New DNFT modal ──────────────────────────────────────────────────
  _openMintDNFTModal() {
    this._clearModals();

    const modal = document.createElement("div");
    modal.id = "modal-mint-dnft";
    Object.assign(modal.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      padding: "0",
      background: "rgba(0, 10, 20, 0.97)",
      border: "2px solid #00e676",
      borderRadius: "14px",
      boxShadow: "0 0 30px #00e676, 0 0 60px rgba(0,230,118,0.2)",
      zIndex: "2000",
      color: "white",
      fontFamily: "monospace",
      minWidth: "340px",
      maxWidth: "440px",
      width: "92vw",
      maxHeight: "90vh",
      overflowY: "auto",
    });

    modal.innerHTML = this._buildMintModalHTML();
    document.body.appendChild(modal);
    this._wireMintModal(modal);
  }

  _buildMintModalHTML() {
    const address = window.ethereum?.selectedAddress || null;
    const shortAddr = address ? address.slice(0, 6) + "…" + address.slice(-4) : null;
    const isConnected = !!address;
    const opCfg = CONTRACTS.optimism;
    const contractLabel = opCfg.addresses.DNFT.slice(0, 10) + "…" + opCfg.addresses.DNFT.slice(-4);
    const escrowAddress = opCfg.addresses.ESCROW || "";

    return `
      <!-- Header -->
      <div style="
        background: linear-gradient(90deg, #002200, #004400);
        padding: 14px 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #00e676;
        border-radius: 12px 12px 0 0;
      ">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.4rem;">📜</span>
          <div>
            <div style="font-size:1rem;font-weight:bold;color:#00e676;letter-spacing:0.05em;">Mint New DNFT</div>
            <div style="font-size:0.62rem;color:#4caf50;">DecentNFT v0.2 — ERC-1155</div>
          </div>
        </div>
        <button id="mint-modal-close" style="
          background:none;border:none;color:#4caf50;font-size:1.2rem;cursor:pointer;line-height:1;padding:0;
        ">✕</button>
      </div>

      <!-- Wallet + Network status bar -->
      <div style="
        background:rgba(0,230,118,0.04);
        border-bottom:1px solid #00e67622;
        padding:8px 18px;
        display:flex;align-items:center;justify-content:space-between;gap:8px;
      ">
        <div id="mint-wallet-status" style="font-size:0.68rem;">
          ${isConnected
            ? `<span style="color:#00e676;">🦊 ${shortAddr}</span>`
            : `<span style="color:#f80;">🦊 Not connected</span>`
          }
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div id="mint-role-badge" style="font-size:0.65rem;color:#888;">—</div>
          <span style="
            background:rgba(255,4,32,0.12);color:#ff0420;
            border:1px solid #ff042044;border-radius:4px;
            padding:2px 6px;font-size:0.62rem;font-weight:bold;
          ">🔴 Optimism v0.2</span>
        </div>
      </div>

      <div style="padding:16px 18px;display:flex;flex-direction:column;gap:14px;">

        <!-- Image upload -->
        <div style="
          background:rgba(0,230,118,0.03);
          border:1px solid #00e67633;
          border-radius:8px;
          padding:10px 14px;
        ">
          <div style="font-size:0.62rem;color:#4caf50;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">
            🖼️ Image
          </div>

          <!-- Drop zone -->
          <div id="mint-dropzone" style="
            border:2px dashed #00e676;
            border-radius:8px;
            padding:16px;
            text-align:center;
            color:#4caf50;
            font-size:0.72rem;
            cursor:pointer;
            margin-bottom:8px;
            transition:background 0.15s;
          ">
            <div style="font-size:1.6rem;margin-bottom:4px;">📁</div>
            <div>Drag &amp; drop image here</div>
            <div style="color:#888;font-size:0.65rem;margin-top:2px;">or click to browse</div>
            <input id="mint-image-file" type="file" accept="image/*" style="display:none;"/>
          </div>

          <!-- Image preview -->
          <div id="mint-image-preview" style="display:none;margin-bottom:8px;text-align:center;">
            <img id="mint-preview-img" src="" alt="Preview" style="
              max-width:100%;max-height:120px;border-radius:6px;
              border:1px solid #00e676;object-fit:contain;
            "/>
            <div style="margin-top:4px;">
              <button id="mint-clear-image" style="
                background:#000;color:#f44;border:1px solid #f44;
                border-radius:4px;padding:2px 8px;font-size:0.65rem;
                font-family:monospace;cursor:pointer;
              ">✕ Clear</button>
            </div>
          </div>

          <!-- Separator -->
          <div style="display:flex;align-items:center;gap:6px;margin:8px 0;color:#555;font-size:0.65rem;">
            <div style="flex:1;height:1px;background:#333;"></div>OR<div style="flex:1;height:1px;background:#333;"></div>
          </div>

          <!-- Manual URI -->
          <div style="font-size:0.65rem;color:#888;margin-bottom:4px;">Image URI (IPFS or HTTPS)</div>
          <input id="mint-image-uri" type="text" placeholder="ipfs://… or https://…"
            style="
              width:100%;box-sizing:border-box;
              background:#000;color:#00e5ff;
              border:1px solid #00e67688;border-radius:4px;
              padding:5px 7px;font-size:0.72rem;font-family:monospace;
            "/>
        </div>

        <!-- Artifact upload -->
        <div style="
          background:rgba(0,230,118,0.03);
          border:1px solid #00e67633;
          border-radius:8px;
          padding:10px 14px;
        ">
          <div style="font-size:0.62rem;color:#4caf50;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">
            📦 Artifact
          </div>

          <!-- Artifact drop zone -->
          <div id="mint-artifact-dropzone" style="
            border:2px dashed #00e676;
            border-radius:8px;
            padding:12px;
            text-align:center;
            color:#4caf50;
            font-size:0.72rem;
            cursor:pointer;
            margin-bottom:8px;
            transition:background 0.15s;
          ">
            <div style="font-size:1.4rem;margin-bottom:4px;">🗜️</div>
            <div>Drag &amp; drop artifact here</div>
            <div style="color:#888;font-size:0.65rem;margin-top:2px;">zip/tar/any file — or paste CID below</div>
            <input id="mint-artifact-file" type="file" style="display:none;"/>
          </div>

          <!-- Artifact upload status -->
          <div id="mint-artifact-status" style="display:none;font-size:0.65rem;color:#00e676;margin-bottom:6px;word-break:break-all;"></div>

          <!-- Separator -->
          <div style="display:flex;align-items:center;gap:6px;margin:8px 0;color:#555;font-size:0.65rem;">
            <div style="flex:1;height:1px;background:#333;"></div>OR<div style="flex:1;height:1px;background:#333;"></div>
          </div>

          <!-- Manual Artifact CID -->
          <div style="font-size:0.65rem;color:#888;margin-bottom:4px;">Artifact CID (ipfs://…)</div>
          <input id="mint-artifact-cid" type="text" placeholder="ipfs://bafybei…"
            style="
              width:100%;box-sizing:border-box;
              background:#000;color:#00e5ff;
              border:1px solid #00e67688;border-radius:4px;
              padding:5px 7px;font-size:0.72rem;font-family:monospace;
            "/>
        </div>

        <!-- Metadata -->
        <div style="
          background:rgba(0,230,118,0.03);
          border:1px solid #00e67633;
          border-radius:8px;
          padding:10px 14px;
        ">
          <div style="font-size:0.62rem;color:#4caf50;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">
            📝 Metadata
          </div>
          <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">Name <span style="color:#f44;">*</span></div>
          <input id="mint-name" type="text" placeholder="e.g. My Product v1.0"
            style="
              width:100%;box-sizing:border-box;margin-bottom:8px;
              background:#000;color:#00e5ff;
              border:1px solid #00e676;border-radius:4px;
              padding:5px 7px;font-size:0.75rem;font-family:monospace;
            "/>
          <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">Description <span style="color:#f44;">*</span></div>
          <textarea id="mint-description" rows="2" placeholder="Describe your product or achievement…"
            style="
              width:100%;box-sizing:border-box;resize:vertical;margin-bottom:8px;
              background:#000;color:#00e5ff;
              border:1px solid #00e67688;border-radius:4px;
              padding:5px 7px;font-size:0.72rem;font-family:monospace;
            "></textarea>
          <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">GitHub / Repo URL</div>
          <input id="mint-repo-url" type="text" placeholder="https://github.com/…"
            style="
              width:100%;box-sizing:border-box;
              background:#000;color:#00e5ff;
              border:1px solid #00e67688;border-radius:4px;
              padding:5px 7px;font-size:0.72rem;font-family:monospace;
            "/>
        </div>

        <!-- Minting options -->
        <div style="
          background:rgba(0,230,118,0.03);
          border:1px solid #00e67633;
          border-radius:8px;
          padding:10px 14px;
        ">
          <div style="font-size:0.62rem;color:#4caf50;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">
            ⚙️ Options
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <div style="flex:1;">
              <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">Kind</div>
              <select id="mint-kind" style="
                width:100%;background:#000;color:#00e676;
                border:1px solid #00e67688;border-radius:4px;
                padding:5px 7px;font-size:0.72rem;font-family:monospace;cursor:pointer;
              ">
                <option value="0">🔮 Product</option>
                <option value="1">🏆 Achievement</option>
              </select>
            </div>
            <div style="flex:1;">
              <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">Max Supply <span style="color:#555;">(0=∞)</span></div>
              <input id="mint-max-supply" type="number" min="0" value="0"
                style="
                  width:100%;box-sizing:border-box;
                  background:#000;color:#00e5ff;
                  border:1px solid #00e67688;border-radius:4px;
                  padding:5px 7px;font-size:0.72rem;font-family:monospace;
                "/>
            </div>
            <div style="flex:1;">
              <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">Mint Quantity</div>
              <input id="mint-quantity" type="number" min="1" value="1"
                style="
                  width:100%;box-sizing:border-box;
                  background:#000;color:#00e5ff;
                  border:1px solid #00e67688;border-radius:4px;
                  padding:5px 7px;font-size:0.72rem;font-family:monospace;
                "/>
            </div>
          </div>
          <div style="font-size:0.6rem;color:#556;margin-bottom:8px;font-style:italic;">
            Max Supply = edition cap (on-chain limit). Mint Quantity = how many you receive now.
          </div>
          <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">Recipient <span style="color:#555;">(leave blank for your wallet)</span></div>
          <input id="mint-recipient" type="text" placeholder="0x… (defaults to connected wallet)"
            style="
              width:100%;box-sizing:border-box;
              background:#000;color:#00e5ff;
              border:1px solid #00e67688;border-radius:4px;
              padding:5px 7px;font-size:0.72rem;font-family:monospace;
            "/>
        </div>

        <!-- Escrow & List option -->
        ${escrowAddress ? `<div id="mint-escrow-section" style="
          background:rgba(0,255,136,0.03);
          border:1px solid #00ff8833;
          border-radius:8px;
          padding:10px 14px;
        ">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:0;">
            <input id="mint-escrow-toggle" type="checkbox" style="width:15px;height:15px;cursor:pointer;accent-color:#00ff88;"/>
            <span style="font-size:0.72rem;color:#00ff88;font-weight:bold;">🏦 Send to Escrow &amp; List after minting</span>
          </label>
          <div id="mint-escrow-fields" style="display:none;margin-top:10px;">
            <div style="font-size:0.62rem;color:#00aa66;margin-bottom:8px;line-height:1.5;">
              Mint → transfer to escrow → list for sale, all in one flow.<br/>
              <span style="color:#556;">NFT will be minted to your wallet first, then sent to escrow.</span>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
              <div style="flex:1;">
                <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">Price ETH <span style="color:#555;">(0 = none)</span></div>
                <input id="mint-escrow-price-eth" type="number" min="0" step="0.001" value="0"
                  style="width:100%;box-sizing:border-box;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:5px 7px;font-size:0.72rem;font-family:monospace;"/>
              </div>
              <div style="flex:1;">
                <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">Price USDC <span style="color:#555;">(0 = none)</span></div>
                <input id="mint-escrow-price-usdc" type="number" min="0" step="1" value="0"
                  style="width:100%;box-sizing:border-box;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:5px 7px;font-size:0.72rem;font-family:monospace;"/>
              </div>
            </div>
            <div style="font-size:0.65rem;color:#888;margin-bottom:3px;">Listing Note</div>
            <input id="mint-escrow-note" type="text" placeholder='e.g. "DecentHead v1.0 Supporter DNFT"'
              style="width:100%;box-sizing:border-box;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:5px 7px;font-size:0.72rem;font-family:monospace;"/>
          </div>
        </div>` : ''}

        <!-- Contract info (read-only) -->
        <div style="
          background:rgba(0,230,118,0.03);
          border:1px solid #00e67622;
          border-radius:8px;
          padding:8px 14px;
          font-size:0.65rem;
          color:#555;
        ">
          📄 Contract: <span style="color:#00e676;">${contractLabel}</span>
          <span style="color:#888;"> — Optimism v0.2</span>
        </div>

        <!-- Submit -->
        <button id="mint-submit-btn" style="
          width:100%;padding:10px;border-radius:8px;
          border:2px solid #00e676;background:#000;
          color:#00e676;font-family:monospace;font-size:0.85rem;
          cursor:pointer;box-shadow:0 0 12px #00e676;
          letter-spacing:0.05em;font-weight:bold;
          transition:all 0.15s;
        ">✨ Mint DNFT</button>

        <!-- Status -->
        <div id="mint-status" style="
          min-height:20px;font-size:0.72rem;
          color:#888;word-break:break-all;text-align:center;
        "></div>

        <!-- DNFT Contract Function Explorer -->
        <div id="dnft-fn-explorer" style="margin-top:8px;"></div>

      </div>
    `;
  }

  _wireMintModal(modal) {
    const ethers = window.ethers;

    // Auto-detect wallet + role in the status bar
    const _onAccountsChanged = () => this._refreshMintModalHeader(modal);
    window.ethereum?.on?.("accountsChanged", _onAccountsChanged);

    const _closeModal = () => {
      window.ethereum?.off?.("accountsChanged", _onAccountsChanged);
      modal.remove();
    };

    modal.querySelector("#mint-modal-close").onclick = _closeModal;

    // Close on outside click
    const _outsideClick = (e) => {
      if (!modal.contains(e.target) && !e.target.closest("decent-right-toolbar")) {
        _closeModal();
        document.removeEventListener("click", _outsideClick);
      }
    };
    setTimeout(() => document.addEventListener("click", _outsideClick), 0);

    this._refreshMintModalHeader(modal);

    // ── Image upload / drag-drop ────────────────────────────────────────────
    const dropzone = modal.querySelector("#mint-dropzone");
    const fileInput = modal.querySelector("#mint-image-file");
    const previewBox = modal.querySelector("#mint-image-preview");
    const previewImg = modal.querySelector("#mint-preview-img");
    const clearBtn = modal.querySelector("#mint-clear-image");
    const imageUriInput = modal.querySelector("#mint-image-uri");
    let selectedFile = null;

    const showPreview = (file) => {
      selectedFile = file;
      const url = URL.createObjectURL(file);
      previewImg.src = url;
      previewBox.style.display = "block";
      dropzone.style.display = "none";
      imageUriInput.value = "";
    };

    const clearImage = () => {
      selectedFile = null;
      previewImg.src = "";
      previewBox.style.display = "none";
      dropzone.style.display = "block";
      fileInput.value = "";
    };

    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) showPreview(fileInput.files[0]);
    });
    clearBtn.addEventListener("click", clearImage);

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.style.background = "rgba(0,230,118,0.1)";
    });
    dropzone.addEventListener("dragleave", () => {
      dropzone.style.background = "";
    });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.style.background = "";
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) showPreview(file);
    });

    // ── Artifact upload / drag-drop ─────────────────────────────────────────
    const artifactDropzone = modal.querySelector("#mint-artifact-dropzone");
    const artifactFileInput = modal.querySelector("#mint-artifact-file");
    const artifactStatusEl = modal.querySelector("#mint-artifact-status");
    const artifactCidInput = modal.querySelector("#mint-artifact-cid");
    let selectedArtifactFile = null;

    const showArtifactSelected = (file) => {
      selectedArtifactFile = file;
      artifactDropzone.style.background = "rgba(0,230,118,0.06)";
      artifactStatusEl.style.display = "block";
      artifactStatusEl.textContent = `📦 Selected: ${file.name} — will upload on mint`;
      artifactCidInput.value = "";
    };

    artifactDropzone.addEventListener("click", () => artifactFileInput.click());
    artifactFileInput.addEventListener("change", () => {
      if (artifactFileInput.files[0]) showArtifactSelected(artifactFileInput.files[0]);
    });
    artifactDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      artifactDropzone.style.background = "rgba(0,230,118,0.1)";
    });
    artifactDropzone.addEventListener("dragleave", () => {
      if (!selectedArtifactFile) artifactDropzone.style.background = "";
    });
    artifactDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      artifactDropzone.style.background = "";
      const file = e.dataTransfer.files[0];
      if (file) showArtifactSelected(file);
    });

    // ── Submit / Mint ───────────────────────────────────────────────────────
    const submitBtn = modal.querySelector("#mint-submit-btn");
    const statusEl = modal.querySelector("#mint-status");

    // ── Escrow & List toggle ────────────────────────────────────────────────
    const escrowToggle = modal.querySelector("#mint-escrow-toggle");
    const escrowFields = modal.querySelector("#mint-escrow-fields");
    if (escrowToggle) {
      escrowToggle.addEventListener("change", () => {
        escrowFields.style.display = escrowToggle.checked ? "block" : "none";
        submitBtn.textContent = escrowToggle.checked ? "✨ Mint + Escrow & List" : "✨ Mint DNFT";
      });
    }

    const setStatus = (msg, color = "#888") => {
      statusEl.style.color = color;
      statusEl.textContent = msg;
    };

    submitBtn.addEventListener("click", async () => {
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.6";
      statusEl.textContent = "";

      try {
        const name = modal.querySelector("#mint-name").value.trim();
        const description = modal.querySelector("#mint-description").value.trim();
        const repoUrl = modal.querySelector("#mint-repo-url").value.trim();
        const kind = parseInt(modal.querySelector("#mint-kind").value);
        const kindLabel = kind === 0 ? "Product" : "Achievement";
        const maxSupply = BigInt(modal.querySelector("#mint-max-supply").value || "0");
        const mintQty = BigInt(modal.querySelector("#mint-quantity").value || "1");
        const recipientInput = modal.querySelector("#mint-recipient").value.trim();
        const imageUri = imageUriInput.value.trim();
        const sendToEscrow = modal.querySelector("#mint-escrow-toggle")?.checked ?? false;

        // ── Validate mint quantity ────────────────────────────────────────────
        if (mintQty <= 0n) throw new Error("Mint Quantity must be greater than 0.");
        if (maxSupply > 0n && mintQty > maxSupply) {
          throw new Error(`Mint Quantity (${mintQty}) cannot exceed Max Supply (${maxSupply}).`);
        }

        // ── Connect wallet ────────────────────────────────────────────────
        if (!window.ethereum) throw new Error("MetaMask not found. Please install MetaMask.");
        setStatus("🔗 Connecting wallet…");
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        const account = await signer.getAddress();

        // ── Auto-resolve Optimism v0.2 contract ───────────────────────────
        const contractAddr = CONTRACTS.optimism.addresses.DNFT;
        if (!contractAddr || !ethers.isAddress(contractAddr)) {
          throw new Error("Optimism v0.2 contract address not configured.");
        }

        // ── Upload image to IPFS (if file selected) ───────────────────────
        let finalImageUri = imageUri;
        if (selectedFile) {
          setStatus("📤 Uploading image to IPFS…");
          try {
            finalImageUri = await uploadFileToIPFS(selectedFile);
          } catch (ipfsErr) {
            throw new Error(
              `Image upload failed: ${ipfsErr.message}. Enter an image URI manually instead.`
            );
          }
        }

        // ── Upload artifact to IPFS (if file selected) ────────────────────
        let finalArtifactCid = artifactCidInput.value.trim();
        if (selectedArtifactFile) {
          setStatus("📤 Uploading artifact to IPFS…");
          try {
            finalArtifactCid = await uploadFileToIPFS(selectedArtifactFile);
          } catch (artifactErr) {
            throw new Error(
              `Artifact upload failed: ${artifactErr.message}. Enter an artifact CID manually instead.`
            );
          }
        }

        // ── Validate required fields before uploading metadata ────────────
        validateDNFTFields({ name, description, image: finalImageUri });

        // ── Build OpenSea-compliant metadata JSON ─────────────────────────
        const metadata = buildDNFTMetadata({
          name,
          description,
          image: finalImageUri,
          kind: kindLabel,
          ...(kindLabel === "Product" && {
            product: {
              version:      "",
              repo_url:     repoUrl,
              commit:       "",
              artifact_cid: finalArtifactCid,
              opensea_url:  "",
            },
          }),
        });

        setStatus("📤 Uploading metadata to IPFS…");
        let tokenUri;
        try {
          tokenUri = await uploadMetadataToIPFS(metadata);
        } catch (metaErr) {
          throw new Error(`Metadata upload failed: ${metaErr.message}`);
        }

        // ── Register token on-chain ───────────────────────────────────────
        setStatus("📝 Registering token on-chain…");
        const REGISTER_ABI = [
          "function registerToken(uint256 maxSupply_, string tokenURI_, uint8 kind_, address royaltyReceiver, uint96 royaltyFeeBps) returns (uint256 tokenId)",
          "event TokenRegistered(uint256 indexed tokenId, address indexed creator, uint256 maxSupply, uint8 kind, string uri)",
        ];
        const contract = new ethers.Contract(contractAddr, REGISTER_ABI, signer);

        const regTx = await contract.registerToken(
          maxSupply,
          tokenUri,
          kind,
          ethers.ZeroAddress,
          0
        );
        setStatus(`📝 Registering… tx ${regTx.hash.slice(0, 12)}…`);
        const regReceipt = await regTx.wait();

        // Parse tokenId from TokenRegistered event
        const iface = new ethers.Interface(REGISTER_ABI);
        const tokenRegisteredTopic = iface.getEvent("TokenRegistered").topicHash;
        let tokenId = null;
        for (const log of regReceipt.logs) {
          if (log.topics[0] !== tokenRegisteredTopic) continue;
          const parsed = iface.parseLog({ topics: log.topics, data: log.data });
          if (parsed && parsed.name === "TokenRegistered") {
            tokenId = parsed.args.tokenId;
            break;
          }
        }
        if (tokenId === null) {
          throw new Error("Could not determine tokenId from transaction receipt.");
        }

        // ── Mint the registered token ─────────────────────────────────────
        // If escrow+list is requested, always mint to the connected wallet first
        const recipient = (!sendToEscrow && recipientInput && ethers.isAddress(recipientInput))
          ? recipientInput
          : account;

        const MINT_ABI = [
          "function mintProduct(address to, uint256 tokenId, uint256 amount)",
          "function mintAchievement(address to, uint256 tokenId, uint256 amount)",
          "event EditionMinted(uint256 indexed tokenId, address indexed to, uint256 amount, address indexed minter)",
        ];
        const mintContract = new ethers.Contract(contractAddr, MINT_ABI, signer);
        const mintFn = kind === 0 ? "mintProduct" : "mintAchievement";

        setStatus(`🔮 Minting ${mintQty} × token #${tokenId}…`);
        const mintTx = await mintContract[mintFn](recipient, tokenId, mintQty);
        setStatus(`🔮 Minting… tx ${mintTx.hash.slice(0, 12)}…`);
        const mintReceipt = await mintTx.wait();

        // ── Escrow & List (optional) ──────────────────────────────────────
        if (sendToEscrow) {
          const escrowAddress = CONTRACTS.optimism.addresses.ESCROW;
          if (!escrowAddress || !ethers.isAddress(escrowAddress)) {
            throw new Error("Escrow contract address not configured for Optimism.");
          }

          const priceETHStr = modal.querySelector("#mint-escrow-price-eth").value.trim() || "0";
          const priceUSDCStr = modal.querySelector("#mint-escrow-price-usdc").value.trim() || "0";
          const priceETHWei = ethers.parseEther(priceETHStr);
          const priceUSDCAmount = ethers.parseUnits(priceUSDCStr, 6);
          const listingNote = modal.querySelector("#mint-escrow-note").value.trim() || name;

          if (priceETHWei === 0n && priceUSDCAmount === 0n) {
            throw new Error("Set at least one price (ETH or USDC) for the escrow listing.");
          }

          // Transfer NFT to escrow (ERC-1155 safeTransferFrom)
          const ERC1155_TRANSFER_ABI = [
            "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
          ];
          const nftForTransfer = new ethers.Contract(contractAddr, ERC1155_TRANSFER_ABI, signer);
          setStatus(`🏦 Transferring ${mintQty} × Token #${tokenId} to escrow…`);
          // "0x" = empty bytes data, required by ERC-1155 safeTransferFrom
          const transferTx = await nftForTransfer.safeTransferFrom(account, escrowAddress, tokenId, mintQty, "0x");
          setStatus(`🏦 Transferring… tx ${transferTx.hash.slice(0, 12)}…`);
          await transferTx.wait();

          // Create listing in escrow
          const priceToken = priceUSDCAmount > 0n ? USDC_OPTIMISM : ethers.ZeroAddress;
          const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
          setStatus(`📋 Creating escrow listing…`);
          const listTx = await escrowContract.listDNFT(
            contractAddr,
            tokenId,
            priceETHWei,
            priceToken,
            priceUSDCAmount,
            mintQty,
            listingNote
          );
          setStatus(`📋 Listing… tx ${listTx.hash.slice(0, 12)}…`);
          await listTx.wait();
        }

        // ── Success! ──────────────────────────────────────────────────────
        const successMsg = sendToEscrow
          ? `✅ Minted, escrowed & listed ${mintQty} × Token #${tokenId} · Block ${mintReceipt.blockNumber}`
          : `✅ Minted ${mintQty} × Token #${tokenId} · Block ${mintReceipt.blockNumber}`;
        setStatus(successMsg, "#00e676");
        submitBtn.textContent = sendToEscrow ? "✅ Minted + Listed!" : "✅ Minted!";
        submitBtn.style.borderColor = "#00e676";
        submitBtn.style.color = "#00e676";

        // Dispatch gallery-refresh event
        document.dispatchEvent(
          new CustomEvent("dnft:minted", {
            detail: {
              tokenId: tokenId.toString(),
              tokenUri,
              name,
              description,
              imageUri: finalImageUri,
              repoUrl,
              artifactCid: finalArtifactCid,
              txHash: mintReceipt.hash,
              blockNumber: mintReceipt.blockNumber,
            },
          })
        );

        // Auto-close after 4 seconds, then show toast
        setTimeout(() => {
          _closeModal();
          this._showMintToast({
            name,
            tokenId: tokenId.toString(),
            txHash: mintReceipt.hash,
            quantity: mintQty.toString(),
            escrowed: sendToEscrow,
          });
        }, 4000);
      } catch (err) {
        setStatus(`✗ ${err.reason || err.message}`, "#f44");
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
      }
    });

    // Wire the DNFT contract function explorer at the bottom of the modal
    const dnftAddress = CONTRACTS.optimism.addresses.DNFT;
    this._wireDNFTFnExplorer(modal, dnftAddress);
  }

  async _refreshMintModalHeader(modal) {
    if (!modal || !modal.isConnected) return;
    const ethers = window.ethers;
    const walletStatusEl = modal.querySelector("#mint-wallet-status");
    const roleBadgeEl = modal.querySelector("#mint-role-badge");
    if (!walletStatusEl || !roleBadgeEl || !ethers) return;

    const accounts = window.ethereum
      ? await window.ethereum.request({ method: "eth_accounts" }).catch(() => [])
      : [];
    const account = accounts[0] || null;

    if (!account) {
      walletStatusEl.innerHTML = `<span style="color:#f80;">🦊 Not connected</span>`;
      roleBadgeEl.textContent = "—";
      return;
    }

    const shortAddr = account.slice(0, 6) + "…" + account.slice(-4);
    walletStatusEl.innerHTML = `<span style="color:#00e676;">🦊 ${shortAddr}</span>`;
    roleBadgeEl.textContent = "Checking…";

    try {
      const contractAddr = CONTRACTS.optimism.addresses.DNFT;
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(contractAddr, DECENT_NFT_ABI, provider);
      const [adminRole, minterRole] = await Promise.all([
        contract.DEFAULT_ADMIN_ROLE(),
        contract.MINTER_ROLE(),
      ]);
      const [isAdmin, isMinter] = await Promise.all([
        contract.hasRole(adminRole, account),
        contract.hasRole(minterRole, account),
      ]);
      if (isAdmin) {
        roleBadgeEl.innerHTML = `<span style="color:#8247e5;">👑 ADMIN</span>`;
      } else if (isMinter) {
        roleBadgeEl.innerHTML = `<span style="color:#00bcd4;">🏅 MINTER</span>`;
      } else {
        roleBadgeEl.innerHTML = `<span style="color:#888;">no role</span>`;
      }
    } catch {
      roleBadgeEl.innerHTML = `<span style="color:#888;">—</span>`;
    }
  }

  // ── Success toast notification ──────────────────────────────────────────
  _showMintToast({ name, tokenId, txHash, quantity, escrowed }) {
    const existing = document.getElementById("dnft-mint-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "dnft-mint-toast";
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "30px",
      right: "70px",
      background: "rgba(0, 20, 10, 0.97)",
      border: `2px solid ${escrowed ? "#00ff88" : "#00e676"}`,
      borderRadius: "10px",
      boxShadow: `0 0 20px ${escrowed ? "#00ff88" : "#00e676"}`,
      padding: "12px 16px",
      zIndex: "3000",
      color: "#fff",
      fontFamily: "monospace",
      fontSize: "0.78rem",
      maxWidth: "300px",
      animation: "dnft-toast-in 0.3s ease",
    });

    // Inject keyframe animation once
    if (!document.getElementById("dnft-toast-style")) {
      const style = document.createElement("style");
      style.id = "dnft-toast-style";
      style.textContent = `
        @keyframes dnft-toast-in {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    const headline = escrowed
      ? `✅ Minted + Escrowed &amp; Listed ${quantity ? quantity + " × " : ""}${name || "DNFT"}`
      : `✅ Minted ${quantity ? quantity + " × " : ""}${name || "DNFT"}`;
    const subtitle = escrowed
      ? `Token #${tokenId} — now live in the marketplace`
      : `Token #${tokenId}${quantity && Number(quantity) !== 1 ? ` (${quantity} editions)` : ""}`;

    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span style="font-size:1.4rem;">${escrowed ? "🏦" : "📜"}</span>
        <div>
          <div style="color:${escrowed ? "#00ff88" : "#00e676"};font-weight:bold;">${headline}</div>
          <div style="color:#aaa;font-size:0.68rem;">${subtitle}</div>
        </div>
        <button id="toast-close" style="
          margin-left:auto;background:none;border:none;color:#555;
          font-size:1rem;cursor:pointer;line-height:1;padding:0;
        ">✕</button>
      </div>
      <div style="color:#555;font-size:0.65rem;word-break:break-all;">
        tx: ${txHash ? txHash.slice(0, 20) + "…" : "confirmed"}
      </div>
    `;

    document.body.appendChild(toast);
    toast.querySelector("#toast-close").onclick = () => toast.remove();

    // Auto-dismiss after 8 seconds
    setTimeout(() => toast.remove(), 8000);
  }

  // ── 🗿 Product Gallery ────────────────────────────────────────────────────

  async _openProductGallery() {
    // Toggle: if panel is already open, close it
    const existing = document.getElementById("modal-gallery");
    if (existing) {
      existing.remove();
      return;
    }
    this._clearModals();

    const panel = document.createElement("div");
    panel.id = "modal-gallery";
    Object.assign(panel.style, {
      position: "fixed",
      top: "60px",
      right: "60px",
      width: "360px",
      maxHeight: "calc(100vh - 120px)",
      overflowY: "auto",
      background: "rgba(0,5,20,0.97)",
      border: "1px solid #ffd700",
      borderRadius: "12px",
      boxShadow: "0 0 24px #ffd700, 0 0 8px #b8860b",
      zIndex: "2000",
      color: "#fff",
      fontFamily: "monospace",
      fontSize: "0.78rem",
      padding: "0",
    });

    panel.innerHTML = `
      <div style="
        background:linear-gradient(90deg,#1a1200,#2a2000);
        padding:12px 16px;
        display:flex;align-items:center;justify-content:space-between;
        border-bottom:1px solid #ffd700;
        border-radius:12px 12px 0 0;
        position:sticky;top:0;z-index:1;
      ">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.3rem;">🗿</span>
          <div>
            <div style="font-size:0.9rem;font-weight:bold;color:#ffd700;letter-spacing:0.05em;">Product Gallery</div>
            <div style="font-size:0.6rem;color:#a07800;">Live on-chain DNFT browser</div>
          </div>
        </div>
        <button id="gallery-close" style="background:none;border:none;color:#a07800;font-size:1.1rem;cursor:pointer;line-height:1;padding:0;">✕</button>
      </div>
      <div id="gallery-body" style="padding:12px;">
        <div style="text-align:center;padding:24px;color:#888;">⏳ Loading on-chain products…</div>
      </div>
    `;

    document.body.appendChild(panel);
    panel.querySelector("#gallery-close").onclick = () => panel.remove();

    try {
      const products = await this._loadGalleryProducts();
      this._renderGalleryCards(products);
      // Signal canvas to place products at depth positions
      document.dispatchEvent(new CustomEvent("gallery:products-loaded", { detail: { products } }));
    } catch (err) {
      const body = document.getElementById("gallery-body");
      if (body) {
        body.innerHTML = `<div style="color:#f44;padding:16px;text-align:center;">⚠️ Failed to load: ${err.message}</div>`;
      }
    }
  }

  // ── Fetch all Product DNFTs from the Optimism contract ───────────────────
  // Uses view functions (nextTokenId, kindOf, uri, totalMinted, maxSupply) instead
  // of eth_getLogs so we never hit the RPC block-range limit.
  async _loadGalleryProducts() {
    if (this._galleryCache) return this._galleryCache;

    const ethers = window.ethers;
    if (!ethers) throw new Error("ethers.js not loaded");

    const opCfg = CONTRACTS.optimism;
    const contractAddr = opCfg.addresses.DNFT;

    const QUERY_ABI = [
      "function nextTokenId() view returns (uint256)",
      "function kindOf(uint256 tokenId) view returns (uint8)",
      "function uri(uint256 tokenId) view returns (string)",
      "function totalMinted(uint256 tokenId) view returns (uint256)",
      "function maxSupply(uint256 tokenId) view returns (uint256)",
      "function creatorOf(uint256 tokenId) view returns (address)",
    ];

    const provider = new ethers.JsonRpcProvider(opCfg.rpcUrls[0]);
    const contract = new ethers.Contract(contractAddr, QUERY_ABI, provider);

    const nextId = await contract.nextTokenId();
    const count = Number(nextId);

    const products = [];
    for (let i = 0; i < count; i++) {
      const tokenId = BigInt(i);
      let kind;
      try {
        kind = await contract.kindOf(tokenId);
      } catch (err) {
        console.warn(`Gallery: failed to fetch kindOf for token #${i}:`, err);
        continue;
      }
      // kind 0 = Product, kind 1 = Achievement — only show Products
      if (Number(kind) !== 0) continue;

      let uri = "";
      let maxSupplyCount = "0";
      let totalMintedCount = "0";
      try {
        [uri, maxSupplyCount, totalMintedCount] = await Promise.all([
          contract.uri(tokenId).then(v => v).catch(() => ""),
          contract.maxSupply(tokenId).then(v => v.toString()).catch(() => "0"),
          contract.totalMinted(tokenId).then(v => v.toString()).catch(() => "0"),
        ]);
      } catch (err) {
        console.warn(`Gallery: failed to fetch data for token #${i}:`, err);
      }

      let metadata = null;
      if (uri) {
        try {
          const metaUrl = this._resolveIpfsUrl(uri);
          const resp = await fetch(metaUrl);
          if (resp.ok) metadata = await resp.json();
        } catch (err) {
          console.warn(`Gallery: failed to fetch metadata for token #${i} (${uri}):`, err);
        }
      }
      if (!metadata) {
        metadata = { name: `Token #${i}`, description: "", image: "" };
      }

      products.push({
        tokenId: i.toString(),
        maxSupply: maxSupplyCount,
        totalMinted: totalMintedCount,
        uri,
        // tokenId is registration order — lower = older; sort newest-first below
        blockNumber: i,
        metadata,
      });
    }

    // Newest first (highest tokenId registered last)
    products.sort((a, b) => b.blockNumber - a.blockNumber);
    this._galleryCache = products;
    return products;
  }

  // ── Render all gallery cards ──────────────────────────────────────────────
  _renderGalleryCards(products) {
    const body = document.getElementById("gallery-body");
    if (!body) return;

    if (products.length === 0) {
      body.innerHTML = `<div style="text-align:center;padding:24px;color:#888;">No products minted yet</div>`;
      return;
    }

    body.innerHTML = "";
    for (const product of products) {
      body.appendChild(this._buildGalleryCard(product));
    }
  }

  // ── Build a single gallery card element ──────────────────────────────────
  _buildGalleryCard(product) {
    const { tokenId, maxSupply, totalMinted: tm, metadata } = product;
    const name = metadata?.name || `Token #${tokenId}`;
    const description = metadata?.description || "";
    const imageUri = metadata?.image || "";
    const displayImg = this._resolveIpfsUrl(imageUri);
    const repoUrl = metadata?.properties?.product?.repo_url || "";
    const artifactCid = metadata?.properties?.product?.artifact_cid || "";
    const version = metadata?.properties?.product?.version || "";

    const card = document.createElement("div");
    card.id = `gallery-card-${tokenId}`;
    card.dataset.tokenId = tokenId;
    Object.assign(card.style, {
      background: "rgba(255,215,0,0.04)",
      border: "1px solid #ffd70033",
      borderRadius: "8px",
      padding: "10px",
      marginBottom: "8px",
      cursor: "pointer",
      transition: "border-color 0.2s, box-shadow 0.2s",
    });

    card.addEventListener("mouseenter", () => {
      if (!card.classList.contains("gallery-card-active")) {
        card.style.borderColor = "#ffd70088";
        card.style.boxShadow = "0 0 8px #ffd70033";
      }
    });
    card.addEventListener("mouseleave", () => {
      if (!card.classList.contains("gallery-card-active")) {
        card.style.borderColor = "#ffd70033";
        card.style.boxShadow = "none";
      }
    });

    const safeRepo = repoUrl && this._isSafeGalleryUrl(repoUrl) ? repoUrl : "";
    const safeArtifact = artifactCid ? this._resolveIpfsUrl(artifactCid) : "";

    card.innerHTML = `
      <div style="display:flex;gap:10px;align-items:flex-start;">
        ${displayImg
          ? `<img src="${displayImg}" alt="${name}" style="width:60px;height:60px;object-fit:contain;border-radius:6px;border:1px solid #ffd70044;flex-shrink:0;" loading="lazy">`
          : `<div style="width:60px;height:60px;background:#111;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;flex-shrink:0;">🗿</div>`
        }
        <div style="flex:1;min-width:0;">
          <div style="font-weight:bold;color:#ffd700;font-size:0.82rem;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
          ${version ? `<div style="color:#a07800;font-size:0.65rem;margin-bottom:3px;">v${version}</div>` : ""}
          ${description ? `<div style="color:#aaa;font-size:0.68rem;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${description}</div>` : ""}
        </div>
      </div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        <span style="color:#666;font-size:0.62rem;">Token #${tokenId}</span>
        <span style="color:#444;font-size:0.62rem;">·</span>
        <span style="color:#666;font-size:0.62rem;">${tm}/${maxSupply} minted</span>
      </div>
      <div style="margin-top:7px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${safeRepo ? `<a href="${safeRepo}" target="_blank" rel="noopener noreferrer" style="color:#00e5ff;font-size:0.65rem;text-decoration:none;">📦 Repo</a>` : ""}
        ${safeArtifact ? `<a href="${safeArtifact}" target="_blank" rel="noopener noreferrer" style="color:#00e5ff;font-size:0.65rem;text-decoration:none;">⬇️ Artifact</a>` : ""}
        <button data-fly-tokenid="${tokenId}" style="margin-left:auto;background:rgba(255,215,0,0.1);border:1px solid #ffd700;color:#ffd700;border-radius:4px;padding:2px 8px;font-size:0.65rem;cursor:pointer;font-family:monospace;">🚀 Fly to</button>
      </div>
    `;

    card.querySelector(`[data-fly-tokenid="${tokenId}"]`).addEventListener("click", (e) => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent("gallery:fly-to", { detail: { tokenId } }));
      this._highlightGalleryCard(tokenId);
    });

    return card;
  }

  // ── Highlight a gallery card (canvas → panel sync) ────────────────────────
  _highlightGalleryCard(tokenId) {
    document.querySelectorAll(".gallery-card-active").forEach((c) => {
      c.classList.remove("gallery-card-active");
      c.style.borderColor = "#ffd70033";
      c.style.boxShadow = "none";
    });

    const card = document.getElementById(`gallery-card-${tokenId}`);
    if (card) {
      card.classList.add("gallery-card-active");
      card.style.borderColor = "#ffd700";
      card.style.boxShadow = "0 0 14px #ffd70066";
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // ── Prepend newly minted product without reload ───────────────────────────
  _refreshGalleryWithMint(detail) {
    const { tokenId, tokenUri, name, description, imageUri, repoUrl, artifactCid, blockNumber } = detail;

    const newProduct = {
      tokenId: tokenId.toString(),
      uri: tokenUri || "",
      blockNumber: blockNumber || 0,
      maxSupply: "0",
      totalMinted: "1",
      metadata: {
        name: name || `Token #${tokenId}`,
        description: description || "",
        image: imageUri || "",
        properties: {
          product: {
            repo_url: repoUrl || "",
            artifact_cid: artifactCid || "",
          },
        },
      },
    };

    if (this._galleryCache) {
      this._galleryCache.unshift(newProduct);
    }

    const body = document.getElementById("gallery-body");
    if (body) {
      // Replace "no products" placeholder if present
      if (body.querySelector("[data-no-products]")) body.innerHTML = "";
      body.insertBefore(this._buildGalleryCard(newProduct), body.firstChild);
    }

    document.dispatchEvent(new CustomEvent("gallery:products-loaded", {
      detail: { products: this._galleryCache || [newProduct] },
    }));
  }

  // ── Resolve ipfs:// URI to an HTTP gateway URL ────────────────────────────
  _resolveIpfsUrl(uri) {
    if (!uri) return "";
    if (uri.startsWith("ipfs://")) {
      const withoutProto = uri.slice(7);
      const slashIdx = withoutProto.indexOf("/");
      if (slashIdx === -1) {
        return `https://${withoutProto}.ipfs.w3s.link/`;
      }
      const cid = withoutProto.slice(0, slashIdx);
      const path = withoutProto.slice(slashIdx);
      return `https://${cid}.ipfs.w3s.link${path}`;
    }
    return uri;
  }

  // ── Safe URL check (prevents XSS via javascript: etc.) ───────────────────
  _isSafeGalleryUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }

  // ── 🏦 Escrow Panel ───────────────────────────────────────────────────────

  async _openEscrowPanel() {
    // Toggle
    const existing = document.getElementById("modal-escrow");
    if (existing) { existing.remove(); return; }
    this._clearModals();

    const chainId = window.ethereum?.chainId || null;
    const chainCfg = chainId ? getChainConfig(chainId) : null;
    const escrowAddress = chainCfg?.addresses?.ESCROW || "";
    const userAddress = window.ethereum?.selectedAddress || null;

    const panel = document.createElement("div");
    panel.id = "modal-escrow";
    Object.assign(panel.style, {
      position: "fixed",
      top: "60px",
      right: "60px",
      width: "380px",
      maxHeight: "calc(100vh - 120px)",
      overflowY: "auto",
      background: "rgba(0,5,20,0.97)",
      border: "1px solid #00ff88",
      borderRadius: "12px",
      boxShadow: "0 0 24px #00ff88, 0 0 8px #00cc66",
      zIndex: "2000",
      color: "#fff",
      fontFamily: "monospace",
      fontSize: "0.78rem",
      padding: "0",
    });

    panel.innerHTML = `
      <div style="
        background:linear-gradient(90deg,#001508,#002510);
        padding:12px 16px;
        display:flex;align-items:center;justify-content:space-between;
        border-bottom:1px solid #00ff88;
        border-radius:12px 12px 0 0;
      ">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:1.4rem;">🏦</span>
          <div>
            <div style="font-size:0.9rem;font-weight:bold;color:#00ff88;letter-spacing:0.05em;">DecentEscrow</div>
            <div style="font-size:0.6rem;color:#008844;">DNFT Marketplace + Treasury</div>
          </div>
        </div>
        <button id="escrow-close" style="background:none;border:none;color:#008844;font-size:1.1rem;cursor:pointer;line-height:1;padding:0;">✕</button>
      </div>

      <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;">

        <!-- Contract address -->
        <div style="background:rgba(0,255,136,0.05);border:1px solid #00ff8833;border-radius:8px;padding:10px 12px;">
          <div style="font-size:0.65rem;color:#008844;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">📍 Contract Address</div>
          ${escrowAddress
            ? `<div style="color:#00ff88;font-size:0.7rem;word-break:break-all;">${escrowAddress}</div>
               <a href="https://optimistic.etherscan.io/address/${escrowAddress}" target="_blank" rel="noopener noreferrer"
                  style="color:#00cc66;font-size:0.65rem;text-decoration:none;display:inline-block;margin-top:4px;">↗ Optimistic Etherscan</a>`
            : `<div style="color:#888;font-size:0.7rem;">⚠ Not yet deployed — see <a href="docs/ESCROW.md" style="color:#00cc66;">docs/ESCROW.md</a> for Remix instructions</div>`
          }
        </div>

        <!-- Balances -->
        <div id="escrow-balances" style="background:rgba(0,255,136,0.04);border:1px solid #00ff8822;border-radius:8px;padding:10px 12px;">
          <div style="font-size:0.65rem;color:#008844;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">💰 Balances</div>
          <div id="escrow-balance-body" style="color:#888;font-size:0.7rem;">
            ${escrowAddress ? "Loading…" : "Connect wallet & deploy contract first"}
          </div>
        </div>

        <!-- Active Listings -->
        <div style="background:rgba(0,255,136,0.04);border:1px solid #00ff8822;border-radius:8px;padding:10px 12px;">
          <div style="font-size:0.65rem;color:#008844;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">🛒 DNFT Listings</div>
          <div id="escrow-listings" style="color:#888;font-size:0.7rem;">
            ${escrowAddress ? "Loading…" : "—"}
          </div>
        </div>

        <!-- Subscriptions -->
        <div style="background:rgba(0,255,136,0.04);border:1px solid #00ff8822;border-radius:8px;padding:10px 12px;">
          <div style="font-size:0.65rem;color:#008844;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">🔁 Subscription Plans</div>
          <div id="escrow-plans" style="color:#888;font-size:0.7rem;">
            ${escrowAddress ? "Loading…" : "—"}
          </div>
        </div>

        <!-- Owner actions -->
        <div id="escrow-owner-section" style="display:none;">
          <div style="font-size:0.65rem;color:#008844;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">🔑 Owner Actions</div>

          <!-- Withdraw ETH -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid #00ff8811;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
            <div style="font-size:0.65rem;color:#008844;margin-bottom:4px;">Withdraw ETH</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <input id="escrow-withdraw-eth-amount" placeholder="amount (ETH)" style="flex:1;min-width:80px;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <input id="escrow-withdraw-eth-reason" placeholder="reason" style="flex:2;min-width:120px;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <button id="escrow-withdraw-eth-btn" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:4px 10px;font-size:0.7rem;cursor:pointer;font-family:monospace;">↑ Withdraw</button>
            </div>
          </div>

          <!-- Withdraw ERC-20 -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid #00ff8811;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
            <div style="font-size:0.65rem;color:#008844;margin-bottom:4px;">Withdraw ERC-20</div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <input id="escrow-withdraw-token-address" placeholder="token contract address" style="background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <input id="escrow-withdraw-token-amount" placeholder="amount (in token units)" style="flex:1;min-width:80px;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
                <input id="escrow-withdraw-token-decimals" placeholder="decimals (e.g. 6)" style="width:80px;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <input id="escrow-withdraw-token-reason" placeholder="reason" style="flex:1;min-width:120px;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
                <button id="escrow-withdraw-token-btn" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:4px 10px;font-size:0.7rem;cursor:pointer;font-family:monospace;">↑ Withdraw</button>
              </div>
            </div>
          </div>

          <!-- Deposit NFT into Escrow -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid #00ff8811;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
            <div style="font-size:0.65rem;color:#008844;margin-bottom:4px;">Deposit NFT into Escrow <span style="color:#555;">(Step 1 — send NFTs before listing)</span></div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <input id="escrow-deposit-nft-contract" placeholder="NFT contract address" style="background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <div style="display:flex;gap:6px;">
                <input id="escrow-deposit-nft-token-id" placeholder="tokenId" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
                <input id="escrow-deposit-nft-amount" placeholder="qty" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              </div>
              <button id="escrow-deposit-nft-btn" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:5px 10px;font-size:0.7rem;cursor:pointer;font-family:monospace;">↓ Deposit NFT to Escrow</button>
            </div>
          </div>

          <!-- List DNFT -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid #00ff8811;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
            <div style="font-size:0.65rem;color:#008844;margin-bottom:4px;">List a DNFT for Purchase <span style="color:#555;">(Step 2 — after depositing NFTs)</span></div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <input id="escrow-list-nft-contract" placeholder="NFT contract address" style="background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <div style="display:flex;gap:6px;">
                <input id="escrow-list-token-id" placeholder="tokenId" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
                <input id="escrow-list-qty" placeholder="qty" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              </div>
              <div style="display:flex;gap:6px;">
                <input id="escrow-list-price-eth" placeholder="priceETH (ETH, 0=none)" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
                <input id="escrow-list-price-usdc" placeholder="priceUSDC (0=none)" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              </div>
              <input id="escrow-list-note" placeholder='note, e.g. "DecentHead v1.0 Supporter DNFT"' style="background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <button id="escrow-list-btn" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:5px 10px;font-size:0.7rem;cursor:pointer;font-family:monospace;">+ Create Listing</button>
            </div>
          </div>

          <!-- Delist DNFT -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid #00ff8811;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
            <div style="font-size:0.65rem;color:#008844;margin-bottom:4px;">Delist DNFT</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <input id="escrow-delist-id" placeholder="listingId" style="flex:1;min-width:80px;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <button id="escrow-delist-btn" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:4px 10px;font-size:0.7rem;cursor:pointer;font-family:monospace;">✕ Delist</button>
            </div>
          </div>

          <!-- Withdraw NFT -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid #00ff8811;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
            <div style="font-size:0.65rem;color:#008844;margin-bottom:4px;">Withdraw NFT (reclaim unsold)</div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <input id="escrow-withdraw-nft-contract" placeholder="NFT contract address" style="background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <div style="display:flex;gap:6px;">
                <input id="escrow-withdraw-nft-token-id" placeholder="tokenId" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
                <input id="escrow-withdraw-nft-amount" placeholder="amount" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <input id="escrow-withdraw-nft-to" placeholder="recipient address" style="flex:1;min-width:120px;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
                <button id="escrow-withdraw-nft-btn" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:4px 10px;font-size:0.7rem;cursor:pointer;font-family:monospace;">↑ Withdraw NFT</button>
              </div>
            </div>
          </div>

          <!-- Create Subscription Plan -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid #00ff8811;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
            <div style="font-size:0.65rem;color:#008844;margin-bottom:4px;">Create Subscription Plan</div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <input id="escrow-plan-name" placeholder='plan name, e.g. "Pro Monthly"' style="background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <input id="escrow-plan-token" placeholder="payment token address (0x0…0 for ETH)" style="background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <div style="display:flex;gap:6px;">
                <input id="escrow-plan-price" placeholder="price (ETH or token units)" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
                <input id="escrow-plan-decimals" placeholder="decimals (e.g. 6)" style="width:80px;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
                <input id="escrow-plan-period" placeholder="period (seconds)" style="flex:1;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              </div>
              <button id="escrow-plan-create-btn" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:5px 10px;font-size:0.7rem;cursor:pointer;font-family:monospace;">+ Create Plan</button>
            </div>
          </div>

          <!-- Deactivate Subscription Plan -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid #00ff8811;border-radius:6px;padding:8px 10px;">
            <div style="font-size:0.65rem;color:#008844;margin-bottom:4px;">Deactivate Plan</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <input id="escrow-plan-deactivate-id" placeholder="planId" style="flex:1;min-width:80px;background:#001508;color:#00ff88;border:1px solid #00ff8844;border-radius:4px;padding:4px 6px;font-size:0.7rem;font-family:monospace;" />
              <button id="escrow-plan-deactivate-btn" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:4px 10px;font-size:0.7rem;cursor:pointer;font-family:monospace;">✕ Deactivate</button>
            </div>
          </div>
        </div>

        <!-- Contract Function Explorer -->
        <div id="escrow-fn-explorer"></div>

        <!-- Status / feedback -->
        <div id="escrow-status" style="font-size:0.68rem;color:#888;min-height:1rem;text-align:center;"></div>

      </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector("#escrow-close").onclick = () => panel.remove();
    document.addEventListener("keydown", function _esc(e) {
      if (e.key === "Escape") { panel.remove(); document.removeEventListener("keydown", _esc); }
    });

    if (escrowAddress && window.ethereum) {
      this._loadEscrowData(panel, escrowAddress, userAddress);
    }

    // Wire owner-action buttons once data is loaded (they may appear after async)
    this._wireEscrowOwnerActions(panel, escrowAddress);
    this._wireEscrowFnExplorer(panel, escrowAddress);
  }

  async _loadEscrowData(panel, escrowAddress, userAddress) {
    const statusEl = panel.querySelector("#escrow-status");
    const balanceEl = panel.querySelector("#escrow-balance-body");
    const listingsEl = panel.querySelector("#escrow-listings");
    const plansEl = panel.querySelector("#escrow-plans");
    const ownerSection = panel.querySelector("#escrow-owner-section");

    try {
      const ethers = window.ethers;
      if (!ethers) {
        statusEl.textContent = "⚠ ethers.js not loaded — ensure the script tag is present in index.html";
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, provider);

      // ── Resolve actual connected address asynchronously ──────────────────
      // window.ethereum.selectedAddress is not reliably populated in modern wallets;
      // use provider.listAccounts() to get the current address.
      let resolvedUserAddress = userAddress;
      try {
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) resolvedUserAddress = await accounts[0].getAddress();
      } catch { /* keep the passed value if the call fails */ }

      // ── Balances ──────────────────────────────────────────────────────────
      const [ethBal, ownerAddr] = await Promise.all([
        escrow.getETHBalance(),
        escrow.owner(),
      ]);

      let usdcBal = 0n;
      try { usdcBal = await escrow.getBalance(USDC_OPTIMISM); } catch { /* ignore */ }

      balanceEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
          <span style="color:#888;">ETH</span>
          <span style="color:#00ff88;">${parseFloat(ethers.formatEther(ethBal)).toFixed(4)} ETH</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#888;">USDC</span>
          <span style="color:#00ff88;">${(Number(usdcBal / 1000n) / 1000).toFixed(2)} USDC</span>
        </div>
        <div style="margin-top:6px;font-size:0.62rem;color:#555;">Owner: <span style="color:#00cc66;">${ownerAddr.slice(0,6)}…${ownerAddr.slice(-4)}</span></div>
      `;

      // Show owner section if connected wallet is owner
      if (resolvedUserAddress && ownerAddr.toLowerCase() === resolvedUserAddress.toLowerCase()) {
        ownerSection.style.display = "block";
      }

      // ── Listings ──────────────────────────────────────────────────────────
      const listingCount = await escrow.nextListingId();
      const listings = [];

      // Fetch live ETH/USD rate for dynamic PayPal pricing (best-effort)
      const ethUsdRate = await this._fetchEthUsdPrice();
      for (let i = 0; i < Number(listingCount); i++) {
        const raw = await escrow.getListing(i);
        // ethers.js v6 returns structs as Result (array-like); spread copies only
        // numeric indices, not named fields. Explicitly extract each named field.
        const l = {
          id:          i,
          nftContract: raw.nftContract,
          tokenId:     raw.tokenId,
          priceETH:    raw.priceETH,
          priceToken:  raw.priceToken,
          priceAmount: raw.priceAmount,
          available:   raw.available,
          active:      raw.active,
          note:        raw.note,
        };
        if (l.active) listings.push(l);
      }

      if (listings.length === 0) {
        listingsEl.innerHTML = `<div style="color:#555;font-style:italic;">No active listings</div>`;
      } else {
        // Check escrow's actual NFT balance for each listing before rendering buy buttons
        const nftBalances = await Promise.all(
          listings.map(l => escrow.getNFTBalance(l.nftContract, l.tokenId).catch(err => {
            console.warn(`getNFTBalance failed for listing ${l.id}:`, err);
            return 0n;
          }))
        );

        listingsEl.innerHTML = listings.map((l, idx) => {
          const hasStock = nftBalances[idx] > 0n;
          const tokenLabel = l.priceToken
            ? (KNOWN_TOKENS[l.priceToken.toLowerCase()] || `token ${l.priceToken.slice(0,6)}…${l.priceToken.slice(-4)}`)
            : "token";

          // Compute the PayPal USD price for this listing.
          // PayPal is only offered for ETH-priced or USDC/USDCe-priced listings.
          const isUsdcToken = l.priceToken && (
            l.priceToken.toLowerCase() === USDC_OPTIMISM.toLowerCase() ||
            l.priceToken.toLowerCase() === USDCE_OPTIMISM.toLowerCase()
          );
          let paypalUsdPrice = null;
          if (l.priceETH > 0n && ethUsdRate !== null) {
            const ethAmount = parseFloat(ethers.formatEther(l.priceETH));
            paypalUsdPrice = (ethAmount * ethUsdRate).toFixed(2);
          } else if (l.priceAmount > 0n && isUsdcToken) {
            paypalUsdPrice = (Number(l.priceAmount) / 1e6).toFixed(2);
          }

          return `
            <div style="border:1px solid #00ff8822;border-radius:6px;padding:8px;margin-bottom:6px;">
              <div style="color:#00ff88;font-weight:bold;font-size:0.75rem;margin-bottom:2px;">${l.note || `Listing #${l.id}`}</div>
              <div style="color:#888;font-size:0.65rem;">TokenID: ${l.tokenId} · Available: ${l.available} · In escrow: ${nftBalances[idx]}</div>
              <div style="color:#888;font-size:0.65rem;">NFT: ${l.nftContract.slice(0,6)}…${l.nftContract.slice(-4)}</div>
              ${l.priceETH > 0n ? `<div style="color:#aaa;font-size:0.65rem;">ETH price: ${ethers.formatEther(l.priceETH)} ETH</div>` : ""}
              ${l.priceAmount > 0n ? `<div style="color:#aaa;font-size:0.65rem;">Token price: ${(Number(l.priceAmount) / 1e6).toFixed(2)} ${tokenLabel}</div>` : ""}
              <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
                ${hasStock
                  ? `${l.priceETH > 0n ? `<button data-buy-eth="${l.id}" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:3px 8px;font-size:0.65rem;cursor:pointer;font-family:monospace;">Buy with ETH</button>` : ""}
                     ${l.priceAmount > 0n ? `<button data-buy-usdc="${l.id}" style="background:rgba(0,200,100,0.1);border:1px solid #00cc66;color:#00cc66;border-radius:4px;padding:3px 8px;font-size:0.65rem;cursor:pointer;font-family:monospace;">Buy with ${tokenLabel}</button>` : ""}
                     ${paypalUsdPrice !== null ? `<button data-buy-paypal="${l.id}" data-paypal-usd="${paypalUsdPrice}" style="background:rgba(100,150,255,0.15);border:1px solid #6699ff;color:#6699ff;border-radius:4px;padding:3px 8px;font-size:0.65rem;cursor:pointer;font-family:monospace;">💳 Buy with PayPal — $${paypalUsdPrice}</button>` : ""}`
                  : `<span style="color:#ff8844;font-size:0.65rem;">⚠ NFT stock not yet loaded into escrow</span>`
                }
              </div>
              ${hasStock && paypalUsdPrice !== null ? `
              <div id="paypal-form-${l.id}" style="display:none;margin-top:6px;padding:6px 8px;border:1px solid #6699ff33;border-radius:4px;background:rgba(100,150,255,0.05);">
                <div style="color:#6699ff;font-size:0.65rem;margin-bottom:4px;">Enter your wallet address to receive the DNFT:</div>
                <input id="paypal-wallet-${l.id}" type="text" placeholder="0x… wallet address" style="width:100%;background:#001508;color:#aaa;border:1px solid #6699ff44;border-radius:4px;padding:4px 6px;font-size:0.65rem;font-family:monospace;box-sizing:border-box;margin-bottom:6px;" />
                <div id="paypal-btn-container-${l.id}"></div>
                <div id="paypal-status-${l.id}" style="font-size:0.65rem;margin-top:4px;min-height:1em;"></div>
              </div>` : ""}
            </div>
          `;
        }).join("");

        // Wire purchase buttons — capture listing in closure to avoid redundant search
        listingsEl.querySelectorAll("[data-buy-eth]").forEach(btn => {
          const id = parseInt(btn.dataset.buyEth);
          const l = listings.find(x => x.id === id);
          btn.onclick = () => this._purchaseWithETH(escrowAddress, id, l, statusEl);
        });
        listingsEl.querySelectorAll("[data-buy-usdc]").forEach(btn => {
          btn.onclick = () => this._purchaseWithToken(escrowAddress, parseInt(btn.dataset.buyUsdc), statusEl);
        });
        listingsEl.querySelectorAll("[data-buy-paypal]").forEach(btn => {
          const id = parseInt(btn.dataset.buyPaypal);
          const usdPrice = btn.dataset.paypalUsd;
          const l = listings.find(x => x.id === id);
          let paypalInitialized = false;
          btn.onclick = async () => {
            const formEl = listingsEl.querySelector(`#paypal-form-${id}`);
            if (!formEl) return;
            if (formEl.style.display === "none") {
              formEl.style.display = "block";
              btn.textContent = "✕ Close PayPal";
              if (!paypalInitialized) {
                paypalInitialized = true;
                await this._renderPayPalButton(id, l, statusEl, usdPrice);
              }
            } else {
              formEl.style.display = "none";
              btn.textContent = `💳 Buy with PayPal — $${usdPrice}`;
            }
          };
        });
      }

      // ── Plans ─────────────────────────────────────────────────────────────
      const planCount = await escrow.nextPlanId();
      const activePlans = [];
      for (let i = 0; i < Number(planCount); i++) {
        const raw = await escrow.getPlan(i);
        // ethers.js v6 returns structs as Result (array-like); spread copies only
        // numeric indices, not named fields. Explicitly extract each named field.
        const p = {
          id:             i,
          name:           raw.name,
          paymentToken:   raw.paymentToken,
          pricePerPeriod: raw.pricePerPeriod,
          periodSeconds:  raw.periodSeconds,
          active:         raw.active,
        };
        if (p.active) {
          const isSubbed = resolvedUserAddress ? await escrow.isSubscribed(i, resolvedUserAddress) : false;
          activePlans.push({ ...p, isSubbed });
        }
      }

      if (activePlans.length === 0) {
        plansEl.innerHTML = `<div style="color:#555;font-style:italic;">No subscription plans yet</div>`;
      } else {
        plansEl.innerHTML = activePlans.map(p => {
          const periodLabel = p.periodSeconds >= 86400n
            ? `${Number(p.periodSeconds) / 86400} day(s)`
            : `${Number(p.periodSeconds) / 3600} hour(s)`;
          const isEthPlan = p.paymentToken === ethers.ZeroAddress;
          const priceLabel = isEthPlan
            ? `${ethers.formatEther(p.pricePerPeriod)} ETH`
            : `${(Number(p.pricePerPeriod / 1000n) / 1000).toFixed(2)} USDC`;
          return `
            <div style="border:1px solid #00ff8822;border-radius:6px;padding:8px;margin-bottom:6px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="color:#00ff88;font-size:0.75rem;font-weight:bold;">${p.name}</div>
                ${p.isSubbed ? `<span style="color:#00ff88;font-size:0.65rem;">✅ Active</span>` : `<span style="color:#888;font-size:0.65rem;">Not subscribed</span>`}
              </div>
              <div style="color:#888;font-size:0.65rem;margin-top:2px;">${priceLabel} / ${periodLabel}</div>
              ${!p.isSubbed ? `<button data-subscribe="${p.id}" data-eth="${isEthPlan}" data-price="${p.pricePerPeriod.toString()}" style="margin-top:6px;background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:3px 8px;font-size:0.65rem;cursor:pointer;font-family:monospace;">Subscribe</button>` : ""}
            </div>
          `;
        }).join("");

        plansEl.querySelectorAll("[data-subscribe]").forEach(btn => {
          btn.onclick = () => this._subscribeToPlan(escrowAddress, parseInt(btn.dataset.subscribe), btn.dataset.eth === "true", BigInt(btn.dataset.price), statusEl);
        });
      }

    } catch (err) {
      console.error("EscrowPanel:", err);
      statusEl.textContent = `⚠ Error: ${err.message?.slice(0, 80) || err}`;
    }
  }

  async _purchaseWithETH(escrowAddress, listingId, listing, statusEl) {
    try {
      statusEl.style.color = "";
      statusEl.textContent = "⏳ Sending purchase transaction…";
      const ethers = window.ethers;
      if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

      // Pre-flight: verify escrow holds NFT stock before sending ETH
      const nftBal = await escrow.getNFTBalance(listing.nftContract, listing.tokenId);
      if (nftBal === 0n) {
        statusEl.style.color = "#ff8844";
        statusEl.textContent = "⚠ Purchase aborted: NFT stock not yet loaded into escrow. Owner must deposit NFTs first.";
        return;
      }

      const tx = await escrow.purchaseWithETH(listingId, 1, { value: listing.priceETH });
      statusEl.textContent = `⏳ Waiting for confirmation…`;
      await tx.wait();
      statusEl.style.color = "#00ff88";
      statusEl.textContent = `✅ DNFT purchased! Tx: ${tx.hash.slice(0,10)}…`;
    } catch (err) {
      statusEl.style.color = "#ff4444";
      statusEl.textContent = `⚠ Purchase failed: ${err.reason || err.message?.slice(0, 60)}`;
    }
  }

  async _purchaseWithToken(escrowAddress, listingId, statusEl) {
    try {
      const ethers = window.ethers;
      if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Fetch listing to get priceToken, priceAmount, and NFT details
      const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
      const raw = await escrow.getListing(listingId);
      const nftContract = raw[0]; // address nftContract
      const tokenId     = raw[1]; // uint256 tokenId
      const priceToken  = raw[3]; // address priceToken
      const priceAmount = raw[4]; // uint256 priceAmount

      // Pre-flight: verify escrow holds NFT stock before spending any USDC
      statusEl.style.color = "";
      statusEl.textContent = "⏳ Checking escrow NFT stock…";
      const nftBal = await escrow.getNFTBalance(nftContract, tokenId);
      if (nftBal === 0n) {
        statusEl.style.color = "#ff8844";
        statusEl.textContent = "⚠ Purchase aborted: NFT stock not yet loaded into escrow. Owner must deposit NFTs first.";
        return;
      }

      // Step 1 — Approve
      statusEl.textContent = "⏳ Step 1/2 — Approving token spend…";
      const ERC20_ABI = [
        "function approve(address spender, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)",
        "function balanceOf(address account) view returns (uint256)",
      ];
      const token = new ethers.Contract(priceToken, ERC20_ABI, signer);

      // Pre-flight: verify buyer has enough of the required token
      const buyerAddress = await signer.getAddress();
      const buyerBal = await token.balanceOf(buyerAddress);
      if (buyerBal < priceAmount) {
        const tokenLabel = KNOWN_TOKENS[priceToken.toLowerCase()] || priceToken;
        const needed  = (Number(priceAmount) / 1e6).toFixed(6);
        const have    = (Number(buyerBal)    / 1e6).toFixed(6);
        statusEl.style.color = "#ff8844";
        statusEl.textContent =
          `⚠ Insufficient token balance. Listing requires ${needed} ${tokenLabel}` +
          ` (${priceToken.slice(0,6)}…${priceToken.slice(-4)}), you have ${have}.`;
        return;
      }

      // Check existing allowance — skip approve if already sufficient
      const allowance = await token.allowance(buyerAddress, escrowAddress);
      if (allowance < priceAmount) {
        const approveTx = await token.approve(escrowAddress, priceAmount);
        statusEl.textContent = "⏳ Step 1/2 — Waiting for approval confirmation…";
        await approveTx.wait();
      }

      // Step 2 — Purchase
      statusEl.textContent = "⏳ Step 2/2 — Sending purchase transaction…";
      const purchaseTx = await escrow.purchaseWithToken(listingId, 1);
      statusEl.textContent = "⏳ Step 2/2 — Waiting for confirmation…";
      await purchaseTx.wait();

      statusEl.style.color = "#00ff88";
      statusEl.textContent = `✅ DNFT purchased! Tx: ${purchaseTx.hash.slice(0, 10)}…`;

      // Reload listings to reflect updated available count
      this._loadEscrowData(
        document.getElementById("modal-escrow"),
        escrowAddress,
        buyerAddress
      );

    } catch (err) {
      console.error("purchaseWithToken:", err);
      statusEl.style.color = "#ff4444";
      statusEl.textContent = `⚠ Purchase failed: ${err.reason || err.message?.slice(0, 80)}`;
    }
  }

  // ── 💳 PayPal Purchase Helpers ────────────────────────────────────────────

  /**
   * Lazily loads the PayPal JS SDK and renders a PayPal button into the
   * per-listing container.  Called the first time the buyer expands the
   * PayPal form for a given listing.
   *
   * @param {number} listingId  - Numeric listing ID (used for element IDs)
   * @param {object} listing    - The listing object from _loadEscrowData
   * @param {Element} statusEl  - Shared status bar element in the escrow panel
   */
  async _renderPayPalButton(listingId, listing, statusEl, usdPrice) {
    const containerEl = document.getElementById(`paypal-btn-container-${listingId}`);
    const paypalStatusEl = document.getElementById(`paypal-status-${listingId}`);
    if (!containerEl) return;

    // Validate that a real client ID has been configured
    if (!PAYPAL_CONFIG.clientId || PAYPAL_CONFIG.clientId === 'YOUR_PAYPAL_CLIENT_ID') {
      if (paypalStatusEl) {
        paypalStatusEl.style.color = "#ff8844";
        paypalStatusEl.textContent = "⚠ PayPal is not configured. Contact the site admin.";
      }
      return;
    }

    // Load the PayPal JS SDK once per page
    if (!window.paypal) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(PAYPAL_CONFIG.clientId)}&currency=USD`;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load PayPal SDK'));
          document.head.appendChild(script);
        });
      } catch (e) {
        console.error("PayPal SDK load error:", e);
        if (paypalStatusEl) {
          paypalStatusEl.style.color = "#ff4444";
          paypalStatusEl.textContent = "⚠ Could not load PayPal. Check your internet connection and try again.";
        }
        return;
      }
    }

    // Refresh price at render time for ETH-priced listings so the order amount
    // reflects the live rate rather than what was cached when listings first loaded.
    let finalUsdPrice = usdPrice;
    if (listing.priceETH > 0n) {
      const freshRate = await this._fetchEthUsdPrice();
      if (freshRate !== null) {
        const ethAmount = parseFloat(
          window.ethers ? window.ethers.formatEther(listing.priceETH) : String(Number(listing.priceETH) / 1e18)
        );
        finalUsdPrice = (ethAmount * freshRate).toFixed(2);
        if (paypalStatusEl && finalUsdPrice !== usdPrice) {
          paypalStatusEl.style.color = "#aaa";
          paypalStatusEl.textContent = `ℹ Rate refreshed — checkout price: $${finalUsdPrice} USD`;
        }
      }
    }

    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay', height: 30 },

      createOrder: (_data, actions) => {
        // Require a wallet address before allowing PayPal checkout
        const walletInput = document.getElementById(`paypal-wallet-${listingId}`);
        const walletAddress = walletInput ? walletInput.value.trim() : '';
        if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
          if (paypalStatusEl) {
            paypalStatusEl.style.color = "#ff8844";
            paypalStatusEl.textContent = "⚠ Enter a valid wallet address (0x…) before checking out.";
          }
          return Promise.reject(new Error('Wallet address required'));
        }
        if (paypalStatusEl) paypalStatusEl.textContent = "";
        return actions.order.create({
          purchase_units: [{
            amount: { value: finalUsdPrice, currency_code: 'USD' },
            description: listing.note || `DNFT Listing #${listingId}`,
          }],
        });
      },

      onApprove: async (_data, actions) => {
        if (paypalStatusEl) {
          paypalStatusEl.style.color = "#aaa";
          paypalStatusEl.textContent = "⏳ Capturing payment…";
        }
        const order = await actions.order.capture();
        const txId = order.id;
        const walletInput = document.getElementById(`paypal-wallet-${listingId}`);
        const walletAddress = walletInput ? walletInput.value.trim() : '';

        if (paypalStatusEl) {
          paypalStatusEl.style.color = "#00ff88";
          paypalStatusEl.textContent =
            `✅ Payment received! PayPal transaction ID: ${txId}. ` +
            `Submit your wallet address to complete your order.`;
        }
        statusEl.style.color = "#00ff88";
        statusEl.textContent = `✅ PayPal payment received! Tx: ${txId.slice(0, 10)}…`;

        await this._notifyAdminPayPalPurchase(txId, walletAddress, listingId, listing.note || `Listing #${listingId}`, finalUsdPrice);
      },

      onCancel: () => {
        if (paypalStatusEl) {
          paypalStatusEl.style.color = "#ff8844";
          paypalStatusEl.textContent = "Payment cancelled.";
        }
      },

      onError: (err) => {
        console.error("PayPal error:", err);
        if (paypalStatusEl) {
          paypalStatusEl.style.color = "#ff4444";
          paypalStatusEl.textContent = `⚠ PayPal error. Please try again or contact support.`;
        }
      },
    }).render(`#paypal-btn-container-${listingId}`);
  }

  /**
   * Fetches the current ETH/USD spot price from CoinGecko's public API.
   * Returns null if the request fails (callers must handle gracefully).
   */
  async _fetchEthUsdPrice() {
    try {
      const resp = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        { cache: 'default' }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return data.ethereum?.usd ?? null;
    } catch (err) {
      console.warn('ETH/USD price fetch failed:', err);
      return null;
    }
  }

  /**
   * Notifies the admin about a completed PayPal DNFT purchase.
   * Tries the configured webhook URL first (HTTPS only); falls back to a mailto: link.
   *
   * @param {string} txId          - PayPal order/capture ID
   * @param {string} walletAddress - Buyer's wallet address (may be empty)
   * @param {number} listingId     - Listing ID
   * @param {string} listingNote   - Human-readable listing description
   * @param {string} usdPrice      - USD amount charged (dynamic, e.g. "3.47")
   */
  async _notifyAdminPayPalPurchase(txId, walletAddress, listingId, listingNote, usdPrice) {
    const payload = {
      txId,
      walletAddress,
      listingId,
      listingNote,
      amount: usdPrice,
    };

    // Attempt webhook notification — require HTTPS to protect payment data
    if (PAYPAL_CONFIG.adminWebhookUrl) {
      if (!PAYPAL_CONFIG.adminWebhookUrl.startsWith('https://')) {
        console.warn("PayPal admin webhook skipped: URL must start with https://");
      } else {
        try {
          await fetch(PAYPAL_CONFIG.adminWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          return;
        } catch (e) {
          console.warn("PayPal admin webhook failed:", e);
        }
      }
    }

    // Fall back to a mailto: link so the browser composes a notification email.
    // Sanitize the admin email to prevent URL injection (allow only safe RFC-5321 chars).
    const safeEmail = (PAYPAL_CONFIG.adminEmail || '').replace(/[^a-zA-Z0-9._%+\-@]/g, '');
    if (!safeEmail) { console.warn("PayPal admin notification skipped: no valid adminEmail configured"); return; }

    const subject = encodeURIComponent(`PayPal DNFT Purchase — Listing #${listingId}`);
    const body = encodeURIComponent(
      `PayPal DNFT Purchase\n\n` +
      `Transaction ID : ${txId}\n` +
      `Wallet Address : ${walletAddress || '(not provided)'}\n` +
      `Listing ID     : ${listingId}\n` +
      `Listing        : ${listingNote}\n` +
      `Amount         : $${usdPrice}\n\n` +
      `Please verify the PayPal payment on the PayPal dashboard, then call\n` +
      `safeTransferFrom (via the DNFT Contract Functions explorer or Etherscan)\n` +
      `to deliver the DNFT to the buyer's wallet address.`
    );
    window.open(`mailto:${safeEmail}?subject=${subject}&body=${body}`, '_blank');
  }

  async _subscribeToPlan(escrowAddress, planId, isEthPlan, price, statusEl) {
    try {
      statusEl.textContent = "⏳ Sending subscription transaction…";
      const ethers = window.ethers;
      if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
      const tx = isEthPlan
        ? await escrow.subscribe(planId, { value: price })
        : await escrow.subscribe(planId);
      statusEl.textContent = "⏳ Waiting for confirmation…";
      await tx.wait();
      statusEl.style.color = "#00ff88";
      statusEl.textContent = `✅ Subscribed! Tx: ${tx.hash.slice(0,10)}…`;
    } catch (err) {
      statusEl.textContent = `⚠ Subscribe failed: ${err.reason || err.message?.slice(0, 60)}`;
    }
  }

  _wireEscrowOwnerActions(panel, escrowAddress) {
    if (!escrowAddress) return;

    panel.querySelector("#escrow-withdraw-eth-btn").onclick = async () => {
      const statusEl = panel.querySelector("#escrow-status");
      const amtInput = panel.querySelector("#escrow-withdraw-eth-amount");
      const reasonInput = panel.querySelector("#escrow-withdraw-eth-reason");
      const amt = amtInput.value.trim();
      const reason = reasonInput.value.trim();
      if (!amt || !reason) { statusEl.textContent = "⚠ Enter amount and reason"; return; }
      try {
        statusEl.textContent = "⏳ Sending withdrawal…";
        const ethers = window.ethers;
        if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        const tx = await escrow.withdrawETH(ethers.parseEther(amt), reason);
        await tx.wait();
        statusEl.style.color = "#00ff88";
        statusEl.textContent = `✅ Withdrawn ${amt} ETH. Tx: ${tx.hash.slice(0,10)}…`;
        amtInput.value = ""; reasonInput.value = "";
      } catch (err) {
        statusEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 80)}`;
      }
    };

    panel.querySelector("#escrow-withdraw-token-btn").onclick = async () => {
      const statusEl = panel.querySelector("#escrow-status");
      const tokenAddress = panel.querySelector("#escrow-withdraw-token-address").value.trim();
      const amtStr = panel.querySelector("#escrow-withdraw-token-amount").value.trim();
      const decimalsStr = panel.querySelector("#escrow-withdraw-token-decimals").value.trim();
      const reason = panel.querySelector("#escrow-withdraw-token-reason").value.trim();
      if (!tokenAddress || !amtStr || !reason) { statusEl.textContent = "⚠ Enter token address, amount and reason"; return; }
      const decimals = decimalsStr ? parseInt(decimalsStr, 10) : 18;
      try {
        statusEl.textContent = "⏳ Sending ERC-20 withdrawal…";
        const ethers = window.ethers;
        if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        const tx = await escrow.withdrawToken(tokenAddress, ethers.parseUnits(amtStr, decimals), reason);
        await tx.wait();
        statusEl.style.color = "#00ff88";
        statusEl.textContent = `✅ Withdrawn ${amtStr} tokens. Tx: ${tx.hash.slice(0,10)}…`;
        panel.querySelector("#escrow-withdraw-token-address").value = "";
        panel.querySelector("#escrow-withdraw-token-amount").value = "";
        panel.querySelector("#escrow-withdraw-token-reason").value = "";
      } catch (err) {
        statusEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 80)}`;
      }
    };

    panel.querySelector("#escrow-deposit-nft-btn").onclick = async () => {
      const statusEl = panel.querySelector("#escrow-status");
      const nftContract = panel.querySelector("#escrow-deposit-nft-contract").value.trim();
      const tokenId = panel.querySelector("#escrow-deposit-nft-token-id").value.trim();
      const amount = panel.querySelector("#escrow-deposit-nft-amount").value.trim();
      if (!nftContract || !tokenId || !amount) { statusEl.textContent = "⚠ Fill in all deposit NFT fields"; return; }
      try {
        statusEl.style.color = "";
        statusEl.textContent = "⏳ Depositing NFT to escrow…";
        const ethers = window.ethers;
        if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const ownerAddress = await signer.getAddress();
        const ERC1155_ABI = [
          "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
          "function balanceOf(address account, uint256 id) view returns (uint256)",
        ];
        const nft = new ethers.Contract(nftContract, ERC1155_ABI, signer);

        // Pre-check: confirm the owner holds enough NFTs before attempting transfer
        const ownerBal = await nft.balanceOf(ownerAddress, tokenId);
        if (ownerBal < BigInt(amount)) {
          statusEl.style.color = "#ff8844";
          statusEl.textContent = `⚠ Insufficient NFT balance: you hold ${ownerBal} but tried to deposit ${amount}`;
          return;
        }

        const tx = await nft.safeTransferFrom(ownerAddress, escrowAddress, tokenId, amount, "0x");
        statusEl.textContent = "⏳ Waiting for confirmation…";
        await tx.wait();
        statusEl.style.color = "#00ff88";
        statusEl.textContent = `✅ ${amount} NFT(s) deposited to escrow. Tx: ${tx.hash.slice(0,10)}…`;
        panel.querySelector("#escrow-deposit-nft-contract").value = "";
        panel.querySelector("#escrow-deposit-nft-token-id").value = "";
        panel.querySelector("#escrow-deposit-nft-amount").value = "";
      } catch (err) {
        statusEl.style.color = "#ff4444";
        statusEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 80)}`;
      }
    };

    panel.querySelector("#escrow-list-btn").onclick = async () => {
      const statusEl = panel.querySelector("#escrow-status");
      const nftContract = panel.querySelector("#escrow-list-nft-contract").value.trim();
      const tokenId = panel.querySelector("#escrow-list-token-id").value.trim();
      const qty = panel.querySelector("#escrow-list-qty").value.trim();
      const priceEthStr = panel.querySelector("#escrow-list-price-eth").value.trim();
      const priceUsdcStr = panel.querySelector("#escrow-list-price-usdc").value.trim();
      const note = panel.querySelector("#escrow-list-note").value.trim();

      if (!nftContract || !tokenId || !qty) { statusEl.textContent = "⚠ Fill in contract, tokenId, and qty"; return; }

      try {
        statusEl.textContent = "⏳ Creating listing…";
        const ethers = window.ethers;
        if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

        const priceETH = priceEthStr ? ethers.parseEther(priceEthStr) : 0n;
        // Use ethers.parseUnits for USDC (6 decimals) to avoid float precision loss
        const priceUSDC = priceUsdcStr ? ethers.parseUnits(priceUsdcStr, 6) : 0n;
        const priceToken = priceUSDC > 0n ? USDC_OPTIMISM : ethers.ZeroAddress;

        const tx = await escrow.listDNFT(nftContract, tokenId, priceETH, priceToken, priceUSDC, qty, note || "DNFT listing");
        await tx.wait();
        statusEl.style.color = "#00ff88";
        statusEl.textContent = `✅ Listing created! Tx: ${tx.hash.slice(0,10)}…`;
      } catch (err) {
        statusEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 80)}`;
      }
    };

    panel.querySelector("#escrow-delist-btn").onclick = async () => {
      const statusEl = panel.querySelector("#escrow-status");
      const listingId = panel.querySelector("#escrow-delist-id").value.trim();
      if (!listingId) { statusEl.textContent = "⚠ Enter a listingId"; return; }
      try {
        statusEl.textContent = "⏳ Delisting…";
        const ethers = window.ethers;
        if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        const tx = await escrow.delistDNFT(listingId);
        await tx.wait();
        statusEl.style.color = "#00ff88";
        statusEl.textContent = `✅ Listing ${listingId} delisted. Tx: ${tx.hash.slice(0,10)}…`;
        panel.querySelector("#escrow-delist-id").value = "";
      } catch (err) {
        statusEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 80)}`;
      }
    };

    panel.querySelector("#escrow-withdraw-nft-btn").onclick = async () => {
      const statusEl = panel.querySelector("#escrow-status");
      const nftContract = panel.querySelector("#escrow-withdraw-nft-contract").value.trim();
      const tokenId = panel.querySelector("#escrow-withdraw-nft-token-id").value.trim();
      const amount = panel.querySelector("#escrow-withdraw-nft-amount").value.trim();
      const to = panel.querySelector("#escrow-withdraw-nft-to").value.trim();
      if (!nftContract || !tokenId || !amount || !to) { statusEl.textContent = "⚠ Fill in all NFT withdrawal fields"; return; }
      try {
        statusEl.textContent = "⏳ Withdrawing NFT…";
        const ethers = window.ethers;
        if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        const tx = await escrow.withdrawNFT(nftContract, tokenId, amount, to);
        await tx.wait();
        statusEl.style.color = "#00ff88";
        statusEl.textContent = `✅ NFT withdrawn. Tx: ${tx.hash.slice(0,10)}…`;
        panel.querySelector("#escrow-withdraw-nft-contract").value = "";
        panel.querySelector("#escrow-withdraw-nft-token-id").value = "";
        panel.querySelector("#escrow-withdraw-nft-amount").value = "";
        panel.querySelector("#escrow-withdraw-nft-to").value = "";
      } catch (err) {
        statusEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 80)}`;
      }
    };

    panel.querySelector("#escrow-plan-create-btn").onclick = async () => {
      const statusEl = panel.querySelector("#escrow-status");
      const name = panel.querySelector("#escrow-plan-name").value.trim();
      const paymentToken = panel.querySelector("#escrow-plan-token").value.trim();
      const priceStr = panel.querySelector("#escrow-plan-price").value.trim();
      const periodStr = panel.querySelector("#escrow-plan-period").value.trim();
      if (!name || !paymentToken || !priceStr || !periodStr) { statusEl.textContent = "⚠ Fill in all plan fields"; return; }
      try {
        statusEl.textContent = "⏳ Creating plan…";
        const ethers = window.ethers;
        if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        const isEthPlan = paymentToken === ethers.ZeroAddress || paymentToken === "0x0000000000000000000000000000000000000000";
        const decimalsStr = panel.querySelector("#escrow-plan-decimals").value.trim();
        const decimals = isEthPlan ? 18 : (decimalsStr ? parseInt(decimalsStr, 10) : 18);
        const price = ethers.parseUnits(priceStr, decimals);
        const tx = await escrow.createPlan(name, isEthPlan ? ethers.ZeroAddress : paymentToken, price, periodStr);
        await tx.wait();
        statusEl.style.color = "#00ff88";
        statusEl.textContent = `✅ Plan created! Tx: ${tx.hash.slice(0,10)}…`;
        panel.querySelector("#escrow-plan-name").value = "";
        panel.querySelector("#escrow-plan-token").value = "";
        panel.querySelector("#escrow-plan-price").value = "";
        panel.querySelector("#escrow-plan-decimals").value = "";
        panel.querySelector("#escrow-plan-period").value = "";
      } catch (err) {
        statusEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 80)}`;
      }
    };

    panel.querySelector("#escrow-plan-deactivate-btn").onclick = async () => {
      const statusEl = panel.querySelector("#escrow-status");
      const planId = panel.querySelector("#escrow-plan-deactivate-id").value.trim();
      if (!planId) { statusEl.textContent = "⚠ Enter a planId"; return; }
      try {
        statusEl.textContent = "⏳ Deactivating plan…";
        const ethers = window.ethers;
        if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        const tx = await escrow.deactivatePlan(planId);
        await tx.wait();
        statusEl.style.color = "#00ff88";
        statusEl.textContent = `✅ Plan ${planId} deactivated. Tx: ${tx.hash.slice(0,10)}…`;
        panel.querySelector("#escrow-plan-deactivate-id").value = "";
      } catch (err) {
        statusEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 80)}`;
      }
    };
  }

  // ── 📋 DNFT Contract Function Explorer ────────────────────────────────────
  // Renders a collapsible list of every DNFT contract function with inputs + Call/Send buttons.
  _wireDNFTFnExplorer(panel, dnftAddress) {
    const container = panel.querySelector("#dnft-fn-explorer");
    if (!container || !dnftAddress) return;

    const DNFT_FULL_ABI = [
      // Read
      "function nextTokenId() view returns (uint256)",
      "function kindOf(uint256 tokenId) view returns (uint8)",
      "function uri(uint256 tokenId) view returns (string)",
      "function totalMinted(uint256 tokenId) view returns (uint256)",
      "function maxSupply(uint256 tokenId) view returns (uint256)",
      "function creatorOf(uint256 tokenId) view returns (address)",
      "function balanceOf(address account, uint256 id) view returns (uint256)",
      "function isApprovedForAll(address account, address operator) view returns (bool)",
      "function hasRole(bytes32 role, address account) view returns (bool)",
      "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
      "function MINTER_ROLE() view returns (bytes32)",
      "function supportsInterface(bytes4 interfaceId) view returns (bool)",
      // Write
      "function mintProduct(address to, uint256 tokenId, uint256 amount)",
      "function mintAchievement(address to, uint256 tokenId, uint256 amount)",
      "function registerToken(uint256 maxSupply_, string tokenURI_, uint8 kind_, address royaltyReceiver, uint96 royaltyFeeBps) returns (uint256 tokenId)",
      "function setBaseURI(string newBaseURI)",
      "function grantRole(bytes32 role, address account)",
      "function revokeRole(bytes32 role, address account)",
      "function renounceRole(bytes32 role, address callerConfirmation)",
      "function setApprovalForAll(address operator, bool approved)",
      "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
      "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
      "function setDefaultRoyalty(address receiver, uint96 feeBps)",
      "function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeBps)",
    ];

    const FNS = [
      // ── READ ──────────────────────────────────────────────────────────────
      { id:"r-nexttid",   name:"nextTokenId",        label:"nextTokenId()",                              mutability:"view", inputs:[], output:"uint256" },
      { id:"r-kindof",    name:"kindOf",             label:"kindOf( tokenId )",                          mutability:"view",
        inputs:[{domId:"dfi-ko-tid", placeholder:"tokenId", argType:"uint256"}], output:"uint8" },
      { id:"r-uri",       name:"uri",                label:"uri( tokenId )",                             mutability:"view",
        inputs:[{domId:"dfi-uri-tid", placeholder:"tokenId", argType:"uint256"}], output:"string" },
      { id:"r-totmint",   name:"totalMinted",        label:"totalMinted( tokenId )",                     mutability:"view",
        inputs:[{domId:"dfi-tm-tid", placeholder:"tokenId", argType:"uint256"}], output:"uint256" },
      { id:"r-maxsup",    name:"maxSupply",          label:"maxSupply( tokenId )",                       mutability:"view",
        inputs:[{domId:"dfi-ms-tid", placeholder:"tokenId", argType:"uint256"}], output:"uint256" },
      { id:"r-creator",   name:"creatorOf",          label:"creatorOf( tokenId )",                       mutability:"view",
        inputs:[{domId:"dfi-cr-tid", placeholder:"tokenId", argType:"uint256"}], output:"address" },
      { id:"r-balof",     name:"balanceOf",          label:"balanceOf( account, tokenId )",              mutability:"view",
        inputs:[{domId:"dfi-bo-acc", placeholder:"account address", argType:"address"},{domId:"dfi-bo-tid", placeholder:"tokenId", argType:"uint256"}], output:"uint256" },
      { id:"r-isapprall", name:"isApprovedForAll",   label:"isApprovedForAll( account, operator )",      mutability:"view",
        inputs:[{domId:"dfi-iaa-acc", placeholder:"account address", argType:"address"},{domId:"dfi-iaa-op", placeholder:"operator address", argType:"address"}], output:"bool" },
      { id:"r-hasrole",   name:"hasRole",            label:"hasRole( role, account )",                   mutability:"view",
        inputs:[{domId:"dfi-hr-role", placeholder:"role (bytes32)", argType:"bytes32"},{domId:"dfi-hr-acc", placeholder:"account address", argType:"address"}], output:"bool" },
      { id:"r-adminrole", name:"DEFAULT_ADMIN_ROLE", label:"DEFAULT_ADMIN_ROLE()",                       mutability:"view", inputs:[], output:"bytes32" },
      { id:"r-minterrole",name:"MINTER_ROLE",        label:"MINTER_ROLE()",                              mutability:"view", inputs:[], output:"bytes32" },
      { id:"r-suppiface", name:"supportsInterface",  label:"supportsInterface( interfaceId )",           mutability:"view",
        inputs:[{domId:"dfi-si-ifc", placeholder:"interfaceId (bytes4, e.g. 0x01ffc9a7)", argType:"bytes4"}], output:"bool" },

      // ── WRITE ─────────────────────────────────────────────────────────────
      { id:"w-mintprod",  name:"mintProduct",        label:"mintProduct( to, tokenId, amount ) 🔑",      mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"dwfi-mp-to", placeholder:"recipient address", argType:"address"},{domId:"dwfi-mp-tid", placeholder:"tokenId", argType:"uint256"},{domId:"dwfi-mp-amt", placeholder:"amount", argType:"uint256"}] },
      { id:"w-mintach",   name:"mintAchievement",    label:"mintAchievement( to, tokenId, amount ) 🔑",  mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"dwfi-ma-to", placeholder:"recipient address", argType:"address"},{domId:"dwfi-ma-tid", placeholder:"tokenId", argType:"uint256"},{domId:"dwfi-ma-amt", placeholder:"amount", argType:"uint256"}] },
      { id:"w-regtok",    name:"registerToken",      label:"registerToken( maxSupply, tokenURI, kind, royaltyReceiver, royaltyFeeBps ) 🔑", mutability:"nonpayable", ownerOnly:true,
        inputs:[
          {domId:"dwfi-rt-ms",   placeholder:"maxSupply (0=∞)",             argType:"uint256"},
          {domId:"dwfi-rt-uri",  placeholder:"tokenURI (ipfs://… or blank)", argType:"string"},
          {domId:"dwfi-rt-kind", placeholder:"kind (0=Product, 1=Achievement)", argType:"uint8"},
          {domId:"dwfi-rt-rr",   placeholder:"royaltyReceiver (0x0…0 for default)", argType:"address"},
          {domId:"dwfi-rt-bps",  placeholder:"royaltyFeeBps (0 for default)", argType:"uint256"},
        ] },
      { id:"w-setbase",   name:"setBaseURI",         label:"setBaseURI( newBaseURI ) 🔑",               mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"dwfi-sb-uri", placeholder:"newBaseURI (e.g. ipfs://<cid>/)", argType:"string"}] },
      { id:"w-grantrole", name:"grantRole",          label:"grantRole( role, account ) 🔑",             mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"dwfi-gr-role", placeholder:"role (bytes32)", argType:"bytes32"},{domId:"dwfi-gr-acc", placeholder:"account address", argType:"address"}] },
      { id:"w-revokerole",name:"revokeRole",         label:"revokeRole( role, account ) 🔑",            mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"dwfi-rv-role", placeholder:"role (bytes32)", argType:"bytes32"},{domId:"dwfi-rv-acc", placeholder:"account address", argType:"address"}] },
      { id:"w-renouncerole",name:"renounceRole",     label:"renounceRole( role, callerConfirmation ) 🔑",mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"dwfi-rn-role", placeholder:"role (bytes32)", argType:"bytes32"},{domId:"dwfi-rn-acc", placeholder:"callerConfirmation address", argType:"address"}] },
      { id:"w-setappr",   name:"setApprovalForAll",  label:"setApprovalForAll( operator, approved )",   mutability:"nonpayable",
        inputs:[{domId:"dwfi-saa-op", placeholder:"operator address", argType:"address"},{domId:"dwfi-saa-appr", placeholder:"approved (true/false)", argType:"bool"}] },
      { id:"w-safexfr",   name:"safeTransferFrom",   label:"safeTransferFrom( from, to, id, amount, data )", mutability:"nonpayable",
        inputs:[
          {domId:"dwfi-stf-from", placeholder:"from address", argType:"address"},
          {domId:"dwfi-stf-to",   placeholder:"to address",   argType:"address"},
          {domId:"dwfi-stf-id",   placeholder:"tokenId",      argType:"uint256"},
          {domId:"dwfi-stf-amt",  placeholder:"amount",       argType:"uint256"},
          {domId:"dwfi-stf-data", placeholder:"data (0x for none)", argType:"bytes"},
        ] },
      { id:"w-batchxfr",  name:"safeBatchTransferFrom", label:"safeBatchTransferFrom( from, to, ids[], amounts[], data )", mutability:"nonpayable",
        inputs:[
          {domId:"dwfi-sbtf-from", placeholder:"from address",          argType:"address"},
          {domId:"dwfi-sbtf-to",   placeholder:"to address",            argType:"address"},
          {domId:"dwfi-sbtf-ids",  placeholder:"ids (comma-separated)", argType:"uint256[]"},
          {domId:"dwfi-sbtf-amts", placeholder:"amounts (comma-separated)", argType:"uint256[]"},
          {domId:"dwfi-sbtf-data", placeholder:"data (0x for none)",    argType:"bytes"},
        ] },
      { id:"w-defroy",    name:"setDefaultRoyalty",  label:"setDefaultRoyalty( receiver, feeBps ) 🔑",  mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"dwfi-dr-recv", placeholder:"receiver address", argType:"address"},{domId:"dwfi-dr-bps", placeholder:"feeBps (e.g. 500 = 5%)", argType:"uint256"}] },
      { id:"w-tokroy",    name:"setTokenRoyalty",    label:"setTokenRoyalty( tokenId, receiver, feeBps ) 🔑", mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"dwfi-tr-tid", placeholder:"tokenId", argType:"uint256"},{domId:"dwfi-tr-recv", placeholder:"receiver address", argType:"address"},{domId:"dwfi-tr-bps", placeholder:"feeBps (e.g. 500 = 5%)", argType:"uint256"}] },
    ];

    function renderFnCard(fn) {
      const isRead = fn.mutability === "view" || fn.mutability === "pure";
      const btnRgb  = isRead ? "100,200,255" : fn.ownerOnly ? "255,165,0" : "0,255,136";
      const lblColor = isRead ? "#44aaff" : fn.ownerOnly ? "#ff9900" : "#00ff88";
      const btnTxt  = isRead ? "📖 Call" : fn.mutability === "payable" ? "⚡ Send" : "✍ Send";
      const inputsHtml = fn.inputs.map(inp =>
        `<input id="${inp.domId}" placeholder="${inp.placeholder}"
           style="width:100%;box-sizing:border-box;background:#001508;color:#00e676;
                  border:1px solid #00e67622;border-radius:3px;padding:3px 5px;
                  font-size:0.63rem;font-family:monospace;margin-bottom:3px;" />`
      ).join("");
      return `
        <div style="border:1px solid #00e67615;border-radius:5px;padding:6px 8px;margin-bottom:5px;">
          <div style="font-size:0.63rem;color:${lblColor};font-family:monospace;margin-bottom:${fn.inputs.length ? 4 : 2}px;word-break:break-all;">${fn.label}</div>
          ${inputsHtml}
          <div style="display:flex;align-items:flex-start;gap:6px;margin-top:2px;">
            <button id="dnft-fn-btn-${fn.id}"
              style="flex-shrink:0;background:rgba(${btnRgb},0.15);border:1px solid rgba(${btnRgb},0.6);
                     color:rgb(${btnRgb});border-radius:4px;padding:3px 10px;font-size:0.63rem;
                     cursor:pointer;font-family:monospace;">${btnTxt}</button>
            <pre id="dnft-fn-result-${fn.id}"
              style="margin:0;font-size:0.6rem;color:#aaa;word-break:break-all;white-space:pre-wrap;flex:1;"></pre>
          </div>
        </div>`;
    }

    const readFns  = FNS.filter(f => f.mutability === "view" || f.mutability === "pure");
    const writeFns = FNS.filter(f => f.mutability !== "view" && f.mutability !== "pure");

    container.innerHTML = `
      <div id="dnft-fn-toggle"
        style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;
               background:rgba(0,40,10,0.4);border:1px solid #00e67633;border-radius:6px;
               padding:8px 10px;user-select:none;margin-bottom:2px;">
        <span style="font-size:0.7rem;color:#4caf50;font-family:monospace;">📋 DNFT Contract Functions</span>
        <span id="dnft-fn-chevron" style="font-size:0.7rem;color:#4caf50;">▶</span>
      </div>
      <div id="dnft-fn-body" style="display:none;padding:4px 0;">
        <div style="font-size:0.6rem;color:#446655;text-transform:uppercase;letter-spacing:0.1em;margin:4px 0;">── Read (view) ──</div>
        ${readFns.map(renderFnCard).join("")}
        <div style="font-size:0.6rem;color:#446655;text-transform:uppercase;letter-spacing:0.1em;margin:8px 0 4px;">── Write (send tx) ──</div>
        ${writeFns.map(renderFnCard).join("")}
      </div>
    `;

    // Toggle open/close
    panel.querySelector("#dnft-fn-toggle").onclick = () => {
      const body    = panel.querySelector("#dnft-fn-body");
      const chevron = panel.querySelector("#dnft-fn-chevron");
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      chevron.textContent = open ? "▶" : "▼";
    };

    // Wire each function button
    for (const fn of FNS) {
      const btn = panel.querySelector(`#dnft-fn-btn-${fn.id}`);
      if (!btn) continue;

      btn.onclick = async () => {
        const resultEl = panel.querySelector(`#dnft-fn-result-${fn.id}`);
        const ethers = window.ethers;
        if (!ethers) { resultEl.textContent = "⚠ ethers.js not loaded"; return; }

        // Collect arguments from inputs
        const args = [];
        try {
          for (const inp of fn.inputs) {
            const val = panel.querySelector(`#${inp.domId}`)?.value.trim() ?? "";
            if (inp.argType === "uint256" || inp.argType === "uint8") {
              if (val === "") throw new Error(`"${inp.placeholder}" is required (enter a number)`);
              args.push(BigInt(val));
            } else if (inp.argType === "uint256[]") {
              if (val === "") throw new Error(`"${inp.placeholder}" is required`);
              args.push(val.split(",").map(v => BigInt(v.trim())));
            } else if (inp.argType === "bool") {
              args.push(val.toLowerCase() === "true");
            } else {
              args.push(val);
            }
          }
        } catch (e) {
          resultEl.style.color = "#ff4444";
          resultEl.textContent = `⚠ Input error: ${e.message?.slice(0, 60)}`;
          return;
        }

        resultEl.style.color = "#888";
        resultEl.textContent = "⏳ …";

        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const isRead = fn.mutability === "view" || fn.mutability === "pure";

          if (isRead) {
            const dnft = new ethers.Contract(dnftAddress, DNFT_FULL_ABI, provider);
            const raw = await dnft[fn.name](...args);
            resultEl.style.color = "#44aaff";
            resultEl.textContent = this._formatEscrowResult(raw, ethers);
          } else {
            const signer = await provider.getSigner();
            const dnft = new ethers.Contract(dnftAddress, DNFT_FULL_ABI, signer);
            const tx = await dnft[fn.name](...args);
            resultEl.style.color = "#888";
            resultEl.textContent = "⏳ confirming…";
            await tx.wait();
            resultEl.style.color = "#00e676";
            resultEl.textContent = `✅ ${tx.hash}`;
          }
        } catch (err) {
          resultEl.style.color = "#ff4444";
          resultEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 120)}`;
        }
      };
    }
  }

  // ── 📋 Contract Function Explorer ─────────────────────────────────────────
  // Renders a collapsible list of every contract function with inputs + Call/Send buttons.
  _wireEscrowFnExplorer(panel, escrowAddress) {
    const container = panel.querySelector("#escrow-fn-explorer");
    if (!container || !escrowAddress) return;

    // All contract functions (read + write), ordered logically.
    const FNS = [
      // ── READ ──────────────────────────────────────────────────────────────
      { id:"r-owner",     name:"owner",             label:"owner()",                          mutability:"view", inputs:[], output:"address" },
      { id:"r-ethbal",    name:"getETHBalance",      label:"getETHBalance()",                  mutability:"view", inputs:[], output:"uint256 (wei)" },
      { id:"r-tokbal",    name:"getBalance",         label:"getBalance( token )",              mutability:"view",
        inputs:[{domId:"rfi-gb-tok", placeholder:"token address", argType:"address"}], output:"uint256" },
      { id:"r-nftbal",    name:"getNFTBalance",      label:"getNFTBalance( nftContract, tokenId )", mutability:"view",
        inputs:[{domId:"rfi-gnb-con", placeholder:"nftContract", argType:"address"},{domId:"rfi-gnb-tid", placeholder:"tokenId", argType:"uint256"}], output:"uint256" },
      { id:"r-nextlid",   name:"nextListingId",      label:"nextListingId()",                  mutability:"view", inputs:[], output:"uint256" },
      { id:"r-nextpid",   name:"nextPlanId",         label:"nextPlanId()",                     mutability:"view", inputs:[], output:"uint256" },
      { id:"r-getlist",   name:"getListing",         label:"getListing( listingId )",          mutability:"view",
        inputs:[{domId:"rfi-gl-id", placeholder:"listingId", argType:"uint256"}], output:"Listing" },
      { id:"r-getplan",   name:"getPlan",            label:"getPlan( planId )",                mutability:"view",
        inputs:[{domId:"rfi-gp-id", placeholder:"planId", argType:"uint256"}], output:"Plan" },
      { id:"r-issub",     name:"isSubscribed",       label:"isSubscribed( planId, account )",  mutability:"view",
        inputs:[{domId:"rfi-is-pid", placeholder:"planId", argType:"uint256"},{domId:"rfi-is-acc", placeholder:"account address", argType:"address"}], output:"bool" },
      { id:"r-suppiface", name:"supportsInterface",  label:"supportsInterface( interfaceId )", mutability:"view",
        inputs:[{domId:"rfi-si-ifc", placeholder:"interfaceId (bytes4, e.g. 0x01ffc9a7)", argType:"bytes4"}], output:"bool" },

      // ── WRITE ─────────────────────────────────────────────────────────────
      { id:"w-depeth",  name:"depositETH",      label:"depositETH( note )",                              mutability:"payable",
        inputs:[{domId:"wfi-de-note", placeholder:"note", argType:"string"},{domId:"wfi-de-val", placeholder:"ETH to send", argType:"eth"}] },
      { id:"w-deptok",  name:"depositToken",    label:"depositToken( token, amount, note )",             mutability:"nonpayable",
        inputs:[{domId:"wfi-dt-tok", placeholder:"token address", argType:"address"},{domId:"wfi-dt-amt", placeholder:"amount (wei)", argType:"uint256"},{domId:"wfi-dt-note", placeholder:"note", argType:"string"}] },
      { id:"w-pureth",  name:"purchaseWithETH", label:"purchaseWithETH( listingId, amount )",            mutability:"payable",
        inputs:[{domId:"wfi-pwe-id", placeholder:"listingId", argType:"uint256"},{domId:"wfi-pwe-amt", placeholder:"qty to buy", argType:"uint256"},{domId:"wfi-pwe-val", placeholder:"ETH to send", argType:"eth"}] },
      { id:"w-purtok",  name:"purchaseWithToken",label:"purchaseWithToken( listingId, amount )",         mutability:"nonpayable",
        inputs:[{domId:"wfi-pwt-id", placeholder:"listingId", argType:"uint256"},{domId:"wfi-pwt-amt", placeholder:"qty to buy", argType:"uint256"}] },
      { id:"w-subscribe",name:"subscribe",      label:"subscribe( planId )",                             mutability:"payable",
        inputs:[{domId:"wfi-sub-id", placeholder:"planId", argType:"uint256"},{domId:"wfi-sub-val", placeholder:"ETH to send (if ETH plan)", argType:"eth"}] },
      { id:"w-witeth",  name:"withdrawETH",     label:"withdrawETH( amount, reason ) 🔑",               mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"wfi-we-amt", placeholder:"amount (ETH)", argType:"eth"},{domId:"wfi-we-rsn", placeholder:"reason", argType:"string"}] },
      { id:"w-wittok",  name:"withdrawToken",   label:"withdrawToken( token, amount, reason ) 🔑",      mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"wfi-wt-tok", placeholder:"token address", argType:"address"},{domId:"wfi-wt-amt", placeholder:"amount (wei)", argType:"uint256"},{domId:"wfi-wt-rsn", placeholder:"reason", argType:"string"}] },
      { id:"w-witnft",  name:"withdrawNFT",     label:"withdrawNFT( nftContract, tokenId, amount, to ) 🔑", mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"wfi-wn-con", placeholder:"nftContract", argType:"address"},{domId:"wfi-wn-tid", placeholder:"tokenId", argType:"uint256"},{domId:"wfi-wn-amt", placeholder:"amount", argType:"uint256"},{domId:"wfi-wn-to", placeholder:"recipient address", argType:"address"}] },
      { id:"w-listdnft",name:"listDNFT",        label:"listDNFT( nftContract, tokenId, priceETH, priceToken, priceAmount, qty, note ) 🔑", mutability:"nonpayable", ownerOnly:true,
        inputs:[
          {domId:"wfi-ld-con",  placeholder:"nftContract",               argType:"address"},
          {domId:"wfi-ld-tid",  placeholder:"tokenId",                   argType:"uint256"},
          {domId:"wfi-ld-peth", placeholder:"priceETH (ETH, 0=none)",    argType:"eth"},
          {domId:"wfi-ld-ptok", placeholder:"priceToken (0x0…0 for none)",argType:"address"},
          {domId:"wfi-ld-pamt", placeholder:"priceAmount (token wei, 0=none)",argType:"uint256"},
          {domId:"wfi-ld-qty",  placeholder:"quantity",                  argType:"uint256"},
          {domId:"wfi-ld-note", placeholder:"note",                      argType:"string"},
        ] },
      { id:"w-delist",  name:"delistDNFT",     label:"delistDNFT( listingId ) 🔑",                     mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"wfi-dd-id", placeholder:"listingId", argType:"uint256"}] },
      { id:"w-crplan",  name:"createPlan",      label:"createPlan( name, paymentToken, pricePerPeriod, periodSeconds ) 🔑", mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"wfi-cp-name", placeholder:"plan name", argType:"string"},{domId:"wfi-cp-tok", placeholder:"paymentToken (0x0…0 for ETH)", argType:"address"},{domId:"wfi-cp-price", placeholder:"pricePerPeriod (wei)", argType:"uint256"},{domId:"wfi-cp-per", placeholder:"periodSeconds", argType:"uint256"}] },
      { id:"w-dactplan",name:"deactivatePlan",  label:"deactivatePlan( planId ) 🔑",                    mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"wfi-dap-id", placeholder:"planId", argType:"uint256"}] },
      { id:"w-towner",  name:"transferOwnership",label:"transferOwnership( newOwner ) 🔑",              mutability:"nonpayable", ownerOnly:true,
        inputs:[{domId:"wfi-to-addr", placeholder:"newOwner address", argType:"address"}] },
      { id:"w-rowner",  name:"renounceOwnership",label:"renounceOwnership() 🔑 ⚠ IRREVERSIBLE",         mutability:"nonpayable", ownerOnly:true, inputs:[] },
    ];

    function renderFnCard(fn) {
      const isRead = fn.mutability === "view" || fn.mutability === "pure";
      const btnRgb  = isRead ? "100,200,255" : fn.ownerOnly ? "255,165,0" : "0,255,136";
      const lblColor = isRead ? "#44aaff" : fn.ownerOnly ? "#ff9900" : "#00ff88";
      const btnTxt  = isRead ? "📖 Call" : fn.mutability === "payable" ? "⚡ Send" : "✍ Send";
      const inputsHtml = fn.inputs.map(inp =>
        `<input id="${inp.domId}" placeholder="${inp.placeholder}"
           style="width:100%;box-sizing:border-box;background:#001508;color:#00ff88;
                  border:1px solid #00ff8822;border-radius:3px;padding:3px 5px;
                  font-size:0.63rem;font-family:monospace;margin-bottom:3px;" />`
      ).join("");
      return `
        <div style="border:1px solid #00ff8815;border-radius:5px;padding:6px 8px;margin-bottom:5px;">
          <div style="font-size:0.63rem;color:${lblColor};font-family:monospace;margin-bottom:${fn.inputs.length ? 4 : 2}px;word-break:break-all;">${fn.label}</div>
          ${inputsHtml}
          <div style="display:flex;align-items:flex-start;gap:6px;margin-top:2px;">
            <button id="escrow-fn-btn-${fn.id}"
              style="flex-shrink:0;background:rgba(${btnRgb},0.15);border:1px solid rgba(${btnRgb},0.6);
                     color:rgb(${btnRgb});border-radius:4px;padding:3px 10px;font-size:0.63rem;
                     cursor:pointer;font-family:monospace;">${btnTxt}</button>
            <pre id="escrow-fn-result-${fn.id}"
              style="margin:0;font-size:0.6rem;color:#aaa;word-break:break-all;white-space:pre-wrap;flex:1;"></pre>
          </div>
        </div>`;
    }

    const readFns  = FNS.filter(f => f.mutability === "view" || f.mutability === "pure");
    const writeFns = FNS.filter(f => f.mutability !== "view" && f.mutability !== "pure");

    container.innerHTML = `
      <div id="escrow-fn-toggle"
        style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;
               background:rgba(0,40,80,0.4);border:1px solid #00aaff33;border-radius:6px;
               padding:8px 10px;user-select:none;margin-bottom:2px;">
        <span style="font-size:0.7rem;color:#44aaff;font-family:monospace;">📋 Contract Functions</span>
        <span id="escrow-fn-chevron" style="font-size:0.7rem;color:#44aaff;">▶</span>
      </div>
      <div id="escrow-fn-body" style="display:none;padding:4px 0;">
        <div style="font-size:0.6rem;color:#446688;text-transform:uppercase;letter-spacing:0.1em;margin:4px 0;">── Read (view) ──</div>
        ${readFns.map(renderFnCard).join("")}
        <div style="font-size:0.6rem;color:#446688;text-transform:uppercase;letter-spacing:0.1em;margin:8px 0 4px;">── Write (send tx) ──</div>
        ${writeFns.map(renderFnCard).join("")}
      </div>
    `;

    // Toggle open/close
    panel.querySelector("#escrow-fn-toggle").onclick = () => {
      const body    = panel.querySelector("#escrow-fn-body");
      const chevron = panel.querySelector("#escrow-fn-chevron");
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      chevron.textContent = open ? "▶" : "▼";
    };

    // Wire each function button
    for (const fn of FNS) {
      const btn = panel.querySelector(`#escrow-fn-btn-${fn.id}`);
      if (!btn) continue;

      btn.onclick = async () => {
        const resultEl = panel.querySelector(`#escrow-fn-result-${fn.id}`);
        const ethers = window.ethers;
        if (!ethers) { resultEl.textContent = "⚠ ethers.js not loaded"; return; }

        // Collect arguments from inputs
        const args = [];
        let ethValue = 0n;
        try {
          for (const inp of fn.inputs) {
            const val = panel.querySelector(`#${inp.domId}`)?.value.trim() ?? "";
            if (inp.argType === "eth") {
              ethValue = val ? ethers.parseEther(val) : 0n;
            } else if (inp.argType === "uint256") {
              if (val === "") throw new Error(`"${inp.placeholder}" is required (enter a number)`);
              args.push(BigInt(val));
            } else {
              args.push(val);
            }
          }
        } catch (e) {
          resultEl.style.color = "#ff4444";
          resultEl.textContent = `⚠ Input error: ${e.message?.slice(0, 60)}`;
          return;
        }

        resultEl.style.color = "#888";
        resultEl.textContent = "⏳ …";

        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const isRead = fn.mutability === "view" || fn.mutability === "pure";

          if (isRead) {
            const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, provider);
            const raw = await escrow[fn.name](...args);
            resultEl.style.color = "#44aaff";
            resultEl.textContent = this._formatEscrowResult(raw, ethers);
          } else {
            const signer = await provider.getSigner();
            const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
            const overrides = ethValue > 0n ? { value: ethValue } : {};
            const callArgs = Object.keys(overrides).length ? [...args, overrides] : args;
            const tx = await escrow[fn.name](...callArgs);
            resultEl.style.color = "#888";
            resultEl.textContent = "⏳ confirming…";
            await tx.wait();
            resultEl.style.color = "#00ff88";
            resultEl.textContent = `✅ ${tx.hash}`;
          }
        } catch (err) {
          resultEl.style.color = "#ff4444";
          resultEl.textContent = `⚠ ${err.reason || err.message?.slice(0, 120)}`;
        }
      };
    }
  }

  // Format a raw ethers.js contract call return value for display.
  _formatEscrowResult(raw, ethers) {
    if (raw === null || raw === undefined) return "null";
    if (typeof raw === "bigint") {
      const s = raw.toString();
      if (raw > WEI_DISPLAY_THRESHOLD) {
        return `${s} wei\n≈ ${parseFloat(ethers.formatEther(raw)).toFixed(8)} ETH`;
      }
      return s;
    }
    if (typeof raw === "boolean") return raw ? "✅ true" : "❌ false";
    if (typeof raw === "string") return raw || "(empty string)";
    if (raw && typeof raw === "object") {
      // ethers v6 Result / struct: named keys mixed with numeric indices
      const keys = Object.keys(raw).filter(k => isNaN(Number(k)));
      if (keys.length > 0) {
        return keys.map(k => {
          const v = raw[k];
          let fv;
          if (typeof v === "bigint") {
            fv = v > WEI_DISPLAY_THRESHOLD
              ? `${v} (≈${parseFloat(ethers.formatEther(v)).toFixed(8)} ETH)`
              : v.toString();
          } else if (typeof v === "boolean") {
            fv = v ? "✅ true" : "❌ false";
          } else {
            fv = String(v);
          }
          return `${k}: ${fv}`;
        }).join("\n");
      }
      return JSON.stringify(raw, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);
    }
    return String(raw);
  }

}

customElements.define("decent-right-toolbar", RightToolbar);
