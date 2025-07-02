class AboutModal extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    console.log("AboutModal connected");
    console.log('📦 AboutModal connected to DOM');
    this.render();
  }

  open() {
    console.log("AboutModal open() called");
    console.log('📬 AboutModal.open() triggered');
    this.shadowRoot.querySelector('.modal-container').style.display = 'block';
  }

  close() {
    this.shadowRoot.querySelector('.modal-container').style.display = 'none';
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .modal-container {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          z-index: 99999;
          backdrop-filter: blur(6px);
          padding: 40px;
          box-sizing: border-box;
          overflow-y: auto;
        }
        .modal-box {
          background: #111;
          border: 2px solid #00e5ff;
          border-radius: 16px;
          max-width: 720px;
          margin: auto;
          padding: 24px;
          color: white;
          font-family: 'Courier New', monospace;
          animation: fadeIn 0.4s ease;
          box-shadow: 0 0 20px #00e5ffaa;
        }
        .modal-box h2 {
          margin-top: 0;
          font-size: 1.8rem;
          color: #00e5ff;
          text-align: center;
        }
        .about-section {
          margin: 1.5em 0;
        }
        .about-section img {
          height: 20px;
          vertical-align: middle;
          margin-right: 6px;
        }
        .close-btn {
          float: right;
          background: #00e5ff;
          color: black;
          border: none;
          padding: 6px 12px;
          font-weight: bold;
          cursor: pointer;
          border-radius: 8px;
          margin-bottom: 12px;
        }
        a {
          color: #00e5ff;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
      <div class="modal-container">
        <div class="modal-box">
          <button class="close-btn" id="close-about">Close</button>
          <h2>🦚 About Decent Head 🦚</h2>

          <div class="about-section">
            <p>This project is part of the <strong>Decent Agency and Decent Smart Home</strong> suite of web3-powered tools and interfaces.</p>
            <p>It is designed to provide a decentralized, token-rewarded data sharing platform using IPFS and the network of the Ethereum Virtual Machine.</p>
            <p>Decent Head is a simple, yet powerful, web3 interface that allows users to interact with IPFS data storage and share their data in a decentralized manner.</p>
            <p>It leverages the <strong>Web3.Storage</strong> service for IPFS data storage and retrieval, and integrates with <strong>MetaMask</strong> for wallet connectivity.</p>
            <p>Decent Head is distributed via the Decent NFT contract. It is meant to be forked, cloned, and customized.  The Decent head may also be resold after some noticable changes are made that claim it as your own.  Royalties are appreciated during the legitimate resale via the Decent NFT contract.  Decent Head is a living submodule meant to be a generic start to your organization's decentralized web3 journey.</p>

            <p>Purchase the latest rollout of Decent Head for the latest features and updates and use its codebase for a template or submodule in your organization's web3 hub.  Your community members will then begin their journey of deciding what data is valuable to them and how valuable it is - internally, externally, and both together!</p>

          </div>

          <div class="about-section">
            <h3>🔗 Key Links:</h3>
            <ul>
              <li><img src="./img/IPFS_Logo.png"/> <a href="https://w3s.link" target="_blank">Web3.Storage Console</a></li>
              <li><img src="./img/MetaMaskFox.png"/> <a href="https://metamask.io/" target="_blank">MetaMask</a></li>
              <li><img src="./img/Ommm.png"/> <a href="https://app.uniswap.org/explore/tokens/polygon/0x1a74f818F1b42dBFcE449c7Fa93B107C6e4A2433" target="_blank">Buy Ommm on Uniswap</a></li>
            </ul>
          </div>

          <div class="about-section">
            <h3>✨ Features:</h3>
            <ul>
              <li>IPFS data storage with W3Up</li>
              <li>Token-rewarded data sharing (Ommm)</li>
              <li>MetaMask integration & token balance display</li>
              <li>Expandable dropdowns and subscription options</li>
              <li>Right-Ankh integrates your website with ERC standards for further web3 infrastructural development.</li>
              <li>Left-Ankh organizes your liquidity pool and collective data sharing paradigm with your community.</li>
            </ul>
          </div>

          <div class="about-section">
            <p>Built with a ton of ❣️💗❣️ and a bare minimum of ingeniuty by</p>
            <p>⚕️ 🦚 ⚸ The Jolly LaMa 📜 & 📜 The RoboSoul 🤖 🦚 ⚕️</p>
          </div>
        </div>
      </div>
    `;

    this.shadowRoot.getElementById('close-about').addEventListener('click', () => this.close());
  }
}

customElements.define('about-modal', AboutModal);