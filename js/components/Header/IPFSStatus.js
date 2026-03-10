export class IPFSStatus extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.ipfsConnected = false;
  }

  connectedCallback() {
    console.warn("IPFSStatus connectedCallback fired");
    this.render();
    this.renderWaitingModal();
    // Assign global handler for modal email prompt click
    window.promptForEmail = async () => {
      const email = prompt("Enter your email to login:");
      if (!email) {
        window.hideIPFSWaitingModal();
        alert("Please enter a valid email to login.");
        return;
      }
      await this.finishW3upLogin(email);
    };
    this.checkForStoredCredentials();
    this.button = this.shadowRoot.getElementById('ipfsIcon');
    // Add click event to IPFS icon to trigger W3up connect
    if (this.button) {
      this.button.addEventListener('click', () => {
        window.connectToW3up();
      });
    }
    this.statusWrapper = this.shadowRoot.getElementById('ipfs-status');
    this.ipfsTickerCircle = this.shadowRoot.getElementById('ipfs-ticker-circle');
    this.ipfsHoverPopup = this.shadowRoot.getElementById('ipfsHoverPopup');

    // Always disable button initially
    // if (this.button) this.button.disabled = true;

    // Track wallet click state for connect logic
    this.walletClicked = false;

    // Hover and click logic for IPFS status (show/hide popup, upload on click)
    if (this.statusWrapper) {
      this.statusWrapper.addEventListener('click', async () => {
        if (window.fitnessData && window.w3upClient) {
          const data = await window.fitnessData();
          const { uploadDataToIPFS } = await import('../helpers/ipfs/uploadToIPFS.js');
          const cid = await uploadDataToIPFS(data, window.w3upClient);
          this.renderSnapshotHistory();
        }
      });

      this.statusWrapper.addEventListener('mouseenter', () => {
        if (this.ipfsHoverPopup) this.ipfsHoverPopup.style.display = 'block';
      });

      this.statusWrapper.addEventListener('mouseleave', () => {
        if (this.ipfsHoverPopup) this.ipfsHoverPopup.style.display = 'none';
      });
    }

    // Set default hover popup message before connection
    if (this.ipfsHoverPopup) {
      this.ipfsHoverPopup.innerHTML = "Not connected to IPFS";
    }

    // Set up global hook for IPFS icon click to trigger W3up connect
    window.connectToW3up = async () => {
      // Only allow if wallet is connected
      if (window.ethereum && window.ethereum.isConnected()) {
        // Only call checkForStoredCredentials() once
        if (!this.ipfsConnected) {
          await this.connectToW3up();
        } else {
          console.log("Already connected to IPFS.");
        }
      } else {
        console.warn("Wallet not connected. IPFS connection postponed.");
      }
    };
  }

  async checkForStoredCredentials() {
    console.time("checkForStoredCredentials");
    try {
      // First: Try IndexedDB via connectW3upClient
      const { connectW3upClient } = await import('./helpers/ipfs/w3upClient.js');
      const result = await connectW3upClient(true);
      console.log("[IPFS] connectW3upClient(true) returned:", result);

      if (result && result.client) {
        console.log("[IPFS] IndexedDB has valid client + spaces, fully connected.");
        this.ipfsConnected = true;
        window.w3upClient = result.client;
        this.updateUIConnected();
        if (window.onIPFSReady) window.onIPFSReady(result.client);
        console.timeEnd("checkForStoredCredentials");
        return;
      }

      // Second: Try localStorage trust if IndexedDB fails
      const localEmailData = JSON.parse(localStorage.getItem('IPFS_Email_Address') || '{}');
      if (localEmailData?.email && localEmailData?.confirmed) {
        console.log("[IPFS] No valid IndexedDB, but local storage says confirmed email:", localEmailData.email);
        this.ipfsConnected = true;
        this.updateUIConnected();
        console.timeEnd("checkForStoredCredentials");
        return;
      }

      // Third: Neither present, show modal
      console.warn("[IPFS] No credentials found anywhere, showing modal.");
      this.showWaitingModal();
      console.timeEnd("checkForStoredCredentials");
    } catch (err) {
      console.warn("[IPFS] Auto-connect failed:", err);
      this.showWaitingModal();
      console.timeEnd("checkForStoredCredentials");
    }
  }

  connectIfWalletReady() {
    if (window.ethereum && window.ethereum.selectedAddress) {
      this.connectToW3up();
    } else if (this.button) {
      this.button.disabled = true;
    }
  }

  // Handles the email prompt and login for W3up, includes waiting modal logic
  async connectToW3up() {
    try {
      // Only show the modal if credentials are not already in IndexedDB
      const { connectW3upClient } = await import('../helpers/ipfs/w3upClient.js');
      const stored = await connectW3upClient(true);
      if (stored) {
        this.ipfsConnected = true;
        window.w3upClient = stored.client;
        this.updateUIConnected();
        if (window.onIPFSReady) window.onIPFSReady(stored.client);
        return;
      }
      // Show the waiting modal before prompting for email
      this.showWaitingModal();
      // Prompt immediately after modal is shown
      const email = prompt("Enter your email to login:");
      if (!email) {
        this.hideWaitingModal();
        alert("Please enter a valid email to login.");
        return null;
      }
      // Continue login flow after prompt, leave modal visible until credentials received
      this.finishW3upLogin(email);
    } catch (err) {
      this.hideWaitingModal();
      console.error("IPFS connection failed:", err);
      alert("Failed to connect to IPFS. Please make sure your credentials are valid.");
      return null;
    }
  }

  async finishW3upLogin(email) {
    try {
      // Store email with confirmed: false immediately
      localStorage.setItem('IPFS_Email_Address', JSON.stringify({ email, confirmed: false }));
      const client = await window.w3up.create();
      const account = await client.login(email);
      if (account.plan) {
        await account.plan.wait();
      }
      const spaces = await client.spaces();
      // Hide the waiting modal after credentials are confirmed and current space is set
      const space = spaces[0];
      await client.setCurrentSpace(space.did());
      // After setting currentSpace, set confirmed: true in localStorage
      const confirmed = JSON.parse(localStorage.getItem('IPFS_Email_Address'));
      if (confirmed) {
        confirmed.confirmed = true;
        localStorage.setItem('IPFS_Email_Address', JSON.stringify(confirmed));
      }
      this.hideWaitingModal();
      this.ipfsConnected = true;
      window.w3upClient = client;
      this.updateUIConnected();
      if (window.onIPFSReady) window.onIPFSReady(client);
    } catch (err) {
      this.hideWaitingModal();
      console.error("IPFS connection failed:", err);
      alert("Failed to connect to IPFS. Please make sure your credentials are valid.");
    }
  }

  updateUIConnected() {
    if (this.statusWrapper) {
      this.statusWrapper.classList.remove('ipfs-disconnected');
      this.statusWrapper.classList.add('ipfs-connected');
      console.log("Setting IPFS status to connected");
    }
    // Dynamic DID animation logic (replaces window.positionTickerLetters)
    if (this.ipfsTickerCircle && window.w3upClient?.currentSpace) {
      // Robustly get the DID regardless of whether currentSpace is a function or object
      const did = typeof window.w3upClient.currentSpace === 'function'
        ? window.w3upClient.currentSpace().did()
        : window.w3upClient.currentSpace?.did?.();
      if (!did) {
        console.warn("Unable to retrieve DID from currentSpace.");
        return;
      }
      const prefix = did.slice(8, 14);
      const suffix = did.slice(-4);
      const tickerCircle = this.ipfsTickerCircle;
      tickerCircle.innerHTML = '';

      [...prefix].forEach(char => {
        const span = document.createElement('span');
        span.classList.add('ticker-letter');
        span.textContent = char;
        tickerCircle.appendChild(span);
      });

      for (let i = 0; i < 4; i++) {
        const img = document.createElement('img');
        img.classList.add('ticker-letter');
        img.src = 'img/IPFS_Logo.png';
        img.style.width = '12px';
        img.style.height = '12px';
        tickerCircle.appendChild(img);
      }

      [...suffix].forEach(char => {
        const span = document.createElement('span');
        span.classList.add('ticker-letter');
        span.textContent = char;
        tickerCircle.appendChild(span);
      });

      const star1 = document.createElement('span');
      star1.classList.add('ticker-letter');
      star1.textContent = '*';
      tickerCircle.appendChild(star1);

      const shakti = document.createElement('span');
      shakti.classList.add('ticker-letter');
      shakti.textContent = '⚸';
      tickerCircle.appendChild(shakti);

      const star2 = document.createElement('span');
      star2.classList.add('ticker-letter');
      star2.textContent = '*';
      tickerCircle.appendChild(star2);

      function positionLetters() {
        // Guard clause to prevent TypeError if this or this.shadowRoot is undefined
        if (!this || !this.shadowRoot) {
          console.warn("IPFSStatus shadowRoot not available.");
          return;
        }
        const letters = tickerCircle.querySelectorAll('.ticker-letter');
        const wrapperEl = this.shadowRoot.querySelector('.ticker-wrapper');
        if (!wrapperEl) {
          console.warn("Ticker wrapper not found in shadow DOM.");
          return;
        }
        // Use the tickerCircle's actual dimensions for center calculation
        const centerX = tickerCircle.offsetWidth / 2;
        const centerY = tickerCircle.offsetHeight / 2;
        const radius = 45;
        const angleStep = (2 * Math.PI) / letters.length;

        letters.forEach((letter, index) => {
          const angle = index * angleStep;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          letter.style.position = 'absolute';
          letter.style.left = `${x}px`;
          letter.style.top = `${y}px`;
        });
      }
      // Added check for ticker-wrapper presence before calling positionLetters
      const wrapper = this.shadowRoot.querySelector('.ticker-wrapper');
      if (!wrapper) {
        console.warn("Ticker wrapper not found in shadow DOM.");
        return;
      }
      console.log("Ticker wrapper found, proceeding with positioning letters.");
      positionLetters.call(this);

      function animateTicker() {
        let angle = 0;
        function rotate() {
          tickerCircle.style.transform = `rotate(${angle}deg)`;
          angle += 0.2;
          requestAnimationFrame(rotate);
        }
        rotate();
      }
      animateTicker();
    }
    // Update hover popup with connection status and history
    if (this.ipfsHoverPopup) {
      if (this.ipfsConnected) {
        const history = JSON.parse(localStorage.getItem('snapshotHistory') || '[]');
        const links = history.map(entry => {
          const date = new Date(entry.timestamp).toLocaleString();
          return `<div><a href="https://w3s.link/ipfs/${entry.cid}" target="_blank">${date}</a></div>`;
        }).join('');
        this.ipfsHoverPopup.innerHTML = `
          <strong>Connected to IPFS</strong>
          <div>${links}</div>
        `;
      } else {
        this.ipfsHoverPopup.innerHTML = "Not connected to IPFS";
      }
    }
    this.renderSnapshotHistory();
  }

  renderSnapshotHistory() {
    if (!this.ipfsHoverPopup) return;
    const history = JSON.parse(localStorage.getItem('snapshotHistory') || '[]');
    console.log("Rendering snapshotHistory from localStorage:", history);

    if (history.length === 0) {
      this.ipfsHoverPopup.innerHTML = `
        <div class="snapshot-import-wrapper">
          <label for="snapshotCidInput">No snapshots found. Import one:</label>
          <input type="text" id="snapshotCidInput" placeholder="Enter IPFS CID" />
          <button id="importSnapshotBtn">Import</button>
        </div>
      `;
      const input = this.ipfsHoverPopup.querySelector('#snapshotCidInput');
      const button = this.ipfsHoverPopup.querySelector('#importSnapshotBtn');

      button.addEventListener('click', async () => {
        const cid = input.value.trim();
        if (!cid) return alert("Please enter a valid CID.");
        try {
          const url = `https://w3s.link/ipfs/${cid}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error("Failed to fetch snapshot");
          const snapshot = await res.json();
          if (snapshot.snapshotHistory) {
            // Add the imported CID as the most recent entry
            const importedAt = new Date().toISOString();
            const previous = Array.isArray(snapshot.snapshotHistory) ? snapshot.snapshotHistory : [];
            const parsed = [
              { cid, timestamp: importedAt },
              ...previous.filter(e => e?.cid).map(entry => ({
                cid: entry.cid,
                timestamp: entry.timestamp || importedAt
              }))
            ];
            console.log("Parsed snapshot history list:", parsed);
            localStorage.setItem('snapshotHistory', JSON.stringify(parsed));
            this.renderSnapshotHistory(); // rerender popup
          } else {
            alert("No snapshotHistory found in CID data.");
          }
        } catch (err) {
          console.error("Snapshot import failed:", err);
          alert("Failed to import snapshot.");
        }
      });

    } else {
      this.ipfsHoverPopup.innerHTML = history
        .slice(0, 10)
        .map(entry => {
          // Use entry.cid and fallback timestamp formatting
          const date = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '[No date]';
          const cls = entry.timestamp && entry.timestamp.startsWith(new Date().toISOString().slice(0, 10)) ? 'snapshot-today' : 'snapshot-old';
          return `<div class="${cls}"><a href="https://w3s.link/ipfs/${entry.cid}" target="_blank">${date}</a></div>`;
        }).join('');
    }
  }


  render() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="../css/styles.css" />
      <link rel="stylesheet" href="../css/header.css" />
      <div id="ipfs-status" class="ipfs-disconnected">
        <div class="ticker-wrapper">
          <div id="ipfs-ticker-circle" class="ticker-circle-ipfs" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div>
          <img id="ipfsIcon" src="img/IPFS_Logo.png" />
        </div>
        <div id="ipfsHoverPopup" class="hover-popup">
          <div id="hoverPopupContent">
            <strong>IPFS Snapshot History</strong>
            <ul id="ipfsSnapshotList"></ul>
          </div>
        </div>
      </div>
    `;
    // Guard clause: ensure shadowRoot is defined before querying
    if (!this.shadowRoot) {
      console.warn("IPFSStatus: shadowRoot not yet initialized.");
      return;
    }
  }

  

  // Show the waiting modal using the new global modal system
  async showWaitingModal() {
    if (!window.customElements.get('waiting-modal')) {
      await import('./IPFSWaitingModal.js');
    }
    if (!document.querySelector('waiting-modal')) {
      const modal = document.createElement('waiting-modal');
      document.body.appendChild(modal);
    }
  }
  // Removed global waiting modal render logic; modal is now only in shadow DOM
  renderWaitingModal() {
    // No-op: modal is managed only in the shadow DOM of this component
  }

  hideWaitingModal() {
    const existingModal = document.querySelector('waiting-modal');
    if (existingModal) existingModal.remove();
  }
}

if (!customElements.get('ipfs-status')) {
  customElements.define('ipfs-status', IPFSStatus);
}
// Removed global waiting modal helpers and DOM logic.