export class AppTitle extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    // Add menu toggle logic for ankh coins
    // Use shadowRoot so events are inside the web component
    this.shadowRoot.querySelectorAll('.ankh-coin').forEach(coin => {
      coin.addEventListener('click', (e) => {
        const menu = coin.parentElement.querySelector('.dropdown-menu.right-ankh-menu');
        if (menu) {
          menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
          e.stopPropagation();
        }
      });
    });

    // Add click listener to close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.shadowRoot) return;
      const composedPath = e.composedPath();
      const isInside = [...this.shadowRoot.querySelectorAll('.dropdown-menu.right-ankh-menu')]
        .some(menu => composedPath.includes(menu));
      if (!isInside) {
        this.shadowRoot.querySelectorAll('.dropdown-menu.right-ankh-menu').forEach(menu => {
          menu.style.display = 'none';
        });
      }
    });

    // Add event listener for peacock icon click
    const peacockIcon = this.shadowRoot.querySelector('.peacock-icon');
    if (peacockIcon) {
      peacockIcon.addEventListener('click', () => {
        console.log("Peacock icon clicked");
        const aboutModal = this.shadowRoot.querySelector('about-modal') || document.querySelector('about-modal');
        if (aboutModal && typeof aboutModal.open === 'function') {
          aboutModal.open();
        }
      });
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
<link rel="stylesheet" href="css/header.css" />
<div id="header-center">
  <div id="app-title-wrapper">
    <div class="ankh-left">
      <div class="ankh-wrapper">
        <div class="ankh-container">
          <span class="ankh-coin">☥</span>
          <ul class="dropdown-menu right-ankh-menu" style="display: none; list-style: none; padding: 0; margin: 0;">
            <li>Option1</li>
            <li class="menu-item">Option 2</li>
          </ul>
        </div>
        <span class="sparkle sparkle-top">✨</span>
        <span class="sparkle sparkle-bottom">✨</span>
        <span class="sparkle sparkle-left">✨</span>
        <span class="sparkle sparkle-right">✨</span>
      </div>
    </div>

    <div class="title-center">
      <h1 id="app-title">
        <span class="title-symbol">::-⊡-</span>
        <span class="title-main"> Decent</span> <span class="peacock-icon" style="cursor: pointer;">🦚</span> <span class="title-main"> Market </span>
        <span class="title-symbol">-⊡-::</span>
      </h1>
      <h3 id="app-subtitle">(Another Decent Frankenstein)</h3>
    </div>

    <div class="ankh-right">
      <right-ankh></right-ankh>
    </div>



    <about-modal></about-modal>
    
    <subscription-modal></subscription-modal>

    
  </div>
</div>
    `;
    // --- Token balance logic for right ankh menu ---
    // Only run after render, in connectedCallback.
    setTimeout(() => {
      // Find the right ankh menu's .token-balance element
      const rightMenus = this.shadowRoot.querySelectorAll('.ankh-wrapper .dropdown-menu.right-ankh-menu');
      if (!rightMenus || rightMenus.length < 2) return;
      const rightMenu = rightMenus[1];
      const tokenBalanceDiv = rightMenu.querySelector('.token-balance');
      if (!tokenBalanceDiv) return;
      // Dummy: replace with actual fetch logic as needed
      async function fetchTokenBalance() {
        // This should be replaced with actual wallet/token logic
        // For demo, check if window.ethereum and a known address
        if (window.ethereum && window.ethereum.selectedAddress) {
          // For actual use, replace with ethers.js or web3.js call.
          // We'll simulate with a random number for now.
          // return await realBalanceLookup();
          return 42.5; // DEMO value
        }
        return 0;
      }
      fetchTokenBalance().then(balance => {
        console.log("Ommm token balance:", balance);
        if (balance > 0) {
          tokenBalanceDiv.innerHTML = `
            <span style="color: white; font-size: 1.8em;">
              ${balance} <img src="./img/Ommm.png" alt="Ommm token" style="height: 2em; vertical-align: middle;" />
            </span>
          `;
        }
      });
    }, 0);

    // Remove old about-trigger listener since replaced by peacock-icon outside
  }
}



const script = document.createElement('script');
script.src = './js/components/Header/RightAnkhDropdown.js';
document.head.appendChild(script);

const aboutModalScript = document.createElement('script');
aboutModalScript.src = './js/components/Header/AboutModal.js';
document.head.appendChild(aboutModalScript);

customElements.define('app-title', AppTitle);