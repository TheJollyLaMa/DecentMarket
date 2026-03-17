import './DecentCanvas/LeftToolbar.js';
import './DecentCanvas/RightToolbar.js';

class DecentCanvas extends HTMLElement {
  constructor() {
    super();
    this.speedValue = 0;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.starSprites = [];
    this.canvasCache = {};
    this.controls = null;
    this.showCows = false;
    this.uiLayer = null;
    this.cannonAngle = 0;
    this._productSprites = {}; // tokenId → { sprite, badge, x, z }
    this._escrowSprites  = {}; // tokenId → { sprite, badge, x, z } for escrow view
    this._flyTarget = null;    // { x, y, z } target for smooth camera animation
  }

  connectedCallback() {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Attach renderer.domElement to this custom element
    this.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 3, 15);
    this.camera.lookAt(0, -2, 0);

    // Add 200 randomly placed 2D sprite stars using emojis
    this.starEmojis = ['✨', '⭐️'];
    this.cowEmojis = ['🐄', '🐮'];
    this.createStarSprites();

    // Add planets
    const planetEmojis = ['🪐', '☄️', '🌑', '🌞', '🌎', '🌍', '🌏', '🌕', '🌙', '🌝', '🌚'];
    for (let i = 0; i < 20; i++) {
      const emoji = planetEmojis[Math.floor(Math.random() * planetEmojis.length)];
      const texture = this.createEmojiTexture(emoji);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.2 });
      const sprite = new THREE.Sprite(material);
      const size = Math.random() * 1 + 0.5;
      sprite.scale.set(size, size, 1);
      sprite.position.set(
        (Math.random() - 0.5) * 100,
        Math.random() * 20 + 5,
        (Math.random() - 0.5) * 100
      );
      this.scene.add(sprite);
    }

    // OrbitControls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = false;    // disable panning
    this.controls.enableZoom = false;   // disable zoom
    this.controls.minDistance = this.controls.maxDistance = 15; // lock distance
    this.controls.update();

    // Video sphere
    const geometry = new THREE.SphereGeometry(2, 64, 64);
    const video = document.createElement('video');
    video.src = 'img/mandelblum.webm';
    video.loop = true;
    video.muted = true;
    video.play();
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.wrapS = THREE.ClampToEdgeWrapping;
    videoTexture.wrapT = THREE.ClampToEdgeWrapping;
    videoTexture.offset.set(0, 0);
    videoTexture.center.set(0.5, 0.5);
    videoTexture.rotation = Math.PI / 2;
    const material = new THREE.MeshStandardMaterial({
      map: videoTexture,
      emissive: 0xffffff,
      emissiveMap: videoTexture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide
    });
    const mandelblumShip = new THREE.Mesh(geometry, material);
    mandelblumShip.rotation.y = -Math.PI / 2;
    mandelblumShip.position.set(-0.3, -5, 0);

    this.scene.add(mandelblumShip);
    const light = new THREE.PointLight(0xffffff, 1, 100);
    light.position.set(10, 10, 10);
    this.scene.add(light);
    // UI Layer: attach inside this element
    let uiLayer = this.querySelector('decent-ui-layer');
    if (!uiLayer) {
      uiLayer = document.createElement('decent-ui-layer');
      this.appendChild(uiLayer);
      uiLayer = this.querySelector('decent-ui-layer');
    }
    // No need to append renderer.domElement to uiLayer; already attached to this
    this.uiLayer = uiLayer;

    // Mandelblum ship click handler
    mandelblumShip.cursor = 'pointer';
    mandelblumShip.onClick = () => {
      if (typeof this.uiLayer.dispatchEvent === 'function') {
        this.uiLayer.dispatchEvent(new CustomEvent('open-modal'));
      }
    };
    this.renderer.domElement.addEventListener('click', (event) => {
      const mouse = new THREE.Vector2();
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);
      const intersects = raycaster.intersectObjects(this.scene.children);
      if (intersects.length > 0) {
        const target = intersects[0].object;
        if (typeof target.onClick === 'function') {
          target.onClick();
        }
      }
    });

    // Plot NFT images
    // Event detail: { x, y, token, metadata }
    // - token:    image URL (string) — used to load the sprite texture
    // - metadata: optional full token metadata object. When present and
    //             metadata.properties?.product is set, the sprite is rendered
    //             with a gold/cyan product badge to distinguish it from
    //             user-minted DNFTs.
    this.uiLayer.addEventListener('add-plot', (e) => {
      const { x, y, token, metadata } = e.detail;
      const isProduct = !!(metadata?.properties?.product || metadata?.kind === 'Product' ||
        (metadata?.attributes || []).some(a => a.trait_type === 'Kind' && a.value === 'Product'));

      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(token, (texture) => {
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(x, 0.5, y);
        sprite.scale.set(2, 2, 1);
        this.scene.add(sprite);
        sprite.userData = { x, y, token, metadata, isProduct };

        // Product NFTs: overlay a gold glow badge sprite above the image
        if (isProduct) {
          const badgeCanvas = document.createElement('canvas');
          badgeCanvas.width = 256;
          badgeCanvas.height = 256;
          const ctx = badgeCanvas.getContext('2d');
          // Glowing gold ring
          ctx.shadowColor = '#ffd700';
          ctx.shadowBlur = 30;
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = 12;
          ctx.beginPath();
          ctx.arc(128, 128, 110, 0, Math.PI * 2);
          ctx.stroke();
          // "PRODUCT" label
          ctx.shadowBlur = 10;
          ctx.fillStyle = '#ffd700';
          ctx.font = 'bold 26px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('⭐ PRODUCT', 128, 200);
          const badgeTexture = new THREE.CanvasTexture(badgeCanvas);
          const badgeMat = new THREE.SpriteMaterial({ map: badgeTexture, transparent: true, opacity: 0.85 });
          const badge = new THREE.Sprite(badgeMat);
          badge.position.set(x, 1.6, y);
          badge.scale.set(2.2, 2.2, 1);
          badge.userData.isBadge = true;
          this.scene.add(badge);
          sprite.userData.badge = badge;
        }

        sprite.onClick = () => {
          if (typeof this.uiLayer.dispatchEvent === 'function') {
            this.uiLayer.dispatchEvent(new CustomEvent('open-nft-modal', {
              detail: { x, y, token, metadata, isProduct }
            }));
          }
        };
      }, undefined, (err) => {
        console.error('Failed to load image URL:', token, err);
      });
    });

    // NFT detail modal handler — shows ownership-gated UI for product DNFTs
    this.uiLayer.addEventListener('open-nft-modal', (e) => {
      this._openNFTDetailModal(e.detail);
    });

    // ── Gallery: place Product DNFTs at depth positions on Z-axis ─────────────
    document.addEventListener('gallery:products-loaded', (e) => {
      this._placeGalleryProducts(e.detail.products);
    });

    // ── Gallery: clear gallery sprites (e.g. when escrow panel opens) ─────────
    document.addEventListener('gallery:cleared', () => {
      for (const { sprite, badge } of Object.values(this._productSprites)) {
        this.scene.remove(sprite);
        if (badge) this.scene.remove(badge);
      }
      this._productSprites = {};
    });

    // ── Escrow: show escrowed DNFTs with color-coded glows ────────────────────
    document.addEventListener('escrow:dnfts-loaded', (e) => {
      this._placeEscrowDNFTs(e.detail.dnfts);
    });

    // ── Escrow: clear escrow sprites (e.g. when gallery panel re-opens) ───────
    document.addEventListener('escrow:cleared', () => {
      this._clearEscrowSprites();
    });

    // ── Escrow: fly camera to an escrowed DNFT's spiral position ─────────────
    document.addEventListener('escrow:fly-to', (e) => {
      const { tokenId } = e.detail;
      const entry = this._escrowSprites[tokenId];
      if (entry) {
        this._flyTarget = { x: entry.x, y: 0, z: entry.z };
      }
    });

    // ── Gallery: fly camera to a product's position ───────────────────────────
    document.addEventListener('gallery:fly-to', (e) => {
      const { tokenId } = e.detail;
      const entry = this._productSprites[tokenId];
      if (entry) {
        this._flyTarget = { x: entry.x, y: 0, z: entry.z };
      }
    });

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      if (this.controls) this.controls.update();

      // Smooth fly-to: lerp controls.target toward _flyTarget
      if (this._flyTarget && this.controls) {
        const t = 0.06;
        this.controls.target.x += (this._flyTarget.x - this.controls.target.x) * t;
        this.controls.target.y += (this._flyTarget.y - this.controls.target.y) * t;
        this.controls.target.z += (this._flyTarget.z - this.controls.target.z) * t;
        const dx = this._flyTarget.x - this.controls.target.x;
        const dy = this._flyTarget.y - this.controls.target.y;
        const dz = this._flyTarget.z - this.controls.target.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.05) {
          this.controls.target.set(this._flyTarget.x, this._flyTarget.y, this._flyTarget.z);
          this._flyTarget = null;
        }
      }

      for (const sprite of this.starSprites) {
        const mat = sprite.material;
        mat.opacity = 0.5 + 0.5 * Math.sin(Date.now() * 0.002 + sprite.position.x);
        if (sprite.userData.isBackground) {
          sprite.position.z += (this.speedValue / 100) * 0.5;
          if (sprite.position.z > 25) {
            sprite.position.z = -25;
          }
        }
        if (sprite.userData.isProjectile) {
          sprite.position.x += sprite.userData.vx;
          sprite.position.z += sprite.userData.vz;
          if (sprite.position.z < -30 || Math.abs(sprite.position.x) > 50) {
            this.scene.remove(sprite);
          }
        }
      }
      this.renderer.render(this.scene, this.camera);
    };
    animate();
    // Handle resizing to keep camera and renderer in sync with window size
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // Utility: create emoji texture
  createEmojiTexture(emoji) {
    if (this.canvasCache[emoji]) return this.canvasCache[emoji];
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.font = `${size * 0.8}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2);
    const texture = new THREE.CanvasTexture(canvas);
    this.canvasCache[emoji] = texture;
    return texture;
  }

  // Utility: create the star sprites
  createStarSprites() {
    for (let i = 0; i < 200; i++) {
      const activeEmojis = this.showCows ? this.cowEmojis : this.starEmojis;
      const emoji = activeEmojis[Math.floor(Math.random() * activeEmojis.length)];
      const texture = this.createEmojiTexture(emoji);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.08 });
      const sprite = new THREE.Sprite(material);
      const size = Math.random() * 0.3 + 0.1;
      sprite.scale.set(size, size, 1);
      sprite.position.set(
        (Math.random() - 0.5) * 50,
        Math.random() * 10 + 2,
        (Math.random() - 0.5) * 50
      );
      sprite.userData.isBackground = true;
      sprite.userData.speed = 0.05;
      this.starSprites.push(sprite);
      this.scene && this.scene.add(sprite);
    }
  }

  // NFT detail modal — shows product metadata and ownership-gated CTAs
  // Called when an NFT sprite is clicked in the 3D canvas.

  // Returns true only for safe https:// or http:// URLs — prevents XSS via javascript: etc.
  _isSafeUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }

  _openNFTDetailModal({ token, metadata, isProduct }) {
    // Remove any existing NFT detail modals
    const existing = document.getElementById('nft-detail-modal');
    if (existing) existing.remove();

    const m = document.createElement('div');
    m.id = 'nft-detail-modal';
    Object.assign(m.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '0',
      background: 'rgba(0, 10, 20, 0.97)',
      border: `2px solid ${isProduct ? '#ffd700' : '#00e5ff'}`,
      borderRadius: '14px',
      boxShadow: `0 0 30px ${isProduct ? '#ffd700' : '#00e5ff'}`,
      zIndex: '2000',
      color: '#fff',
      fontFamily: 'monospace',
      minWidth: '300px',
      maxWidth: '420px',
      width: '90vw',
      maxHeight: '85vh',
      overflowY: 'auto',
    });

    const name = metadata?.name || 'Unknown NFT';
    const description = metadata?.description || '';
    const product = metadata?.properties?.product || null;
    const version = product?.version || '';
    const repo_url = product?.repo_url || '';
    const commit = product?.commit || '';
    const artifact_cid = product?.artifact_cid || '';
    const opensea_url = product?.opensea_url || '';

    // Gateway-resolve ipfs:// image for display
    let displayImg = token;
    if (displayImg?.startsWith('ipfs://')) {
      const cid = displayImg.replace('ipfs://', '');
      displayImg = `https://${cid}.ipfs.w3s.link/`;
    }

    // Check ownership (ERC-1155 balanceOf) — async, filled in after render
    const productBadge = isProduct
      ? `<span style="
          display:inline-block;background:#ffd700;color:#000;
          border-radius:4px;padding:1px 8px;font-size:0.65rem;
          font-weight:bold;letter-spacing:0.05em;margin-left:6px;
        ">⭐ PRODUCT</span>`
      : '';

    const productFields = product ? `
      <div style="margin-top:8px;padding:8px 10px;background:rgba(255,215,0,0.06);border:1px solid #ffd70033;border-radius:6px;font-size:0.68rem;">
        ${version ? `<div><span style="color:#888;">Version:</span> <span style="color:#ffd700;">${version}</span></div>` : ''}
        ${repo_url && this._isSafeUrl(repo_url) ? `<div style="margin-top:3px;"><span style="color:#888;">Repo:</span> <a href="${repo_url}" target="_blank" rel="noopener noreferrer" style="color:#00e5ff;text-decoration:none;">${repo_url}</a></div>` : ''}
        ${commit && this._isSafeUrl(commit) ? `<div style="margin-top:3px;"><span style="color:#888;">Commit:</span> <a href="${commit}" target="_blank" rel="noopener noreferrer" style="color:#00e5ff;text-decoration:none;word-break:break-all;">${commit.length > 50 ? commit.slice(0, 47) + '…' : commit}</a></div>` : ''}
        ${artifact_cid ? `<div style="margin-top:3px;"><span style="color:#888;">Artifact:</span> <span style="color:#aaa;word-break:break-all;">${artifact_cid.length > 40 ? artifact_cid.slice(0, 37) + '…' : artifact_cid}</span></div>` : ''}
      </div>` : '';

    m.innerHTML = `
      <div style="
        background:linear-gradient(90deg,${isProduct ? '#1a1400,#2a2000' : '#001a20,#002030'});
        padding:12px 16px;display:flex;align-items:center;justify-content:space-between;
        border-bottom:1px solid ${isProduct ? '#ffd700' : '#00e5ff'};
        border-radius:12px 12px 0 0;
      ">
        <div style="font-size:0.95rem;font-weight:bold;color:${isProduct ? '#ffd700' : '#00e5ff'};">
          ${name}${productBadge}
        </div>
        <button id="nft-detail-close" style="background:none;border:none;color:#aaa;font-size:1.1rem;cursor:pointer;line-height:1;padding:0;">✕</button>
      </div>
      <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
        ${displayImg ? `<img src="${displayImg}" alt="${name}" style="max-width:100%;max-height:150px;border-radius:8px;border:1px solid ${isProduct ? '#ffd700' : '#00e5ff'};object-fit:contain;"/>` : ''}
        ${description ? `<div style="font-size:0.75rem;color:#ccc;line-height:1.4;">${description}</div>` : ''}
        ${productFields}
        <div id="nft-detail-cta" style="margin-top:4px;">
          <div style="font-size:0.65rem;color:#555;text-align:center;">Checking ownership…</div>
        </div>
      </div>
    `;

    document.body.appendChild(m);
    m.querySelector('#nft-detail-close').onclick = () => m.remove();

    // Close on outside click
    setTimeout(() => {
      const outside = (e) => {
        if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', outside); }
      };
      document.addEventListener('click', outside);
    }, 0);

    // Async ownership check
    this._checkNFTOwnership({ metadata, opensea_url }).then(ctaHTML => {
      const ctaEl = m.querySelector('#nft-detail-cta');
      if (ctaEl) ctaEl.innerHTML = ctaHTML;
    });
  }

  // Checks balanceOf for product NFTs and returns appropriate CTA HTML
  async _checkNFTOwnership({ metadata, opensea_url }) {
    const btnBase = `
      display:inline-block;padding:7px 14px;border-radius:6px;
      font-family:monospace;font-size:0.75rem;cursor:pointer;
      text-decoration:none;font-weight:bold;`;

    // Without a tokenId we can't query the chain — show generic links
    const tokenId = metadata?.tokenId ?? null;
    const contractAddr = localStorage.getItem('decentNFT_address') || '';

    if (!window.ethereum || !contractAddr || tokenId === null) {
      return this._buildPurchaseCTA(opensea_url, btnBase);
    }

    try {
      const ethers = window.ethers;
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (!accounts || accounts.length === 0) return this._buildPurchaseCTA(opensea_url, btnBase);

      const account = accounts[0];
      const abi = ['function balanceOf(address account, uint256 id) view returns (uint256)'];
      const contract = new ethers.Contract(contractAddr, abi, provider);
      const balance = await contract.balanceOf(account, BigInt(tokenId));

      if (balance > 0n) {
        // Owner: show full-access indicator
        const safeOsUrl = opensea_url && this._isSafeUrl(opensea_url) ? opensea_url : null;
        return `
          <div style="text-align:center;">
            <span style="color:#00e676;font-size:0.8rem;">✅ You own this NFT</span>
            <div style="margin-top:6px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
              ${safeOsUrl ? `<a href="${safeOsUrl}" target="_blank" rel="noopener noreferrer" style="${btnBase}background:#000;color:#2081e2;border:1px solid #2081e2;box-shadow:0 0 6px #2081e2;">🔵 View on OpenSea</a>` : ''}
            </div>
          </div>`;
      } else {
        return this._buildPurchaseCTA(opensea_url, btnBase);
      }
    } catch {
      return this._buildPurchaseCTA(opensea_url, btnBase);
    }
  }

  _buildPurchaseCTA(opensea_url, btnBase) {
    const safeOsUrl = opensea_url && this._isSafeUrl(opensea_url) ? opensea_url : null;
    const osLink = safeOsUrl
      ? `<a href="${safeOsUrl}" target="_blank" rel="noopener noreferrer"
           style="${btnBase}background:#000;color:#2081e2;border:1px solid #2081e2;box-shadow:0 0 6px #2081e2;">
           🛒 Purchase on OpenSea
         </a>`
      : `<span style="color:#555;font-size:0.68rem;">OpenSea link coming soon</span>`;

    return `
      <div style="text-align:center;">
        <div style="color:#f80;font-size:0.72rem;margin-bottom:8px;">
          🔒 You don't own this NFT yet
        </div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          ${osLink}
          <a href="https://opensea.io/collection/decenthead" target="_blank" rel="noopener"
             style="${btnBase}background:#000;color:#00e5ff;border:1px solid #00e5ff;box-shadow:0 0 6px #00e5ff;">
             👁 View Access
          </a>
        </div>
      </div>`;
  }

  // ── Place Product DNFTs in the 3D scene at depth positions ─────────────────
  // Products are sorted newest-first; newest appears closest to the camera (Z near 0),
  // oldest is deepest (most negative Z). Each product is spaced 8 units apart.
  _placeGalleryProducts(products) {
    if (!this.scene) return;

    // Remove previously placed gallery sprites
    for (const { sprite, badge } of Object.values(this._productSprites)) {
      this.scene.remove(sprite);
      if (badge) this.scene.remove(badge);
    }
    this._productSprites = {};

    // Clear escrow sprites so the gallery has a clean 3D view
    this._clearEscrowSprites();

    const spacing = 8;
    products.forEach((product, idx) => {
      const x = 0;
      const z = -(idx + 1) * spacing; // newest → -8, next → -16, …
      const tokenId = product.tokenId;

      const imageUri = product.metadata?.image || "";
      const displayImg = this._resolveCanvasIpfsUrl(imageUri);
      if (!displayImg) return;

      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(displayImg, (texture) => {
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(x, 0.5, z);
        sprite.scale.set(3, 3, 1);
        sprite.userData = { tokenId, x, z, metadata: product.metadata, isProduct: true };

        sprite.onClick = () => {
          // Highlight the corresponding gallery card (canvas → panel sync)
          document.dispatchEvent(new CustomEvent("gallery:highlight-card", { detail: { tokenId } }));
          // Open NFT detail modal
          if (typeof this.uiLayer.dispatchEvent === 'function') {
            this.uiLayer.dispatchEvent(new CustomEvent('open-nft-modal', {
              detail: { x, y: z, token: displayImg, metadata: product.metadata, isProduct: true },
            }));
          }
        };

        this.scene.add(sprite);

        // Gold glow ring + label badge
        const badgeCanvas = document.createElement('canvas');
        badgeCanvas.width = 256;
        badgeCanvas.height = 256;
        const ctx = badgeCanvas.getContext('2d');
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 30;
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(128, 128, 110, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 24px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🗿 DNFT', 128, 200);
        const badgeTexture = new THREE.CanvasTexture(badgeCanvas);
        const badgeMat = new THREE.SpriteMaterial({ map: badgeTexture, transparent: true, opacity: 0.85 });
        const badge = new THREE.Sprite(badgeMat);
        badge.position.set(x, 2.1, z);
        badge.scale.set(3.2, 3.2, 1);
        this.scene.add(badge);

        this._productSprites[tokenId] = { sprite, badge, x, z };
      }, undefined, (err) => {
        console.warn(`Gallery: failed to load image for token #${tokenId}:`, displayImg, err);
      });
    });
  }

  // ── Resolve ipfs:// URI to an HTTP gateway URL (canvas helper) ──────────────
  _resolveCanvasIpfsUrl(uri) {
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

  // ── Remove all escrow sprites from the 3D scene ───────────────────────────
  _clearEscrowSprites() {
    if (!this.scene) return;
    for (const { sprite, badge } of Object.values(this._escrowSprites)) {
      this.scene.remove(sprite);
      if (badge) this.scene.remove(badge);
    }
    this._escrowSprites = {};
  }

  // ── Place escrowed DNFTs in the 3D scene with color-coded glows ───────────
  // dnfts: [{ tokenId, imageUrl, isListed, metadata }]
  // isListed=true → green glow (listed for sale)
  // isListed=false → red glow (in escrow, not yet listed)
  // Layout: helical spiral around the Z axis — items wind in a helix as depth
  // increases so the user can fly through the spiral using OrbitControls.
  _placeEscrowDNFTs(dnfts) {
    if (!this.scene) return;

    // Clear regular gallery sprites — escrow view is mutually exclusive
    for (const { sprite, badge } of Object.values(this._productSprites)) {
      this.scene.remove(sprite);
      if (badge) this.scene.remove(badge);
    }
    this._productSprites = {};

    // Clear any previous escrow sprites
    this._clearEscrowSprites();

    // Helix parameters: items spiral around the Z axis as depth increases.
    const HELIX_RADIUS     = 6;            // radius of the helix circle (XY plane)
    const HELIX_ANGLE_STEP = Math.PI * 0.72; // angular step per item (≈ 130°, golden-ish)
    const Z_STEP           = 6;            // depth spacing per item along -Z

    dnfts.forEach((dnft, idx) => {
      const angle = idx * HELIX_ANGLE_STEP;
      const x = HELIX_RADIUS * Math.cos(angle);
      const y = 0.5;
      const z = -(idx + 1) * Z_STEP;
      const { tokenId, imageUrl, isListed } = dnft;

      if (!imageUrl) {
        // Still record position so fly-to works even without an image
        this._escrowSprites[tokenId] = { sprite: null, badge: null, x, z };
        return;
      }

      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(imageUrl, (texture) => {
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(x, y, z);
        sprite.scale.set(3, 3, 1);
        sprite.userData = { tokenId, x, z, isEscrow: true, isListed };

        // Click: fly camera here + broadcast selection to escrow panel
        sprite.onClick = () => {
          this._flyTarget = { x, y: 0, z };
          document.dispatchEvent(new CustomEvent('escrow:sprite-selected', {
            detail: { tokenId, isListed, metadata: dnft.metadata, imageUrl },
          }));
        };

        this.scene.add(sprite);

        // Color-coded glow badge: green = listed for sale, red = escrow only
        const glowColor  = isListed ? '#00ff88' : '#ff2244';
        const glowShadow = isListed ? '#00ff88' : '#ff0000';
        const label      = isListed ? '🟢 LISTED' : '🔴 ESCROW';

        const badgeCanvas = document.createElement('canvas');
        badgeCanvas.width  = 256;
        badgeCanvas.height = 256;
        const ctx = badgeCanvas.getContext('2d');
        ctx.shadowColor = glowShadow;
        ctx.shadowBlur  = 30;
        ctx.strokeStyle = glowColor;
        ctx.lineWidth   = 10;
        ctx.beginPath();
        ctx.arc(128, 128, 110, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 8;
        ctx.fillStyle  = glowColor;
        ctx.font       = 'bold 22px monospace';
        ctx.textAlign  = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 128, 200);

        const badgeTexture = new THREE.CanvasTexture(badgeCanvas);
        const badgeMat = new THREE.SpriteMaterial({ map: badgeTexture, transparent: true, opacity: 0.85 });
        const badge = new THREE.Sprite(badgeMat);
        badge.position.set(x, y + 1.6, z);
        badge.scale.set(3.2, 3.2, 1);
        this.scene.add(badge);

        this._escrowSprites[tokenId] = { sprite, badge, x, z };
      }, undefined, (err) => {
        console.warn(`Escrow: failed to load image for token #${tokenId}:`, imageUrl, err);
      });
    });
  }

  // Toggle between star and cow background
  toggleStars() {
    for (const sprite of this.starSprites) {
      this.scene.remove(sprite);
    }
    this.starSprites.length = 0;
    this.showCows = !this.showCows;
    this.createStarSprites();
  }

  setSpeed(val) {
    this.speedValue = val;
  }
}

customElements.define('decent-canvas', DecentCanvas);
