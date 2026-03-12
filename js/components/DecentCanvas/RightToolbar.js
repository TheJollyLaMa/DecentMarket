import { CONTRACTS, SUPPORTED_CHAIN_IDS, getChainConfig, VERSIONS } from '../../config/contracts.js';

// js/components/DecentCanvas/RightToolbar.js
// Right-side toolbar.
// Button 1 opens the DecentNFT v0.2 mint/control panel (PR #12).
// Button 2 opens the DecentNFT Control Panel (config/versions) modal (main / PR #11).

// ── Minimal ABI subset used by the mint/control panel ────────────────────────
const DECENT_NFT_ABI = [
  // Roles
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
  // Token info
  "function nextTokenId() view returns (uint256)",
  "function kindOf(uint256 tokenId) view returns (uint8)",
  "function totalMinted(uint256 tokenId) view returns (uint256)",
  "function maxSupply(uint256 tokenId) view returns (uint256)",
  "function creatorOf(uint256 tokenId) view returns (address)",
  "function uri(uint256 tokenId) view returns (string)",
  // Mint lanes
  "function mintProduct(address to, uint256 tokenId, uint256 amount)",
  "function mintAchievement(address to, uint256 tokenId, uint256 amount)",
  // Registration
  "function registerToken(uint256 maxSupply_, string tokenURI_, uint8 kind_, address royaltyReceiver, uint96 royaltyFeeBps) returns (uint256 tokenId)",
];

// ── Supported networks (Polygon ecosystem) ───────────────────────────────────
const NETWORKS = {
  "0x89": {
    name: "Polygon Mainnet",
    shortName: "Polygon",
    rpc: "https://polygon-rpc.com",
    explorer: "https://polygonscan.com",
    symbol: "MATIC",
    color: "#8247e5",
  },
  "0x13882": {
    name: "Polygon Amoy",
    shortName: "Amoy",
    rpc: "https://rpc-amoy.polygon.technology",
    explorer: "https://amoy.polygonscan.com",
    symbol: "MATIC",
    color: "#00bcd4",
  },
};

// ── Helper: neon-styled input ────────────────────────────────────────────────
function neonInput(placeholder, value = "") {
  return `style="
    background:#000;
    color:#00e5ff;
    border:1px solid #00e5ff;
    border-radius:4px;
    padding:4px 6px;
    font-size:0.75rem;
    font-family:monospace;
    width:100%;
    box-sizing:border-box;
  " placeholder="${placeholder}" value="${value}"`;
}

// ── Helper: neon button HTML ─────────────────────────────────────────────────
function neonBtn(label, color = "#00e5ff", extraStyle = "") {
  return `style="
    background:#000;
    color:${color};
    border:1px solid ${color};
    border-radius:4px;
    padding:5px 10px;
    font-size:0.75rem;
    font-family:monospace;
    cursor:pointer;
    box-shadow:0 0 6px ${color};
    ${extraStyle}
  "`;
}

class RightToolbar extends HTMLElement {
  connectedCallback() {
    this.style.display = "flex";
    this.style.flexDirection = "column";
    this.style.alignItems = "center";
    this.style.justifyContent = "space-between";
    this.style.width = "50px";
    this.style.background = "rgba(0, 0, 0, 0.6)";
    this.style.right = "0";
    this.style.zIndex = "999";
    this.style.padding = "20px 0";

    // ── Button 1: DecentNFT v0.2 mint/control panel (PR #12) ─────────────────
    const nftBtn = document.createElement("button");
    nftBtn.title = "DecentNFT v0.2 — Mint Panel";
    nftBtn.innerHTML = "🔮";
    Object.assign(nftBtn.style, {
      width: "38px",
      height: "38px",
      borderRadius: "50%",
      border: "2px solid #8247e5",
      background: "#000",
      boxShadow: "0 0 10px #8247e5",
      cursor: "pointer",
      fontSize: "1.2rem",
    });
    nftBtn.addEventListener("click", () => this._openNFTPanel());
    this.appendChild(nftBtn);

    // ── Button 2: DecentNFT Control Panel (main / PR #11) ────────────────────
    const dnftBtn = document.createElement("button");
    dnftBtn.title = "DecentNFT Control Panel";
    dnftBtn.innerHTML = "💎";
    Object.assign(dnftBtn.style, {
      width: "36px",
      height: "36px",
      borderRadius: "50%",
      border: "2px solid #8b00ff",
      background: "#000",
      boxShadow: "0 0 10px #8b00ff",
      cursor: "pointer",
      fontSize: "1rem",
    });
    dnftBtn.addEventListener("click", () => this.showDNFTModal());
    this.appendChild(dnftBtn);

    // ── Buttons 3–6: placeholders ─────────────────────────────────────────────
    const placeholders = ["💧", "🔆", "⚙️", "📡"];
    placeholders.forEach((icon, i) => {
      const btn = document.createElement("button");
      btn.innerHTML = icon;
      btn.dataset.modal = `modal-right-${i + 3}`;
      Object.assign(btn.style, {
        width: "36px",
        height: "36px",
        borderRadius: "50%",
        border: "1px solid cyan",
        background: "#000",
        boxShadow: "0 0 10px cyan",
        cursor: "pointer",
        fontSize: "1rem",
      });
      btn.addEventListener("click", (e) =>
        this._showPlaceholder(e.target.dataset.modal)
      );
      this.appendChild(btn);
    });
  }

  // ── Placeholder modal for unused buttons ────────────────────────────────────
  _showPlaceholder(id) {
    this._clearModals();
    const m = document.createElement("div");
    m.id = id;
    Object.assign(m.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%,-50%)",
      padding: "20px",
      background: "rgba(0,0,0,0.9)",
      border: "2px solid cyan",
      borderRadius: "12px",
      boxShadow: "0 0 20px cyan",
      zIndex: "2000",
      color: "#fff",
      fontFamily: "monospace",
      textAlign: "center",
    });
    m.innerHTML = `<h3>${id}</h3><p>Placeholder</p>
      <button onclick="this.closest('[id^=modal]').remove()"
        style="border:1px solid cyan;background:#000;color:cyan;padding:5px 12px;border-radius:4px;cursor:pointer;">
        Close
      </button>`;
    document.body.appendChild(m);
  }

  _clearModals() {
    document.querySelectorAll("[id^='modal-']").forEach((m) => m.remove());
    const panel = document.getElementById("decent-nft-panel");
    if (panel) panel.remove();
  }

  // ── DecentNFT v0.2 mint/control panel (PR #12) ─────────────────────────────
  _openNFTPanel() {
    this._clearModals();

    const saved = {
      address: localStorage.getItem("decentNFT_address") || "",
    };

    const panel = document.createElement("div");
    panel.id = "decent-nft-panel";
    Object.assign(panel.style, {
      position: "fixed",
      top: "110px",
      right: "60px",
      width: "340px",
      maxHeight: "calc(100vh - 170px)",
      overflowY: "auto",
      background: "rgba(0,0,20,0.97)",
      border: "2px solid #8247e5",
      borderRadius: "12px",
      boxShadow: "0 0 24px #8247e5, 0 0 8px #00e5ff",
      zIndex: "2000",
      color: "#fff",
      fontFamily: "monospace",
      fontSize: "0.78rem",
      padding: "14px",
    });

    panel.innerHTML = this._buildPanelHTML(saved.address);
    document.body.appendChild(panel);

    this._wirePanel(panel);
  }

  _buildPanelHTML(savedAddress) {
    return `
      <!-- Header row -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:1rem;font-weight:bold;color:#8247e5;text-shadow:0 0 8px #8247e5;">
          🔮 DecentNFT
          <span style="background:#8247e5;color:#fff;border-radius:4px;padding:1px 6px;font-size:0.7rem;margin-left:4px;">v0.2</span>
        </span>
        <button id="nft-panel-close"
          style="background:transparent;border:none;color:#aaa;font-size:1.1rem;cursor:pointer;line-height:1;">✕</button>
      </div>

      <!-- Chain switcher -->
      <div style="margin-bottom:10px;">
        <div style="color:#888;margin-bottom:4px;font-size:0.7rem;letter-spacing:1px;">NETWORK</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="chain-polygon" title="Switch to Polygon Mainnet"
            style="flex:1;padding:4px;border-radius:6px;border:1px solid #8247e5;background:#000;color:#8247e5;cursor:pointer;font-size:0.7rem;font-family:monospace;">
            🟣 Polygon
          </button>
          <button id="chain-amoy" title="Switch to Polygon Amoy testnet"
            style="flex:1;padding:4px;border-radius:6px;border:1px solid #00bcd4;background:#000;color:#00bcd4;cursor:pointer;font-size:0.7rem;font-family:monospace;">
            🔵 Amoy
          </button>
          <span id="chain-status" style="font-size:0.65rem;color:#888;min-width:50px;text-align:right;">—</span>
        </div>
      </div>

      <hr style="border-color:#222;margin:8px 0;"/>

      <!-- Contract address -->
      <div style="margin-bottom:10px;">
        <div style="color:#888;margin-bottom:4px;font-size:0.7rem;letter-spacing:1px;">CONTRACT ADDRESS</div>
        <div style="display:flex;gap:4px;">
          <input id="nft-address" type="text" placeholder="0x… deployed address"
            ${neonInput("0x… deployed address", savedAddress)}
            style="flex:1;background:#000;color:#00e5ff;border:1px solid #00e5ff;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;box-sizing:border-box;" />
          <button id="nft-address-save" ${neonBtn("Save", "#00e5ff")}>Save</button>
        </div>
        <div id="nft-address-error" style="color:#f44;font-size:0.68rem;margin-top:2px;"></div>
      </div>

      <!-- Role status -->
      <div style="margin-bottom:10px;">
        <div style="color:#888;margin-bottom:4px;font-size:0.7rem;letter-spacing:1px;">YOUR ROLE</div>
        <div id="role-status" style="padding:6px;background:rgba(0,0,0,0.5);border:1px solid #333;border-radius:6px;min-height:28px;color:#888;">
          Connect wallet &amp; set contract address
        </div>
      </div>

      <hr style="border-color:#222;margin:8px 0;"/>

      <!-- Token info lookup -->
      <div style="margin-bottom:10px;">
        <div style="color:#888;margin-bottom:4px;font-size:0.7rem;letter-spacing:1px;">TOKEN INFO</div>
        <div style="display:flex;gap:4px;margin-bottom:4px;">
          <input id="info-token-id" type="number" min="0" placeholder="Token ID"
            style="flex:1;background:#000;color:#00e5ff;border:1px solid #00e5ff;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;" />
          <button id="info-lookup" ${neonBtn("Lookup", "#00e5ff")}>Look up</button>
        </div>
        <div id="token-info-result" style="padding:6px;background:rgba(0,0,0,0.5);border:1px solid #333;border-radius:6px;min-height:28px;color:#888;word-break:break-all;"></div>
      </div>

      <hr style="border-color:#222;margin:8px 0;"/>

      <!-- Lane A: mintProduct (admin) -->
      <div style="margin-bottom:10px;">
        <div style="color:#8247e5;margin-bottom:6px;font-size:0.72rem;letter-spacing:1px;">
          🅰️ LANE A — Mint Product <span style="color:#555;">(DEFAULT_ADMIN_ROLE)</span>
        </div>
        <input id="mp-to" type="text" placeholder="Recipient address (0x…)"
          style="width:100%;margin-bottom:4px;background:#000;color:#00e5ff;border:1px solid #8247e5;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;box-sizing:border-box;" />
        <div style="display:flex;gap:4px;margin-bottom:4px;">
          <input id="mp-token-id" type="number" min="0" placeholder="Token ID"
            style="flex:1;background:#000;color:#00e5ff;border:1px solid #8247e5;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;" />
          <input id="mp-amount" type="number" min="1" value="1" placeholder="Qty"
            style="width:60px;background:#000;color:#00e5ff;border:1px solid #8247e5;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;" />
        </div>
        <button id="btn-mint-product"
          style="width:100%;padding:6px;border-radius:6px;border:1px solid #8247e5;background:#000;color:#8247e5;font-family:monospace;font-size:0.75rem;cursor:pointer;box-shadow:0 0 8px #8247e5;">
          🔮 Mint Product Edition
        </button>
        <div id="mp-status" style="margin-top:4px;min-height:18px;font-size:0.68rem;color:#888;word-break:break-all;"></div>
      </div>

      <!-- Lane B: mintAchievement (minter) -->
      <div style="margin-bottom:10px;">
        <div style="color:#00bcd4;margin-bottom:6px;font-size:0.72rem;letter-spacing:1px;">
          🅱️ LANE B — Mint Achievement <span style="color:#555;">(MINTER_ROLE)</span>
        </div>
        <input id="ma-to" type="text" placeholder="Recipient address (0x…)"
          style="width:100%;margin-bottom:4px;background:#000;color:#00e5ff;border:1px solid #00bcd4;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;box-sizing:border-box;" />
        <div style="display:flex;gap:4px;margin-bottom:4px;">
          <input id="ma-token-id" type="number" min="0" placeholder="Token ID"
            style="flex:1;background:#000;color:#00e5ff;border:1px solid #00bcd4;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;" />
          <input id="ma-amount" type="number" min="1" value="1" placeholder="Qty"
            style="width:60px;background:#000;color:#00e5ff;border:1px solid #00bcd4;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;" />
        </div>
        <button id="btn-mint-achievement"
          style="width:100%;padding:6px;border-radius:6px;border:1px solid #00bcd4;background:#000;color:#00bcd4;font-family:monospace;font-size:0.75rem;cursor:pointer;box-shadow:0 0 8px #00bcd4;">
          🏆 Mint Achievement
        </button>
        <div id="ma-status" style="margin-top:4px;min-height:18px;font-size:0.68rem;color:#888;word-break:break-all;"></div>
      </div>

      <!-- Admin: Register Token -->
      <details style="margin-bottom:6px;">
        <summary style="cursor:pointer;color:#8247e5;font-size:0.72rem;margin-bottom:6px;">
          ⚙️ Register New Token (admin)
        </summary>
        <div style="padding-top:6px;display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;gap:4px;">
            <input id="reg-max-supply" type="number" min="0" value="0" placeholder="Max supply (0=∞)"
              style="flex:1;background:#000;color:#00e5ff;border:1px solid #8247e5;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;" />
            <select id="reg-kind"
              style="background:#000;color:#8247e5;border:1px solid #8247e5;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;">
              <option value="0">Product</option>
              <option value="1">Achievement</option>
            </select>
          </div>
          <input id="reg-uri" type="text" placeholder="Token URI (optional)"
            style="background:#000;color:#00e5ff;border:1px solid #8247e5;border-radius:4px;padding:4px;font-size:0.72rem;font-family:monospace;" />
          <button id="btn-register"
            style="padding:6px;border-radius:6px;border:1px solid #8247e5;background:#000;color:#8247e5;font-family:monospace;font-size:0.75rem;cursor:pointer;">
            Register Token
          </button>
          <div id="reg-status" style="min-height:16px;font-size:0.68rem;color:#888;word-break:break-all;"></div>
        </div>
      </details>
    `;
  }

  _wirePanel(panel) {
    const ethers = window.ethers;

    panel.querySelector("#nft-panel-close").onclick = () => panel.remove();

    const _outsideClick = (e) => {
      if (!panel.contains(e.target) && !e.target.closest("decent-right-toolbar")) {
        panel.remove();
        document.removeEventListener("click", _outsideClick);
      }
    };
    setTimeout(() => document.addEventListener("click", _outsideClick), 0);

    const chainStatus = panel.querySelector("#chain-status");

    const refreshChainStatus = async () => {
      if (!window.ethereum) {
        chainStatus.textContent = "no wallet";
        return;
      }
      try {
        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        const net = NETWORKS[chainId];
        chainStatus.textContent = net ? `✓ ${net.shortName}` : `#${parseInt(chainId, 16)}`;
        chainStatus.style.color = net ? net.color : "#f80";
      } catch {
        chainStatus.textContent = "—";
      }
    };
    refreshChainStatus();

    const switchChain = async (hexId) => {
      if (!window.ethereum) return;
      const net = NETWORKS[hexId];
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexId }],
        });
      } catch (err) {
        if (err.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: net.name,
                rpcUrls: [net.rpc],
                nativeCurrency: { name: net.symbol, symbol: net.symbol, decimals: 18 },
                blockExplorerUrls: [net.explorer],
              },
            ],
          });
        }
      }
      await refreshChainStatus();
    };

    panel.querySelector("#chain-polygon").onclick = () => switchChain("0x89");
    panel.querySelector("#chain-amoy").onclick = () => switchChain("0x13882");
    window.ethereum?.on?.("chainChanged", refreshChainStatus);

    const addrInput = panel.querySelector("#nft-address");
    const addrErr = panel.querySelector("#nft-address-error");

    panel.querySelector("#nft-address-save").onclick = async () => {
      const addr = addrInput.value.trim();
      addrErr.textContent = "";
      if (!ethers.isAddress(addr)) {
        addrErr.textContent = "Invalid address";
        return;
      }
      localStorage.setItem("decentNFT_address", addr);
      await this._refreshRoleStatus(panel);
    };

    if (addrInput.value && ethers.isAddress(addrInput.value)) {
      this._refreshRoleStatus(panel);
    }

    panel.querySelector("#info-lookup").onclick = async () => {
      const result = panel.querySelector("#token-info-result");
      result.textContent = "Loading…";
      try {
        const contract = await this._getContract(panel, false);
        if (!contract) {
          result.textContent = "Set contract address first";
          return;
        }
        const id = BigInt(panel.querySelector("#info-token-id").value || "0");
        const [kind, minted, max, creator, tokenUri] = await Promise.all([
          contract.kindOf(id),
          contract.totalMinted(id),
          contract.maxSupply(id),
          contract.creatorOf(id),
          contract.uri(id),
        ]);
        const kindLabel = Number(kind) === 0 ? "🔮 Product" : "🏆 Achievement";
        result.innerHTML = `
          <span style="color:#aaa;">Kind:</span> ${kindLabel}<br/>
          <span style="color:#aaa;">Minted:</span> ${minted.toString()} / ${max === 0n ? "∞" : max.toString()}<br/>
          <span style="color:#aaa;">Creator:</span> <span style="color:#00e5ff;">${creator.slice(0, 6)}…${creator.slice(-4)}</span><br/>
          <span style="color:#aaa;">URI:</span> <span style="color:#888;">${tokenUri.slice(0, 45)}${tokenUri.length > 45 ? "…" : ""}</span>
        `;
      } catch (e) {
        result.textContent = `Error: ${e.reason || e.message}`;
        result.style.color = "#f44";
      }
    };

    panel.querySelector("#btn-mint-product").onclick = async () => {
      await this._mint(panel, "product");
    };

    panel.querySelector("#btn-mint-achievement").onclick = async () => {
      await this._mint(panel, "achievement");
    };

    panel.querySelector("#btn-register").onclick = async () => {
      const statusEl = panel.querySelector("#reg-status");
      statusEl.style.color = "#888";
      statusEl.textContent = "Sending…";
      try {
        const contract = await this._getContract(panel, true);
        if (!contract) {
          statusEl.textContent = "Set contract address & connect wallet";
          return;
        }
        const maxSupply = BigInt(panel.querySelector("#reg-max-supply").value || "0");
        const kind = parseInt(panel.querySelector("#reg-kind").value);
        const uri = panel.querySelector("#reg-uri").value.trim();
        const tx = await contract.registerToken(
          maxSupply,
          uri,
          kind,
          ethers.ZeroAddress,
          0
        );
        statusEl.textContent = `Sent: ${tx.hash.slice(0, 12)}… awaiting…`;
        const receipt = await tx.wait();
        statusEl.style.color = "#0f6";
        statusEl.textContent = `✓ Confirmed in block ${receipt.blockNumber}`;
      } catch (e) {
        statusEl.style.color = "#f44";
        statusEl.textContent = `✗ ${e.reason || e.message}`;
      }
    };
  }

  async _getContract(panel, withSigner) {
    const ethers = window.ethers;
    const addr = (panel.querySelector("#nft-address")?.value || "").trim();
    if (!addr || !ethers.isAddress(addr)) return null;
    if (!window.ethereum) return null;

    const provider = new ethers.BrowserProvider(window.ethereum);
    if (withSigner) {
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      return new ethers.Contract(addr, DECENT_NFT_ABI, signer);
    }
    return new ethers.Contract(addr, DECENT_NFT_ABI, provider);
  }

  async _refreshRoleStatus(panel) {
    const ethers = window.ethers;
    const roleEl = panel.querySelector("#role-status");
    roleEl.textContent = "Checking…";
    roleEl.style.color = "#888";
    try {
      if (!window.ethereum) throw new Error("No wallet");
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const account = await signer.getAddress();
      const contract = await this._getContract(panel, false);
      if (!contract) {
        roleEl.textContent = "Set valid contract address";
        return;
      }

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
      if (!isAdmin && !isMinter)
        parts.push('<span style="color:#888;">No privileged role</span>');

      roleEl.innerHTML = `
        ${account.slice(0, 10)}…${account.slice(-4)} &nbsp;
        ${parts.join(" &nbsp; ")}
      `;
    } catch (e) {
      roleEl.style.color = "#f44";
      roleEl.textContent = `Error: ${e.message}`;
    }
  }

  async _mint(panel, lane) {
    const ethers = window.ethers;
    const prefix = lane === "product" ? "mp" : "ma";
    const fnName = lane === "product" ? "mintProduct" : "mintAchievement";
    const statusEl = panel.querySelector(`#${prefix}-status`);

    statusEl.style.color = "#888";
    statusEl.textContent = "Sending…";

    try {
      if (!window.ethereum) throw new Error("MetaMask not found");
      const to = panel.querySelector(`#${prefix}-to`).value.trim();
      const tokenId = BigInt(panel.querySelector(`#${prefix}-token-id`).value || "0");
      const amount = BigInt(panel.querySelector(`#${prefix}-amount`).value || "1");

      if (!ethers.isAddress(to)) throw new Error("Invalid recipient address");
      if (amount < 1n) throw new Error("Amount must be at least 1");

      const contract = await this._getContract(panel, true);
      if (!contract) throw new Error("Set contract address & connect wallet");

      const tx = await contract[fnName](to, tokenId, amount);
      statusEl.textContent = `Sent: ${tx.hash.slice(0, 12)}… awaiting…`;

      const receipt = await tx.wait();
      statusEl.style.color = "#0f6";
      statusEl.textContent = `✓ Block ${receipt.blockNumber} — minted ${amount} × token ${tokenId}`;
    } catch (e) {
      statusEl.style.color = "#f44";
      statusEl.textContent = `✗ ${e.reason || e.message}`;
    }
  }

  // ── DNFT Control Panel Modal (main / PR #11) ────────────────────────────────
  async showDNFTModal() {
    document.querySelectorAll('[id^="modal-"]').forEach((m) => m.remove());

    const modal = document.createElement("div");
    modal.id = "modal-dnft";
    Object.assign(modal.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      padding: "0",
      background: "rgba(10, 0, 30, 0.97)",
      border: "2px solid #8b00ff",
      borderRadius: "14px",
      boxShadow: "0 0 30px #8b00ff, 0 0 60px rgba(139,0,255,0.3)",
      zIndex: "2000",
      color: "white",
      fontFamily: "monospace",
      minWidth: "320px",
      maxWidth: "420px",
      width: "90vw",
      overflow: "hidden",
    });

    modal.innerHTML = this._buildModalHTML();
    document.body.appendChild(modal);

    modal.querySelector("#dnft-modal-close").addEventListener("click", () => modal.remove());

    const versionSelect = modal.querySelector("#dnft-version-select");
    versionSelect.addEventListener("change", () => {
      const selected = versionSelect.options[versionSelect.selectedIndex];
      if (selected.dataset.available === "false") {
        const currentVersion = VERSIONS.find((v) => v.current);
        versionSelect.value = currentVersion
          ? currentVersion.label
          : versionSelect.options[0].value;
        return;
      }
      if (selected.dataset.href) window.location.href = selected.dataset.href;
    });

    const connectBtn = modal.querySelector("#dnft-connect-btn");
    if (connectBtn) {
      connectBtn.addEventListener("click", () => this._connectWalletInModal(modal));
    }

    const switchBtn = modal.querySelector("#dnft-switch-network-btn");
    if (switchBtn) {
      switchBtn.addEventListener("click", () => this._switchToPolygon(modal));
    }
  }

  _buildModalHTML() {
    const polygonCfg = CONTRACTS.polygon;

    const address = window.ethereum?.selectedAddress || null;
    const isConnected = !!address;
    const chainId = window.ethereum?.chainId || null;
    const chainCfg = chainId ? getChainConfig(chainId) : null;
    const isOnPolygon = chainCfg && chainCfg.chainId === polygonCfg.chainId;

    const shortAddr = address
      ? address.substring(0, 6) + "..." + address.substring(address.length - 4)
      : null;

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

    const versionOptions = VERSIONS.map(
      (v) => `
      <option
        value="${v.label}"
        data-href="${v.href}"
        data-available="${v.available}"
        ${v.current ? "selected" : ""}
        ${!v.available ? "disabled" : ""}
      >${v.label} (${v.description})</option>
    `
    ).join("");

    return `
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
              <div style="font-size: 0.65rem; color: #666;">Chain ID: ${parseInt(
                polygonCfg.chainId,
                16
              )}</div>
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
      alert("MetaMask not detected. Please install MetaMask!");
      return;
    }
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      modal.remove();
      this.showDNFTModal();
    } catch (err) {
      const walletSection = modal.querySelector("#dnft-wallet-section");
      if (walletSection) {
        const errDiv =
          walletSection.querySelector("#dnft-connect-error") ||
          document.createElement("div");
        errDiv.id = "dnft-connect-error";
        errDiv.style.cssText = "color:#ff5722; font-size:0.75rem; margin-top:8px;";
        errDiv.textContent =
          err.code === 4001
            ? "Connection cancelled by user."
            : "Wallet connection failed. Please try again.";
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
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainId }],
      });
      modal.remove();
      this.showDNFTModal();
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: chainConfig.chainId,
                chainName: chainConfig.chainName,
                nativeCurrency: chainConfig.nativeCurrency,
                rpcUrls: chainConfig.rpcUrls,
                blockExplorerUrls: chainConfig.blockExplorerUrls,
              },
            ],
          });
          modal.remove();
          this.showDNFTModal();
        } catch (addErr) {
          console.error("Failed to add Polygon network:", addErr);
        }
      }
    }
  }
}

customElements.define("decent-right-toolbar", RightToolbar);