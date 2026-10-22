import { element, externalLink, openMarketDialog } from './market-dialog.mjs';
import { ADMIN, isMarketAdmin, moderationKey, moderationState, previewHidden, clearModerationPreview } from './market-moderation.mjs';
import { loadEthers } from '../vendor/decent-head/2.0.0/js/wallet.js';

const link = (root, label, url) => { const node = externalLink(label, url); if (node) root.append(node); };
export function openProfilePortal() {
  const { dialog, body } = openMarketDialog('market-profile', 'Your Decent portal');
  const render = () => {
    const wallet = globalThis.DecentHead.getWallet(), state = wallet.snapshot();
    body.replaceChildren(element('p', '✦ Your name, your constellation. ✦', 'market-magic'));
    if (!state.connected) {
      body.append(element('p', 'Connect with the header fox, then return here. Browsing and reviewing prices never requires a wallet.'));
      link(body, 'Discover ENS', 'https://ens.domains/');
      return;
    }
    body.append(element('p', state.address, 'market-address'));
    link(body, 'Your Base collectibles and transfer history ↗', `https://basescan.org/tokenholdings?a=${state.address}`);
    if (state.ensStatus === 'loading' || state.ensStatus === 'idle') {
      body.append(element('p', 'Following the stars to your Ethereum primary name…')); return;
    }
    if (state.ensStatus === 'unavailable') {
      body.append(element('p', 'ENS lookup is temporarily unavailable. This does not mean you have no name.'));
      const retry = element('button', 'Retry ENS lookup');
      retry.onclick = () => wallet.resolveIdentity();
      body.append(retry); return;
    }
    if (!state.ensName) {
      body.append(element('h3', 'Give your wallet a name ✨'));
      body.append(element('p', 'ENS turns a long address into a memorable name you can carry between Decent apps. It can also hold an avatar, website and other public profile records.'));
      const steps = element('ol');
      for (const text of ['Explore available names at the official ENS app. Registration and renewal cost money; review network fees and expiry.',
        'Set the Ethereum address record to this wallet, then set the name as its primary name (reverse record).',
        'Add an avatar and public links if you like. Return here and refresh your identity. Never enter your seed phrase on a website.'])
        steps.append(element('li', text));
      body.append(steps);
      link(body, 'Begin your ENS adventure ↗', 'https://app.ens.domains/');
      link(body, 'Learn how primary names work ↗', 'https://support.ens.domains/');
      const retry = element('button', 'Refresh my ENS identity');
      retry.onclick = () => wallet.resolveIdentity();
      body.append(retry); return;
    }
    const name = state.ensName;
    body.append(element('h3', name));
    link(body, 'View / manage ENS profile ↗', `https://app.ens.domains/${encodeURIComponent(name)}`);
    const records = element('section');
    records.append(element('p', 'Reading public ENS profile records…'));
    body.append(records);
    void (async () => {
      const ethers = await loadEthers();
      const request = new ethers.FetchRequest('https://ethereum-rpc.publicnode.com');
      request.timeout = 8000;
      const provider = new ethers.JsonRpcProvider(request, 1, { staticNetwork: true, batchMaxCount: 10 });
      try {
        const resolver = await provider.getResolver(name);
        if (!resolver) throw new Error('This name has no resolver');
        const [address, avatar, description, website] = await Promise.all([
          resolver.getAddress(), resolver.getAvatar(), resolver.getText('description'), resolver.getText('url'),
        ]);
        if (!dialog.isConnected || wallet.snapshot().address !== state.address || wallet.snapshot().ensName !== name || !records.isConnected) return;
        if (address?.toLowerCase() !== state.address.toLowerCase()) throw new Error('ENS forward address no longer matches your wallet');
        records.replaceChildren();
        const imageLink = externalLink('avatar', avatar);
        if (imageLink) {
          const img = element('img'); img.src = imageLink.href; img.alt = `${name} ENS avatar`; img.className = 'market-avatar'; img.referrerPolicy = 'no-referrer';
          img.onerror = () => { img.replaceWith(element('p', 'ENS avatar could not be loaded.')); };
          records.append(img);
        }
        if (description) records.append(element('p', description));
        if (website) link(records, 'Public ENS website ↗', website);
        if (!records.childNodes.length) records.append(element('p', 'Your verified name is ready. Add public profile records through ENS whenever you like.'));
      } catch (error) {
        console.error('[Market ENS profile]', error);
        if (records.isConnected) records.replaceChildren(element('p', `ENS profile records unavailable: ${error.message}`));
      } finally { provider.destroy(); }
    })().catch(error => { console.error('[Market ENS]', error); if (records.isConnected) records.textContent = `Could not load ENS tools: ${error.message}`; });
  };
  window.addEventListener('decenthead:wallet', render);
  dialog.addEventListener('close', () => window.removeEventListener('decenthead:wallet', render), { once: true });
  render();
}

export function openAdminPortal() {
  const { dialog, body } = openMarketDialog('market-admin', 'Market steward');
  const render = () => {
    body.replaceChildren(element('p', '☥ Tend the constellation, not its ownership.', 'market-magic'));
    if (!isMarketAdmin()) {
      body.append(element('p', `Connect ${ADMIN} on Base to open steward controls. UI gating is not contract authorization.`)); return;
    }
    const state = moderationState();
    if (state.failure) body.append(element('p', `Display policy warning: ${state.failure}`));
    body.append(element('p', 'Hide/show below is a local admin preview only. Export the policy for review and publish it through the repository to affect everyone. It does not delist, burn or transfer any NFT.'));
    const status = element('p'); status.setAttribute('role', 'status');
    const run = action => { try { action(); } catch (error) { status.textContent = error.message; console.error('[Market admin]', error); } };
    const products = document.querySelector('decent-right-toolbar')?.spaceProducts || [];
    const rows = element('div', undefined, 'market-admin-items');
    const all = new Map(products.map(product => [moderationKey(product), product.metadata?.name || `DNFT #${product.tokenId}`]));
    for (const key of state.policy.hidden) if (!all.has(key)) all.set(key, key);
    for (const [key, name] of all) {
      const label = element('label');
      const check = element('input'); check.type = 'checkbox'; check.checked = state.policy.hidden.includes(key);
      check.onchange = () => run(() => previewHidden(key, check.checked));
      label.append(check, document.createTextNode(` Hide ${name}`)); rows.append(label);
    }
    if (!all.size) rows.append(element('p', 'No editions loaded yet. Open the filters to load the collection.'));
    body.append(rows);
    const reset = element('button', 'Reset local preview');
    reset.onclick = () => run(clearModerationPreview);
    const download = element('button', 'Export public display policy');
    download.onclick = () => run(() => {
      const blob = new Blob([JSON.stringify(moderationState().policy, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = element('a');
      a.href = url; a.download = 'market-moderation.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    body.append(reset, download, status);
    const advanced = element('details'); advanced.append(element('summary', 'Advanced contract tools'));
    for (const [label, method] of [['Network / NFT roles', '_openSettingsPanel'], ['Treasury / escrow administration', '_openEscrowPanel']]) {
      const button = element('button', label);
      button.onclick = () => {
        if (!isMarketAdmin()) { render(); return; }
        dialog.close();
        void document.querySelector('decent-right-toolbar')[method]({ admin: true });
      };
      advanced.append(button);
    }
    body.append(advanced);
  };
  window.addEventListener('decenthead:wallet', render);
  document.addEventListener('market:moderation', render);
  dialog.addEventListener('close', () => {
    window.removeEventListener('decenthead:wallet', render);
    document.removeEventListener('market:moderation', render);
  }, { once: true });
  render();
}
