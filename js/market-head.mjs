import '../vendor/decent-head/2.0.0/js/main.js';

for (const header of document.querySelectorAll('decent-header')) {
  const wallet = header.shadowRoot?.querySelector('wallet-connect');
  if (!wallet?.shadowRoot) throw new Error('Shared wallet control did not initialize');
  const style = document.createElement('style');
  style.textContent = '#mobile { display:none !important; }';
  wallet.shadowRoot.append(style);
}
