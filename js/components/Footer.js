class DecentFoot extends HTMLElement {
  connectedCallback() {
    // Get references to canvas element internals
    const canvasEl = document.querySelector('decent-canvas');
    const scene = canvasEl?.scene;
    const camera = canvasEl?.camera;
    const starSprites = canvasEl?.starSprites;
    const createEmojiTexture = (emoji) => canvasEl?.createEmojiTexture(emoji);
    const setSpeed = (val) => canvasEl?.setSpeed(val);

    let cannonAngle = 0;
    let shootingCows = false;
    let shootingHearts = false;
    let shootingSuns = false;
    let shootingGems = false;
    let shootingFungis = false;
    let shootingButter = false;
    let lastShotTime = 0;

    // Build dial + controls
    const toggleWrapper = document.createElement('div');
    toggleWrapper.style.position = 'absolute';
    toggleWrapper.style.bottom = '10px';
    toggleWrapper.style.left = '50%';
    toggleWrapper.style.transform = 'translateX(-50%)';
    toggleWrapper.style.display = 'flex';
    toggleWrapper.style.alignItems = 'center';
    toggleWrapper.style.zIndex = '100';

    // Phone icon
    const phoneLink = document.createElement('a');
    phoneLink.href = 'tel:+1234567890';
    phoneLink.target = '_blank';
    const phoneIcon = document.createElement('img');
    phoneIcon.src = 'img/phone.png';
    phoneIcon.style.width = '30px';
    phoneIcon.style.height = '30px';
    phoneIcon.style.marginRight = '15px';
    phoneIcon.style.borderRadius = '50%';
    phoneLink.appendChild(phoneIcon);

    // GitHub icon
    const githubLink = document.createElement('a');
    githubLink.href = 'https://github.com/TheJollyLaMa/DecentFoot';
    githubLink.target = '_blank';
    const githubIcon = document.createElement('img');
    githubIcon.src = 'img/Github_Logo.png';
    githubIcon.style.width = '30px';
    githubIcon.style.height = '30px';
    githubIcon.style.marginRight = '15px';
    githubLink.appendChild(githubIcon);

    // Left cannon
    const cannonLeft = document.createElement('img');
    cannonLeft.src = 'img/cannon.png';
    cannonLeft.style.width = '60px';
    cannonLeft.style.height = '60px';
    cannonLeft.style.marginRight = '20px';

    // Radial dial
    const dialWrapper = document.createElement('div');
    dialWrapper.style.position = 'relative';
    dialWrapper.style.width = '100px';
    dialWrapper.style.height = '100px';
    dialWrapper.style.borderRadius = '50%';
    dialWrapper.style.border = '2px solid #444';
    dialWrapper.style.display = 'flex';
    dialWrapper.style.alignItems = 'center';
    dialWrapper.style.justifyContent = 'center';
    dialWrapper.style.background = '#111';

    const centerDot = document.createElement('div');
    centerDot.style.width = '20px';
    centerDot.style.height = '20px';
    centerDot.style.background = '#fff';
    centerDot.style.borderRadius = '50%';
    dialWrapper.appendChild(centerDot);

    const radialOptions = [
      { emoji: '⭐️', emojis: ['✨', '⭐️'] },
      { emoji: '🐄', emojis: ['🐄', '🐮'] },
      { emoji: '💎', emojis: ['💎', '🔮', '💠', '💍', '🪙'] },
      { emoji: '❤️', emojis: ['❤️', '💘', '💖', '💗', '💓', '💕', '💞'] },
      { emoji: '🌞', emojis: ['🌞', '🌻', '😊', '😎', '☀️'] },
    ];

    radialOptions.forEach((option, i) => {
      const angle = (i / radialOptions.length) * Math.PI * 2;
      const btn = document.createElement('button');
      btn.textContent = option.emoji;
      btn.style.position = 'absolute';
      btn.style.left = `${50 + Math.cos(angle) * 40}%`;
      btn.style.top = `${50 + Math.sin(angle) * 40}%`;
      btn.style.transform = 'translate(-50%, -50%)';
      btn.style.width = '30px';
      btn.style.height = '30px';
      btn.style.borderRadius = '50%';
      btn.style.border = 'none';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '18px';
      btn.style.background = '#222';
      btn.style.color = '#fff';
      btn.addEventListener('click', () => setBackgroundEmojis(option.emojis));
      dialWrapper.appendChild(btn);
    });

    // Speed dial
    const speedDial = document.createElement('div');
    speedDial.style.position = 'relative';
    speedDial.style.width = '100px';
    speedDial.style.height = '100px';
    speedDial.style.borderRadius = '50%';
    speedDial.style.border = '2px solid #444';
    speedDial.style.background = '#111';
    speedDial.style.display = 'flex';
    speedDial.style.alignItems = 'center';
    speedDial.style.justifyContent = 'center';
    speedDial.style.marginLeft = '30px';
    speedDial.style.color = '#fff';

    for (let tickAngle = 210; tickAngle <= 330; tickAngle += 10) {
      const tick = document.createElement('div');
      tick.style.position = 'absolute';
      tick.style.width = '2px';
      tick.style.height = '8px';
      tick.style.background = '#888';
      const radius = 48;
      const rad = tickAngle * (Math.PI / 180);
      tick.style.left = `${50 + Math.cos(rad) * radius}%`;
      tick.style.top = `${50 + Math.sin(rad) * radius}%`;
      tick.style.transform = 'translate(-50%, -50%)';
      speedDial.appendChild(tick);
    }

    const knob = document.createElement('div');
    knob.style.position = 'absolute';
    knob.style.width = '20px';
    knob.style.height = '20px';
    knob.style.background = '#0ff';
    knob.style.border = '2px solid #fff';
    knob.style.borderRadius = '50%';
    knob.style.top = '50%';
    knob.style.left = '50%';
    knob.style.transform = 'translate(-50%, -50%)';
    knob.style.cursor = 'pointer';
    speedDial.appendChild(knob);

    let isDragging = false;
    let speedValue = 0;

    function updateKnob(angle) {
      if (angle < 210) angle = 210;
      if (angle > 330) angle = 330;
      const radius = 45;
      const rad = angle * (Math.PI / 180);
      knob.style.left = `${50 + Math.cos(rad) * radius}%`;
      knob.style.top = `${50 + Math.sin(rad) * radius}%`;
      const scaled = Math.round(((angle - 210) / 120) * 100);
      speedValue = scaled;
      setSpeed(scaled);
    }

    function handleDrag(x, y) {
      const rect = speedDial.getBoundingClientRect();
      const dx = x - (rect.left + rect.width / 2);
      const dy = y - (rect.top + rect.height / 2);
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);
      if (angle < 0) angle += 360;
      updateKnob(angle);
    }

    speedDial.addEventListener('mousedown', e => {
      isDragging = true;
      handleDrag(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', e => {
      if (isDragging) handleDrag(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', () => isDragging = false);

    updateKnob(210);

    // Right cannon
    const cannonRight = document.createElement('img');
    cannonRight.src = 'img/cannon.png';
    cannonRight.style.width = '60px';
    cannonRight.style.height = '60px';
    cannonRight.style.marginLeft = '20px';
    cannonRight.style.transform = 'scaleX(-1)';

    // Discord
    const discordLink = document.createElement('a');
    discordLink.href = 'https://discord.gg/tkBfwT3YMN';
    discordLink.target = '_blank';
    const discordIcon = document.createElement('img');
    discordIcon.src = 'img/discord.png';
    discordIcon.style.width = '30px';
    discordIcon.style.height = '30px';
    discordIcon.style.marginLeft = '15px';
    discordLink.appendChild(discordIcon);

    // Mail
    const mailLink = document.createElement('a');
    mailLink.href = 'mailto:adecentagency@gmail.com';
    mailLink.target = '_blank';
    const mailIcon = document.createElement('img');
    mailIcon.src = 'img/mail.png';
    mailIcon.style.width = '30px';
    mailIcon.style.height = '30px';
    mailIcon.style.marginLeft = '15px';
    mailIcon.style.borderRadius = '50%';
    mailLink.appendChild(mailIcon);

    toggleWrapper.appendChild(phoneLink);
    toggleWrapper.appendChild(githubLink);
    toggleWrapper.appendChild(cannonLeft);
    toggleWrapper.appendChild(dialWrapper);
    toggleWrapper.appendChild(speedDial);
    toggleWrapper.appendChild(cannonRight);
    toggleWrapper.appendChild(discordLink);
    toggleWrapper.appendChild(mailLink);

    this.appendChild(toggleWrapper);

    // Allow emoji picker to set background
    function setBackgroundEmojis(emojis) {
      if (!scene || !starSprites || !createEmojiTexture) return;
      for (const sprite of starSprites) scene.remove(sprite);
      starSprites.length = 0;
      for (let i = 0; i < 200; i++) {
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        const texture = createEmojiTexture(emoji);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.08 });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(Math.random() * 0.3 + 0.1, Math.random() * 0.3 + 0.1, 1);
        sprite.position.set((Math.random() - 0.5) * 50, Math.random() * 10 + 2, (Math.random() - 0.5) * 50);
        sprite.userData.isBackground = true;
        starSprites.push(sprite);
        scene.add(sprite);
      }
    }
  }
}

customElements.define('decent-foot', DecentFoot);