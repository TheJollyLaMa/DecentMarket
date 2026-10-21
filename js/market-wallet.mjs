const headWallet = () => globalThis.DecentHead?.getWallet();
async function connect(wallet) {
  if (wallet.available().length > 1) throw new Error('Choose your wallet using the header fox, then retry this action');
  await wallet.connect();
}
const listeners = new Map();
let observed;
let previous = { address: null, chainId: null, connected: false };
function session() {
  const wallet = headWallet();
  if (!wallet) throw new Error('DecentHead wallet session is not ready');
  if (wallet !== observed && typeof window !== 'undefined') {
    observed = wallet;
    window.addEventListener('decenthead:wallet', event => {
      const state = event.detail;
      if (state.address !== previous.address || state.connected !== previous.connected) {
        for (const fn of listeners.get('accountsChanged') || []) fn(state.connected ? [state.address] : []);
      }
      if (state.chainId !== previous.chainId) {
        for (const fn of listeners.get('chainChanged') || []) fn(state.chainId || '0x2105');
      }
      previous = state;
    });
  }
  return wallet;
}
// Legacy Market controls use an EIP-1193 facade backed by the selected Head session.
const facade = {
  get chainId() { return session().snapshot().chainId || '0x2105'; },
  get selectedAddress() { return session().snapshot().address; },
  async request({ method, params }) {
    const wallet = session();
    if (method === 'eth_requestAccounts') {
      if (!wallet.snapshot().connected) await connect(wallet);
      return [wallet.snapshot().address];
    }
    if (method === 'eth_accounts') return wallet.snapshot().connected ? [wallet.snapshot().address] : [];
    if (method === 'eth_chainId' && !wallet.snapshot().connected) return '0x2105';
    if (!wallet.rawProvider) throw new Error('Connect your wallet using the fox before this action');
    return wallet.rawProvider.request({ method, params });
  },
  on(event, fn) { session(); if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
  removeListener(event, fn) { listeners.get(event)?.delete(fn); },
  off(event, fn) { this.removeListener(event, fn); },
};
export function marketEthereum() { session(); return facade; }
export async function marketBrowserProvider() {
  const wallet = session();
  if (!wallet.snapshot().connected) await connect(wallet);
  const provider = wallet.snapshot().provider;
  if (!provider) throw new Error('Wallet connection did not complete');
  return provider;
}
