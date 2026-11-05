export function purchaseWalletReady() {
  const state = globalThis.DecentHead?.getWallet()?.snapshot();
  return !!state?.connected && BigInt(state.chainId || 0) === 8453n;
}

export async function connectPurchaseWallet() {
  const wallet = globalThis.DecentHead?.getWallet();
  if (!wallet) throw new Error('Wallet tools are not ready. Reload and try again.');
  if (wallet.snapshot().connected) await wallet.ensureChain();
  else {
    const control = document.querySelector('decent-header')?.shadowRoot?.querySelector('wallet-connect');
    const index = Number(control?.shadowRoot?.querySelector('select')?.value || 0);
    const provider = wallet.available()[index]?.provider;
    if (!provider) throw new Error('No injected wallet found. Enable a wallet extension or open this page in a wallet browser.');
    if (control?.connecting) throw new Error('Wallet connection is already in progress. Confirm it in your wallet.');
    await wallet.connect(provider);
  }
  if (!purchaseWalletReady()) throw new Error('Wallet did not connect on Base. Try the spotlighted header fox.');
}

export function trackPurchaseWallet(dialog) {
  const update = () => {
    dialog.classList.toggle('market-wallet-needed', !purchaseWalletReady());
    const needed = [...document.querySelectorAll('.market-purchase-dialog[open]')]
      .some(panel => panel.classList.contains('market-wallet-needed'));
    document.querySelectorAll('decent-header').forEach(header => {
      header.shadowRoot?.querySelector('wallet-connect')?.toggleAttribute('data-purchase-needed', needed);
    });
  };
  window.addEventListener('decenthead:wallet', update);
  dialog.addEventListener('close', () => {
    window.removeEventListener('decenthead:wallet', update);
    update();
  }, { once: true });
  update();
}
