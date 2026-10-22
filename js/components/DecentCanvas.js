import './DecentCanvas/LeftToolbar.js';
import './DecentCanvas/RightToolbar.js';
import { disposeCollectible } from '../supporter-display.mjs';
import { createMarketCoin } from '../market-coin.mjs';
import { assetKey } from '../market-listings.mjs';
import { openCollectibleCard } from '../market-card.mjs';
import { visibleMarketProducts } from '../market-moderation.mjs';
import { timelinePosition, viewingDistance, COIN_RADIUS, nearbyFlipKeys, advanceStarDepth } from '../market-flight.mjs';

class DecentCanvas extends HTMLElement {
  constructor() {
    super();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.starSprites = [];
    this.canvasCache = {};
    this.controls = null;
    this.showCows = false;
    this.uiLayer = null;
    this.cannonAngle = 0;
    this._productSprites = {}; // asset key → { sprite, flipButton, x, z }
    this._escrowSprites  = {}; // tokenId → { sprite, badge, x, z } for escrow view
    this._flyTarget = null;    // { x, y, z } target for smooth camera animation
    this._galleryGeneration = 0;
    this._collectibleMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this._coinBacks = new Set();
  }

  _filterSpace() {
    const products = this._spaceView === 'escrow' ? this._spaceEscrow || [] : this._spaceProducts || [];
    this._filteredSpace = filterDnfts(visibleMarketProducts(products), this._spaceFilters || defaultFilters);
    if (this._spaceView === 'escrow') this._placeEscrowDNFTs(this._filteredSpace);
    else this._placeGalleryProducts(this._filteredSpace);
    this._reportFilterCount();
  }

  _reportFilterCount() {
    const products = this._spaceView === 'escrow' ? this._spaceEscrow || [] : this._spaceProducts || [];
    document.dispatchEvent(new CustomEvent('market:filter-count', { detail: {
      total: products.length, visible: this._filteredSpace?.length || 0, ...this._spaceStatus,
    } }));
  }

  connectedCallback() {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(75, this.clientWidth / this.clientHeight, 0.1, 10000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.clientWidth, this.clientHeight);
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
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 4000;
    this.controls.addEventListener('start', () => { this._flyTarget = null; this._viewAdjusted = true; });
    this.controls.update();

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

    this._mountFlightControls();
    let pointerStart;
    this.renderer.domElement.addEventListener('pointerdown', event => {
      pointerStart = { x: event.clientX, y: event.clientY };
    });
    this.renderer.domElement.addEventListener('click', (event) => {
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
      const mouse = new THREE.Vector2();
      const rect = this.renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);
      const intersects = raycaster.intersectObjects(this.scene.children.filter(object => typeof object.onClick === 'function'));
      if (intersects.length > 0) {
        const target = intersects[0].object;
        if (typeof target.onClick === 'function') {
          target.onClick();
        }
      }
    });
    this.renderer.domElement.addEventListener('pointermove', event => {
      const rect = this.renderer.domElement.getBoundingClientRect(), mouse = new THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, this.camera);
      const entries = Object.values(this._productSprites);
      const target = ray.intersectObjects(entries.map(entry => entry.sprite))[0]?.object;
      this.renderer.domElement.style.cursor = target ? 'pointer' : '';
    });
    this.renderer.domElement.addEventListener('pointerleave', () => { this.renderer.domElement.style.cursor = ''; });

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
      openCollectibleCard(e.detail.product || { metadata: { ...e.detail.metadata, image: e.detail.token || e.detail.metadata?.image }, tokenId: e.detail.metadata?.tokenId });
    });

    // ── Gallery: place Product DNFTs at depth positions on Z-axis ─────────────
    document.addEventListener('gallery:products-loaded', (e) => {
      this._spaceProducts = e.detail.products;
      if (e.detail.background && this._spaceView === 'escrow') return;
      this._spaceView = 'gallery';
      this._filterSpace();
    });
    document.addEventListener('market:filters', event => { this._spaceFilters = event.detail; this._filterSpace(); });
    document.addEventListener('market:gallery-status', event => { this._spaceStatus = event.detail; this._reportFilterCount(); });
    document.addEventListener('market:moderation', () => this._filterSpace());

    // ── Gallery: clear gallery sprites (e.g. when escrow panel opens) ─────────
    document.addEventListener('gallery:cleared', () => {
      this._galleryGeneration++;
      for (const { sprite, badge, flipButton } of Object.values(this._productSprites)) {
        this.scene.remove(sprite);
        disposeCollectible(sprite);
        flipButton?.remove();
        if (badge) { this.scene.remove(badge); disposeCollectible(badge); }
      }
      this._productSprites = {};
      this._flightKeys = [];
      this._visitEdition(0);
    });

    // ── Escrow: show escrowed DNFTs with color-coded glows ────────────────────
    document.addEventListener('escrow:dnfts-loaded', (e) => {
      this._flightPanel.hidden = true;
      this._spaceEscrow = e.detail.dnfts;
      this._spaceView = 'escrow';
      this._filterSpace();
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
        this._visitEdition(this._flightKeys.indexOf(String(tokenId)));
      }
    });

    // Animation loop
    let lastFrame = performance.now();
    const animate = () => {
      requestAnimationFrame(animate);
      const now = performance.now(), delta = Math.min((now - lastFrame) / 1000, .1);
      lastFrame = now;
      for (const { sprite } of Object.values(this._productSprites)) {
        const target = sprite.userData.showBack ? Math.PI : 0;
        sprite.rotation.y = this._collectibleMotion.matches ? target
          : sprite.rotation.y + (target - sprite.rotation.y) * Math.min(delta * 9, 1);
      }
      if (this.controls) this.controls.update();

      // Smooth fly-to: lerp controls.target toward _flyTarget
      if (this._flyTarget && this.controls) {
        const t = this._collectibleMotion.matches ? 1 : 1 - Math.exp(-7 * delta);
        const shift = new THREE.Vector3(this._flyTarget.x, this._flyTarget.y, this._flyTarget.z).sub(this.controls.target).multiplyScalar(t);
        this.controls.target.add(shift);
        this.camera.position.add(shift);
        const dx = this._flyTarget.x - this.controls.target.x;
        const dy = this._flyTarget.y - this.controls.target.y;
        const dz = this._flyTarget.z - this.controls.target.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.05) {
          this.camera.position.add(new THREE.Vector3(dx, dy, dz));
          this.controls.target.set(this._flyTarget.x, this._flyTarget.y, this._flyTarget.z);
          this._flyTarget = null;
        }
        this.controls.update();
      }

      for (const sprite of this.starSprites) {
        const mat = sprite.material;
        mat.opacity = 0.5 + 0.5 * Math.sin(Date.now() * 0.002 + sprite.position.x);
        if (sprite.userData.isBackground) {
          const position = sprite.userData.starPosition;
          if (!this._collectibleMotion.matches) position.z = advanceStarDepth(position.z, delta);
          sprite.position.copy(position).applyQuaternion(this.camera.quaternion).add(this.camera.position);
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
      const nearby = new Set(nearbyFlipKeys(Object.entries(this._productSprites), this.camera.position, this._selectedEdition));
      for (const [key, { sprite, flipButton }] of Object.entries(this._productSprites)) {
        const point = sprite.position.clone();
        point.y -= COIN_RADIUS * .83;
        point.z += .25;
        point.project(this.camera);
        flipButton.hidden = !nearby.has(key) || Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || Math.abs(point.z) > 1;
        flipButton.style.left = `${(point.x + 1) * this.clientWidth / 2}px`;
        flipButton.style.top = `${(1 - point.y) * this.clientHeight / 2}px`;
      }
    };
    animate();
    // Handle resizing to keep camera and renderer in sync with window size
    window.addEventListener('resize', () => {
      this.camera.aspect = this.clientWidth / this.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.clientWidth, this.clientHeight);
      if (!this._viewAdjusted) {
        if (this._overview) this._overviewFlight(); else this._resetFlightView();
      }
    });
  }

  _mountFlightControls() {
    const panel = document.createElement('section');
    panel.className = 'market-flight';
    panel.setAttribute('aria-label', 'Spaceship timeline controls');
    panel.innerHTML = `
      <div class="market-flight-row"><button type="button" data-newer aria-label="Newer edition">←</button>
      <input type="range" min="0" max="0" value="0" step="1" aria-label="Edition timeline">
      <button type="button" data-older aria-label="Older edition">→</button></div>
      <p data-position role="status">No editions in this view</p>
      <div class="market-flight-row">      <button type="button" data-in aria-label="Zoom in" title="Zoom in">⊕</button>
      <button type="button" data-out aria-label="Back up" title="Back up">⊖</button>
      <button type="button" data-reset aria-label="Reset view" title="Focus selected DNFT">◎</button>
      <button type="button" data-overview aria-label="Spiral overview" title="Spiral overview">⌂</button>
      <button type="button" data-inspect aria-label="Inspect" title="Inspect selected DNFT">🔎</button></div>`;
    this.append(panel);
    this._flightPanel = panel;
    panel.querySelector('[data-newer]').onclick = () => this._visitEdition(this._flightIndex - 1);
    panel.querySelector('[data-older]').onclick = () => this._visitEdition(this._flightIndex + 1);
    panel.querySelector('input').oninput = event => this._visitEdition(Number(event.target.value));
    panel.querySelector('[data-in]').onclick = () => this._zoomFlight(.8);
    panel.querySelector('[data-out]').onclick = () => this._zoomFlight(1.25);
    panel.querySelector('[data-reset]').onclick = () => this._resetFlightView();
    panel.querySelector('[data-overview]').onclick = () => this._overviewFlight();
    panel.querySelector('[data-inspect]').onclick = () => {
      const entry = this._productSprites[this._selectedEdition];
      if (entry) openCollectibleCard(entry.product);
    };
  }

  _visitEdition(index, reset = false) {
    const keys = this._flightKeys || [];
    this._flightIndex = Math.max(0, Math.min(keys.length - 1, index));
    this._selectedEdition = keys[this._flightIndex];
    const entry = this._productSprites[this._selectedEdition];
    const panel = this._flightPanel;
    panel.querySelector('input').max = String(Math.max(0, keys.length - 1));
    panel.querySelector('input').value = String(this._flightIndex);
    panel.querySelector('input').disabled = keys.length < 2;
    panel.querySelector('[data-newer]').disabled = !entry || this._flightIndex === 0;
    panel.querySelector('[data-older]').disabled = !entry || this._flightIndex === keys.length - 1;
    panel.querySelector('[data-inspect]').disabled = !entry;
    panel.querySelector('[data-position]').textContent = entry
      ? `${this._flightIndex + 1} / ${keys.length} · ${entry.product.metadata?.name || `DNFT #${entry.product.tokenId}`}`
      : 'No editions in this view';
    if (!entry) { this._flyTarget = null; return; }
    this._flyTarget = { x: entry.x, y: entry.y, z: entry.z };
    if (reset) {
      if (this._overview !== false) this._overviewFlight(); else this._resetFlightView();
    } else if (this._overview) {
      this._resetFlightView();
    }
  }

  _overviewFlight() {
    const entries = Object.values(this._productSprites);
    if (entries.length < 2) { this._resetFlightView(); this._overview = true; return; }
    const bounds = new THREE.Box3();
    for (const { sprite } of entries) bounds.expandByPoint(sprite.position);
    bounds.expandByScalar(COIN_RADIUS * 1.5);
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const tangent = Math.tan(this.camera.fov * Math.PI / 360);
    const distance = Math.max(size.y / 2 / tangent, size.x / 2 / tangent / this.camera.aspect) * 1.35 + size.z / 2;
    this._flyTarget = null;
    this.controls.maxDistance = Math.max(4000, distance * 2);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
    this.controls.update();
    this._overview = true;
    this._viewAdjusted = false;
  }

  _resetFlightView() {
    const entry = this._productSprites[this._selectedEdition];
    const target = new THREE.Vector3(entry?.x || 0, entry?.y ?? .5, entry?.z ?? -4);
    this._flyTarget = null;
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3(0, 0, viewingDistance(this.camera.aspect)));
    this.controls.update();
    this._viewAdjusted = false;
    this._overview = false;
  }

  _zoomFlight(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, offset.length() * factor)));
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this._viewAdjusted = true;
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
      const size = Math.random() * .7 + .4;
      sprite.scale.set(size, size, 1);
      sprite.userData.isBackground = true;
      sprite.userData.starPosition = new THREE.Vector3((Math.random() - .5) * 100, (Math.random() - .5) * 80, -2 - Math.random() * 118);
      sprite.position.copy(sprite.userData.starPosition).applyQuaternion(this.camera.quaternion).add(this.camera.position);
      sprite.userData.speed = 0.05;
      this.starSprites.push(sprite);
      this.scene && this.scene.add(sprite);
    }
  }

  setRiverEmojis(emojis) {
    this.starEmojis = emojis;
    for (const sprite of this.starSprites) {
      if (!sprite.userData.isBackground) continue;
      sprite.material.map = this.createEmojiTexture(emojis[Math.floor(Math.random() * emojis.length)]);
      sprite.material.needsUpdate = true;
    }
  }

  // Registration/listing order is a browsing sequence, not a verified mint date.
  _placeGalleryProducts(products) {
    if (!this.scene) return;
    this._flightPanel.hidden = false;
    ++this._galleryGeneration;

    // Remove previously placed gallery sprites
    for (const { sprite, badge, flipButton } of Object.values(this._productSprites)) {
      this.scene.remove(sprite);
      disposeCollectible(sprite);
      flipButton?.remove();
      if (badge) { this.scene.remove(badge); disposeCollectible(badge); }
    }
    this._productSprites = {};

    // Clear escrow sprites so the gallery has a clean 3D view
    this._clearEscrowSprites();

    const selectedKey = this._selectedEdition;
    products.forEach((product, idx) => {
      const { x, y, z } = timelinePosition(idx);
      const tokenId = product.tokenId, key = assetKey(product);
      const sprite = createMarketCoin(THREE, product, { onError: message => {
        console.error('[Market artwork]', message);
        document.dispatchEvent(new CustomEvent('market:gallery-status', { detail: { error: message } }));
      } });
      sprite.position.set(x, y, z);
      Object.assign(sprite.userData, { tokenId, x, z, metadata: product.metadata, isProduct: true });
      sprite.userData.showBack = this._coinBacks.has(key);
      sprite.rotation.y = sprite.userData.showBack ? Math.PI : 0;
      sprite.onClick = () => {
        document.dispatchEvent(new CustomEvent("gallery:highlight-card", { detail: { tokenId } }));
        this.uiLayer.dispatchEvent(new CustomEvent('open-nft-modal', { detail: { product } }));
      };
      this.scene.add(sprite);

      const flipButton = document.createElement('button');
      flipButton.hidden = true;
      flipButton.type = 'button';
      flipButton.className = 'market-coin-flip';
      flipButton.textContent = '↻';
      flipButton.setAttribute('aria-label', `Flip ${product.metadata?.name || `DNFT #${tokenId}`} coin`);
      flipButton.setAttribute('aria-pressed', String(sprite.userData.showBack));
      flipButton.title = 'Flip coin';
      flipButton.onclick = () => {
        sprite.userData.showBack = !sprite.userData.showBack;
        if (sprite.userData.showBack) this._coinBacks.add(key); else this._coinBacks.delete(key);
        flipButton.setAttribute('aria-pressed', String(sprite.userData.showBack));
      };
      this.append(flipButton);
      this._productSprites[key] = { sprite, flipButton, product, x, y, z };
    });
    this._flightKeys = products.map(assetKey);
    const index = this._flightKeys.indexOf(selectedKey);
    const wasOverview = this._overview !== false;
    this._visitEdition(Math.max(0, index), !selectedKey || index < 0);
    if (wasOverview) this._overviewFlight();
  }

  // ── Resolve ipfs:// URI to an HTTP gateway URL (canvas helper) ──────────────
  _resolveCanvasIpfsUrl(uri) {
    return resolveMarketAsset(uri);
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
    this._galleryGeneration++;

    // Clear regular gallery sprites — escrow view is mutually exclusive
    for (const { sprite, badge, flipButton } of Object.values(this._productSprites)) {
      this.scene.remove(sprite);
      disposeCollectible(sprite);
      flipButton?.remove();
      if (badge) { this.scene.remove(badge); disposeCollectible(badge); }
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

}

customElements.define('decent-canvas', DecentCanvas);
import { resolveMarketAsset } from '../market-gallery.mjs';
import { defaultFilters, filterDnfts } from '../market-filters.mjs';
