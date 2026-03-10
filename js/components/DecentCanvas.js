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
    this.uiLayer.addEventListener('add-plot', (e) => {
      const { x, y, token } = e.detail;
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(token, (texture) => {
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(x, 0.5, y);
        sprite.scale.set(2, 2, 1);
        this.scene.add(sprite);
        sprite.userData = { x, y, token };
        sprite.onClick = () => {
          if (typeof this.uiLayer.dispatchEvent === 'function') {
            this.uiLayer.dispatchEvent(new CustomEvent('open-nft-modal', {
              detail: { x, y, token }
            }));
          }
        };
      }, undefined, (err) => {
        console.error('Failed to load image URL:', token, err);
      });
    });

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      if (this.controls) this.controls.update();
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
