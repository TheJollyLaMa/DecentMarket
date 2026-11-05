import { element } from './market-dialog.mjs';

// Use the existing Head session without opening a second, header-owned modal.
export function mountMarketWalletControls(root, { onBusy = () => {} } = {}) {
  const section = element('section', undefined, 'market-wallet-controls');
  section.setAttribute('aria-label', 'Purchase wallet');
  const label = element('label', 'Choose wallet ');
  const select = element('select');
  label.append(select);
  const connect = element('button', 'Connect wallet here');
  connect.type = 'button';
  const status = element('p'); status.setAttribute('role', 'status');
  section.append(label, connect, status); root.querySelector('.market-dialog-body').prepend(section);
  let busy = false, failure = '', providers = [];
  const wallet = () => globalThis.DecentHead?.getWallet();
  function render() {
    const session = wallet(), state = session?.snapshot();
    const selected = select.value;
    providers = session?.available() || [];
    select.replaceChildren();
    providers.forEach((entry, index) => {
      const option = element('option', entry.info?.name || `Wallet ${index + 1}`);
      option.value = String(index); select.append(option);
    });
    if (providers[Number(selected)]) select.value = selected;
    label.hidden = !!state?.connected || providers.length < 2;
    select.disabled = busy;
    const base = state?.connected && BigInt(state.chainId || 0) === 8453n;
    connect.hidden = base;
    connect.disabled = busy || (!state?.connected && !providers.length);
    connect.textContent = busy ? 'Connecting…' : state?.connected ? 'Switch wallet to Base' : 'Connect wallet here';
    status.textContent = failure || (busy ? 'Confirm the connection in your wallet. No purchase is being submitted.'
      : base ? `Connected on Base · ${state.address}. Review the edition, then choose Buy.`
        : state?.connected ? 'Your wallet is connected on another network. Switch to Base to purchase.'
          : providers.length ? 'Connect here without closing this collection. Connection alone does not buy a token.'
            : 'No injected wallet found. Open this page in a wallet browser or enable your wallet extension.');
  }
  connect.onclick = async () => {
    if (busy) return;
    busy = true; failure = ''; onBusy(true); render();
    try {
      const session = wallet();
      if (!session) throw new Error('Wallet tools are not ready. Reload and try again.');
      if (session.snapshot().connected) await session.ensureChain();
      else await session.connect(providers[Number(select.value)]?.provider);
      if (!session.snapshot().connected) throw new Error('Wallet connection did not complete. Try connecting again.');
    } catch (error) {
      console.error('[Market wallet connection]', error);
      failure = error.code === 4001 || error.code === 'ACTION_REJECTED'
        ? 'Wallet connection declined. You can try again here; no purchase was submitted.'
        : `${error.shortMessage || error.message} No purchase was submitted.`;
    } finally { busy = false; onBusy(false); render(); }
  };
  const update = () => { if (!busy) failure = ''; render(); };
  window.addEventListener('decenthead:wallet', update);
  window.addEventListener('decenthead:providers', update);
  root.addEventListener('close', () => {
    window.removeEventListener('decenthead:wallet', update);
    window.removeEventListener('decenthead:providers', update);
  }, { once: true });
  render();
  return {
    isBusy: () => busy,
    focusConnection() {
      section.scrollIntoView({ block: 'nearest' });
      (label.hidden ? connect : select).focus();
    },
  };
}
