class WaitingModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.shadowRoot.innerHTML = `
      <style>
        .modal-instructions {
          position: absolute;
          z-index: 1;
          bottom: 10%;
          left: 50%;
          transform: translateX(-50%);
          color: #00e5ff;
          font-size: 1rem;
          margin-top: 20px;
          text-align: center;
          width: 100%;
          text-shadow: 0 0 8px #7300ff;
        }

        .modal-instructions a {
          color: #00ffff;
          text-decoration: underline;
        }

        .modal-instructions a:hover {
          color: #ffffff;
        }

        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modal-content {
          position: relative;
          aspect-ratio: 16/9;
          max-width: 800px;
          width: 90%;
          height: auto;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid #ccc;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          overflow: hidden;
        }

        .modal-content::before {
          content: '';
          background: url('img/IPFS_Companion.gif') center center / cover no-repeat;
          position: absolute;
          top: 0; left: 0;
          right: 0; bottom: 0;
          opacity: 0.4;
          z-index: 0;
        }

        .modal-message {
          position: relative;
          z-index: 1;
          color: white;
          font-size: 1.25rem;
          margin-top: 10%;
        }
        .modal-message img {
          vertical-align: middle;
          margin-right: 8px;
          height: 24px;
        }

        .belly-anchor {
          position: absolute;
          top: 65%;
          left: 50.5%;
          transform: translate(-50%, -50%);
          width: 100px;
          height: 100px;
          z-index: 2;
        }

        .icon-ring {
          position: relative;
          width: 100px;
          height: 100px;
          margin-top: 0;
          margin-left: auto;
          margin-right: auto;
          z-index: 1;
        }

        .icon-ring img {
          position: absolute;
          width: 20px;
          height: 20px;
          transform-origin: 50px 50px;
        }

        #prompt-button {
          background: #00e5ff;
          color: #000;
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          margin-top: 1rem;
          z-index: 2;
          position: relative;
        }
      </style>

      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-message" id="modalMessage">
            <img src="img/Web3Storage.png" alt="Web3Storage Logo" />
            🛜 Send my credentials to my browser
          </div>
          <button id="prompt-button">Enter Email</button>
          <div class="belly-anchor">
            <div class="icon-ring" id="iconRing"></div>
          </div>
          <div class="modal-instructions" id="modalInstructions">
            👉 <a href="https://web3.storage" target="_blank" rel="noopener noreferrer">Don't have a web3.storage account yet? Create one here</a>
          </div>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    this.renderRing();
    // Add event listener for the prompt button to switch content
    const promptBtn = this.shadowRoot.getElementById('prompt-button');
    if (promptBtn) {
      promptBtn.addEventListener('click', () => {
        if (window.promptForEmail) {
          window.promptForEmail();
        }
        const msg = this.shadowRoot.getElementById('modalMessage');
        if (msg) {
          msg.innerHTML = '<img src="img/Web3Storage.png" alt="Web3Storage Logo" /> 🛜 Please check your email and click the confirmation button to complete the ipfs connection. 🪐📂';
        }
        const instructions = this.shadowRoot.getElementById('modalInstructions');
        if (instructions) {
          instructions.innerHTML = '🔎 <a href="https://ipfs.tech" target="_blank" rel="noopener noreferrer">Learn more about IPFS</a>';
        }
      });
    }
  }

  renderRing() {
    const icons = ['img/IPFS_Logo.png', 'img/Ens_Eth_Breathe.png'];
    const ring = this.shadowRoot.getElementById('iconRing');
    const totalIcons = 8;
    const radius = 40;
    for (let i = 0; i < totalIcons; i++) {
      const img = document.createElement('img');
      img.src = icons[i % icons.length];
      const angle = (2 * Math.PI * i) / totalIcons;
      const x = 50 + radius * Math.cos(angle) - 9;
      const y = 50 + radius * Math.sin(angle) - 9;
      img.style.left = `${x}px`;
      img.style.top = `${y}px`;
      ring.appendChild(img);
    }

    let angle = 0;
    function animate() {
      ring.style.transform = `rotate(${angle}deg)`;
      angle += 0.5;
      requestAnimationFrame(animate);
    }
    animate();
  }
}

customElements.define('waiting-modal', WaitingModal);