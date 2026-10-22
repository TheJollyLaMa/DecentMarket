import '../vendor/decent-head/2.0.0/js/main.js';
import { openAdminPortal, openProfilePortal } from './market-portals.mjs';

for (const header of document.querySelectorAll('decent-header')) {
  const wallet = header.shadowRoot?.querySelector('wallet-connect');
  if (!wallet?.shadowRoot) throw new Error('Shared wallet control did not initialize');
  const style = document.createElement('style');
  style.textContent = '#mobile { display:none !important; }';
  wallet.shadowRoot.append(style);
  const ipfs = header.shadowRoot.querySelector('ipfs-status');
  const ipfsStyle = document.createElement('style');
  ipfsStyle.textContent = '#label { display:none; }';
  ipfs.shadowRoot.append(ipfsStyle);
  const title = header.shadowRoot.querySelector('app-title');
  const titleStyle = document.createElement('style');
  titleStyle.textContent = `button { font-size:clamp(14px,7.8cqi,48px); padding-inline:0; }
    .name { overflow-wrap:normal; word-break:normal; text-wrap:balance; }
    p { letter-spacing:.02em; font-weight:500; }
    @media(max-width:600px) { button { font-size:clamp(14px,10cqi,26px); } .end { display:none; } p { font-size:10px; } }`;
  title.shadowRoot.append(titleStyle);
  const cleanWalletNote = () => {
    const status = wallet.shadowRoot.querySelector('#status');
    const state = globalThis.DecentHead.getWallet().snapshot();
    const identity = state.ensName || (state.address ? `${state.address.slice(0, 6)}…${state.address.slice(-4)}` : '');
    status.hidden = /^No injected wallet detected\.?$/.test(status.textContent)
      || (state.connected && status.textContent.startsWith(`${identity} · `));
    const connect = wallet.shadowRoot.querySelector('#connect');
    if (connect.title === 'No injected wallet detected') connect.title = 'Use a browser wallet to connect';
  };
  new MutationObserver(cleanWalletNote).observe(wallet.shadowRoot.querySelector('#status'), { childList: true, characterData: true, subtree: true });
  cleanWalletNote();
  for (const menu of header.shadowRoot.querySelectorAll('ankh-menu')) {
    const button = menu.shadowRoot.querySelector('button');
    button.style.cursor = 'pointer';
    button.onclick = () => {
      menu.shadowRoot.querySelector('details').open = false;
      if (menu.getAttribute('side') === 'left') openAdminPortal(); else openProfilePortal();
    };
  }
}
