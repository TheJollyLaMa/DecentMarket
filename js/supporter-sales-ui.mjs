import './market-head.mjs';
import { ethers } from './supporter-mint.mjs';
import { loadCanopyProjects } from './creator-supporter-ui.mjs';
import { readCreatorListings } from './supporter-listings.mjs';
import { SupporterPurchase } from './supporter-purchase.mjs';

const root = document.querySelector('[data-supporter-sales]');
if (root) {
  const form = root.querySelector('[data-sales-project]'), status = root.querySelector('[data-sales-status]');
  const catalog = root.querySelector('[data-sales-catalog]');
  let config, busy = false;
  const notice = text => { status.textContent = text; };
  async function action(fn) {
    if (busy) return;
    busy = true; root.setAttribute('aria-busy', 'true');
    const controls = [...root.querySelectorAll('input,button')].map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    try { await fn(); }
    catch (error) { notice(error.shortMessage || error.message); console.error('[Supporter sales]', error); }
    finally { busy = false; root.removeAttribute('aria-busy'); controls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; }); }
  }
  async function projects() {
    const creator = form.elements.creator.value.trim(), key = form.elements.projectKey.value.trim();
    const published = await loadCanopyProjects(creator);
    const project = published.find(p => p.key === key);
    if (!project) throw new Error('This project is missing from the current signed public Canopy publication');
    return project;
  }
  async function load() {
    const project = await projects();
    const rows = await readCreatorListings(config, project.creator, [project.key],
      { ethers, provider: new ethers.JsonRpcProvider('https://mainnet.base.org', 8453) });
    catalog.replaceChildren();
    for (const row of rows) {
      const article = document.createElement('article');
      const title = document.createElement('h2'); title.textContent = `${project.name} · Supporter #${row.tokenId}`;
      const terms = document.createElement('p'); terms.textContent = `${ethers.formatUnits(row.priceUnits, row.decimals)} ${row.symbol} per edition · ${row.quantity} available · listing #${row.listingId}. Creator sale: 10% Agency; royalties and seller proceeds are quoted before confirmation.`;
      const label = document.createElement('label'); label.textContent = 'Edition quantity';
      const input = document.createElement('input'); input.inputMode = 'numeric'; input.value = '1'; label.append(input);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Review exact quote & confirm next wallet step';
      button.addEventListener('click', () => action(async () => {
        await projects();
        const { client, buyer } = await purchase(row.listingId, input.value.trim());
        if (!navigator.locks) throw new Error('Use a browser with Web Locks for safe cross-tab purchase coordination');
        const result = await navigator.locks.request(`supporter-purchase:${config.listingsAddress.toLowerCase()}:${buyer.toLowerCase()}:${row.listingId}`,
          { ifAvailable: true }, lock => { if (!lock) throw new Error('Another tab is preparing this purchase'); return client.execute(); });
        notice(result.cancelled ? 'Cancelled; no new wallet transaction.' : result.pending ? 'Pending; reconcile, never resend.' :
          result.reverted ? 'Exact transaction reverted; no purchase completed.' :
          result.completed === 'approve' ? `Token approval verified (${result.hash}). Confirm the purchase separately; approval is not a purchase.` :
            `Purchase verified (${result.hash}). Editions delivered by the listings contract; refresh to see remaining inventory.`);
      }));
      article.append(title, terms, label, button); catalog.append(article);
    }
    notice(rows.length ? 'Current signed project and creator-owned listings verified. Connect through the header only when ready to buy.' :
      'Current public project verified; no active creator-owned listing exists in the configured contracts.');
  }
  async function purchase(listingId, quantity = '1') {
    const snapshot = window.DecentHead.getWallet().snapshot();
    if (!snapshot.connected || !snapshot.provider || Number(snapshot.chainId) !== 8453) throw new Error('Connect your buyer wallet on Base through the shared header');
    const getWallet = async () => {
      const signer = await snapshot.provider.getSigner();
      const check = async () => {
        const now = window.DecentHead.getWallet().snapshot();
        if (!now.connected || now.provider !== snapshot.provider || now.address?.toLowerCase() !== snapshot.address.toLowerCase() ||
            Number(now.chainId) !== 8453 || Number(await snapshot.provider.send('eth_chainId', [])) !== 8453 ||
            (await signer.getAddress()).toLowerCase() !== snapshot.address.toLowerCase()) throw new Error('Buyer wallet or Base network changed');
      };
      await check(); return { address: snapshot.address, signer, check };
    };
    const client = new SupporterPurchase({ config, creator: form.elements.creator.value.trim(),
      projectKey: form.elements.projectKey.value.trim(), listingId, quantity }, {
      provider: snapshot.provider, storage: localStorage, getWallet,
      confirm: quote => window.confirm(`Buy ${quote.quantity} edition(s) from ${quote.seller}?\nMaximum ${quote.total} ${quote.symbol}; seller proceeds ${quote.sellerProceeds}; Agency ${quote.platformFee}; royalty ${quote.royaltyAmount}.\nBuyer ${quote.buyer}; listing #${quote.listingId}; listings ${config.listingsAddress}.\nToken approval and purchase are separate wallet steps. Gas is additional.`),
    });
    return { client, buyer: snapshot.address };
  }
  form.addEventListener('submit', event => { event.preventDefault(); void action(load); });
  root.querySelector('[data-sales-reconcile]').addEventListener('click', () => action(async () => {
    const { client } = await purchase(root.querySelector('[data-sales-listing]').value.trim());
    const result = await client.reconcile(root.querySelector('[data-sales-hash]').value.trim() || undefined);
    notice(result.pending ? 'Awaiting two canonical confirmations; do not send again.' : result.reverted ?
      'Exact transaction reverted; no purchase completed.' : `Verified ${result.completed}: ${result.hash}. No new transaction sent.`);
  }));
  root.querySelector('[data-sales-reset]').addEventListener('click', () => action(async () => {
    if (!window.confirm('Archive this unsubmitted/reverted quote? No pending transaction may be discarded. Existing token allowances are not revoked.')) return;
    await (await purchase(root.querySelector('[data-sales-listing]').value.trim())).client.reset();
    notice('Quote archived; no on-chain change or allowance revocation occurred.');
  }));
  void action(async () => {
    const response = await fetch('community-supporter.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Creator sale configuration unavailable (${response.status})`);
    config = await response.json();
    const params = new URLSearchParams(location.search);
    form.elements.creator.value = params.get('creator') || '';
    form.elements.projectKey.value = params.get('projectKey') || '';
    root.querySelector('[data-sales-listing]').value = params.get('listingId') || '1';
    if (form.elements.creator.value && form.elements.projectKey.value) await load();
  });
}
