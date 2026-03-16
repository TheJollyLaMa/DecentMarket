import { CONTRACTS, getChainConfig } from '../../config/contracts.js';
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
];

// ── Known token addresses ─────────────────────────────────────────────────────
const USDC_OPTIMISM = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85";

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
        const recipientInput = modal.querySelector("#mint-recipient").value.trim();
        const imageUri = imageUriInput.value.trim();

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
        const recipient = recipientInput && ethers.isAddress(recipientInput)
          ? recipientInput
          : account;

        const MINT_ABI = [
          "function mintProduct(address to, uint256 tokenId, uint256 amount)",
          "function mintAchievement(address to, uint256 tokenId, uint256 amount)",
          "event EditionMinted(uint256 indexed tokenId, address indexed to, uint256 amount, address indexed minter)",
        ];
        const mintContract = new ethers.Contract(contractAddr, MINT_ABI, signer);
        const mintFn = kind === 0 ? "mintProduct" : "mintAchievement";

        setStatus(`🔮 Minting token #${tokenId}…`);
        const mintTx = await mintContract[mintFn](recipient, tokenId, 1n);
        setStatus(`🔮 Minting… tx ${mintTx.hash.slice(0, 12)}…`);
        const mintReceipt = await mintTx.wait();

        // ── Success! ──────────────────────────────────────────────────────
        const successMsg = `✅ Minted! Token #${tokenId} · Block ${mintReceipt.blockNumber}`;
        setStatus(successMsg, "#00e676");
        submitBtn.textContent = "✅ Minted!";
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
          });
        }, 4000);
      } catch (err) {
        setStatus(`✗ ${err.reason || err.message}`, "#f44");
        submitBtn.disabled = false;
        submitBtn.style.opacity = "1";
      }
    });
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
  _showMintToast({ name, tokenId, txHash }) {
    const existing = document.getElementById("dnft-mint-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "dnft-mint-toast";
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "30px",
      right: "70px",
      background: "rgba(0, 20, 10, 0.97)",
      border: "2px solid #00e676",
      borderRadius: "10px",
      boxShadow: "0 0 20px #00e676",
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

    toast.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span style="font-size:1.4rem;">📜</span>
        <div>
          <div style="color:#00e676;font-weight:bold;">NFT Minted!</div>
          <div style="color:#aaa;font-size:0.68rem;">${name || "DNFT"} — Token #${tokenId}</div>
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

          <!-- List DNFT -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid #00ff8811;border-radius:6px;padding:8px 10px;margin-bottom:8px;">
            <div style="font-size:0.65rem;color:#008844;margin-bottom:4px;">List a DNFT for Purchase</div>
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
      if (userAddress && ownerAddr.toLowerCase() === userAddress.toLowerCase()) {
        ownerSection.style.display = "block";
      }

      // ── Listings ──────────────────────────────────────────────────────────
      const listingCount = await escrow.nextListingId();
      const listings = [];
      for (let i = 0; i < Number(listingCount); i++) {
        const l = await escrow.getListing(i);
        if (l.active) listings.push({ id: i, ...l });
      }

      if (listings.length === 0) {
        listingsEl.innerHTML = `<div style="color:#555;font-style:italic;">No active listings</div>`;
      } else {
        listingsEl.innerHTML = listings.map(l => `
          <div style="border:1px solid #00ff8822;border-radius:6px;padding:8px;margin-bottom:6px;">
            <div style="color:#00ff88;font-weight:bold;font-size:0.75rem;margin-bottom:2px;">${l.note || `Listing #${l.id}`}</div>
            <div style="color:#888;font-size:0.65rem;">TokenID: ${l.tokenId} · Available: ${l.available}</div>
            <div style="color:#888;font-size:0.65rem;">NFT: ${l.nftContract.slice(0,6)}…${l.nftContract.slice(-4)}</div>
            ${l.priceETH > 0n ? `<div style="color:#aaa;font-size:0.65rem;">ETH price: ${ethers.formatEther(l.priceETH)} ETH</div>` : ""}
            ${l.priceAmount > 0n ? `<div style="color:#aaa;font-size:0.65rem;">USDC price: ${(Number(l.priceAmount) / 1e6).toFixed(2)} USDC</div>` : ""}
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
              ${l.priceETH > 0n ? `<button data-buy-eth="${l.id}" style="background:rgba(0,255,136,0.15);border:1px solid #00ff88;color:#00ff88;border-radius:4px;padding:3px 8px;font-size:0.65rem;cursor:pointer;font-family:monospace;">Buy with ETH</button>` : ""}
              ${l.priceAmount > 0n ? `<button data-buy-usdc="${l.id}" style="background:rgba(0,200,100,0.1);border:1px solid #00cc66;color:#00cc66;border-radius:4px;padding:3px 8px;font-size:0.65rem;cursor:pointer;font-family:monospace;">Buy with USDC</button>` : ""}
            </div>
          </div>
        `).join("");

        // Wire purchase buttons — capture listing in closure to avoid redundant search
        listingsEl.querySelectorAll("[data-buy-eth]").forEach(btn => {
          const id = parseInt(btn.dataset.buyEth);
          const l = listings.find(x => x.id === id);
          btn.onclick = () => this._purchaseWithETH(escrowAddress, id, l, statusEl);
        });
        listingsEl.querySelectorAll("[data-buy-usdc]").forEach(btn => {
          btn.onclick = () => this._purchaseWithToken(escrowAddress, parseInt(btn.dataset.buyUsdc), statusEl);
        });
      }

      // ── Plans ─────────────────────────────────────────────────────────────
      const planCount = await escrow.nextPlanId();
      const activePlans = [];
      for (let i = 0; i < Number(planCount); i++) {
        const p = await escrow.getPlan(i);
        if (p.active) {
          const isSubbed = userAddress ? await escrow.isSubscribed(i, userAddress) : false;
          activePlans.push({ id: i, ...p, isSubbed });
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
      statusEl.textContent = "⏳ Sending purchase transaction…";
      const ethers = window.ethers;
      if (!ethers) { statusEl.textContent = "⚠ ethers.js not loaded"; return; }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
      const tx = await escrow.purchaseWithETH(listingId, 1, { value: listing.priceETH });
      statusEl.textContent = `⏳ Waiting for confirmation…`;
      await tx.wait();
      statusEl.style.color = "#00ff88";
      statusEl.textContent = `✅ DNFT purchased! Tx: ${tx.hash.slice(0,10)}…`;
    } catch (err) {
      statusEl.textContent = `⚠ Purchase failed: ${err.reason || err.message?.slice(0, 60)}`;
    }
  }

  async _purchaseWithToken(escrowAddress, listingId, statusEl) {
    statusEl.textContent = "ℹ Token purchases require a prior ERC-20 approval — see contract on Etherscan.";
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
}

customElements.define("decent-right-toolbar", RightToolbar);
