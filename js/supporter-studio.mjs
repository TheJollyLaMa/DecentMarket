import { ethers, BASE, STEPS, SupporterMint, validateRelease, validateMetadata, newSession, nextStep, transactionFor, buildEvidence, releaseKey, ESCROW_ABI, NFT_ABI } from './supporter-mint.mjs';
import './market-head.mjs';
import { marketBrowserProvider } from './market-wallet.mjs';
export function mountSupporterStudio(root) {
const $ = id => root.querySelector(`#${id}`);
let manifest, studio, busy = false;
const titles = { register: 'Register release', mint: 'Mint 1,000 editions to creator', transfer: 'Transfer 1,000 editions to escrow', list: 'List 1,000 editions at 10 USDC each' };
function status(message, error = false) { $('status').textContent = message; $('status').dataset.error = String(error); }
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function jsonFile(id) {
  const file = $(id).files[0];
  if (!file || file.size > 1024 * 1024) throw new Error('Select the requested JSON file (maximum 1 MB)');
  return JSON.parse(await file.text());
}
async function action(callback) {
  if (busy) return;
  busy = true;
  const controls = [...root.querySelectorAll('button')];
  const disabled = controls.map(button => button.disabled);
  controls.forEach(button => { button.disabled = true; });
  try {
    if (studio && window.DecentHead.getWallet().snapshot().connected) studio.provider = window.DecentHead.getWallet().snapshot().provider;
    await callback();
  }
  catch (error) { status(error.shortMessage || error.message, true); }
  finally { busy = false; controls.forEach((button, i) => { button.disabled = disabled[i]; }); render(); }
}
function render() {
  $('transactions').hidden = !studio?.session;
  $('finished').hidden = !studio?.session || nextStep(studio.session) !== null || !!studio.session.pending;
  const session = studio?.session;
  $('progress').replaceChildren(...STEPS.map(step => {
    const li = document.createElement('li');
    li.textContent = `${session?.completed[step] ? 'Verified' : session?.pending?.step === step ? 'Pending / reconcile' : 'Not sent'} — ${titles[step]}`;
    const hash = session?.completed[step]?.hash || (session?.pending?.step === step && session.pending.hash);
    if (hash) { const link = document.createElement('a'); link.href = `https://basescan.org/tx/${hash}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = ' Receipt'; li.append(link); }
    return li;
  }));
  const step = session && nextStep(session);
  $('step-summary').textContent = step ? `${titles[step]} · Base · ${step === 'list' ? 'DecentEscrow' : 'DecentNFT'} · 0 ETH sent + gas. Your wallet confirms only this step.` : '';
  $('next').disabled = busy || !session || !step || !$('consent').checked || !window.DecentHead.getWallet().snapshot().connected;
  $('next').textContent = session?.pending ? 'Check pending transaction (no new send)' : step ? titles[step] : 'All steps verified';
  $('transaction-review').textContent = step ? JSON.stringify({
    chain: 'Base (8453)', from: session.account, ...transactionFor(manifest, session, step),
    value: '0 ETH; network gas only', royalties: '10% to creator (market support varies)',
  }, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) : '';
}
async function load(m, metadata) {
  validateRelease(m); validateMetadata(m, metadata);
  if (studio?.session?.pending) throw new Error('Reconcile the pending transaction before loading another release');
  manifest = m; studio = null;
  $('consent').checked = false;
  $('review').hidden = false;
  $('release-summary').textContent = `${m.repo} ${m.version}\nRelease: ${m.releaseDate}\nCreator / royalty recipient: ${m.creator}\n${m.creatorAddress}\nSource commit: ${m.commit}\nSource CID: ${m.codeArchiveCid}\nMetadata: ${m.metadataURI}\nNFT: ${BASE.DNFT}\nEscrow: ${BASE.ESCROW}\nPrice: 10 USDC per edition; 1,000 editions`;
  const asset = uri => `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
  for (const key of ['front', 'back']) { $(key).onerror = () => status(`${key} artwork gateway failed. Open the official release assets to review before signing.`, true); $(key).src = asset(m[key]); }
  $('source').href = `https://github.com/${m.repo}/releases/tag/${encodeURIComponent(m.version)}`;
  $('metadata-link').href = asset(m.metadataURI);
  $('wallet-status').textContent = 'No wallet connection requested.';
  $('purchase-base').value = m.repo === 'TheJollyLaMa/DecentHead' ? 'https://thejollylama.github.io/DecentHead/supporter/buy.html'
    : m.repo === 'TheJollyLaMa/DecentMarket' ? 'https://thejollylama.github.io/DecentMarket/supporter/buy.html' : '';
  status('Prepared metadata preserved exactly. Review the source and terms, then connect.');
}
function preparedRelease(directory) { return action(async () => {
  const files = await Promise.all(['supporter-release.json', 'supporter-metadata.json'].map(async name => {
    const response = await fetch(new URL(`../releases/${directory}/${name}`, import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Release file unavailable: ${name} (HTTP ${response.status})`);
    return response.json();
  }));
  await load(...files);
}); }
$('load-head').onclick = () => preparedRelease('decenthead-v2.0.0');
$('load-market').onclick = () => preparedRelease('decentmarket-v0.3.1');
$('load-files').onclick = () => action(async () => load(await jsonFile('manifest-file'), await jsonFile('metadata-file')));
$('connect').onclick = () => action(async () => {
  if (!$('consent').checked) throw new Error('Review and confirm the official release before connecting');
  const provider = await marketBrowserProvider();
  studio = new SupporterMint(manifest, { provider });
  const { account } = await studio.wallet();
  await studio.verifyProgress();
  await studio.checkContracts(account);
  if (!studio.session) { studio.session = newSession(manifest, account); studio.save(); }
  $('wallet-status').textContent = `${account} · Base · NFT admin and escrow owner verified`;
  status('Connected. Each button sends only the named step. Confirm details and gas in your wallet.');
});
$('consent').onchange = render;
async function exclusive(callback) {
  if (!window.DecentHead.getWallet().snapshot().connected) throw new Error('Wallet disconnected. Reconnect and review before continuing.');
  if (!navigator.locks) throw new Error('This browser needs Web Locks support for safe signing. Use a current Chrome/Edge/Firefox browser.');
  return navigator.locks.request(releaseKey(manifest), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Another tab is processing this release. Wait and reload.');
    return callback();
  });
}
$('next').onclick = () => action(async () => {
  if (!$('consent').checked) throw new Error('Review confirmation required');
  status('Checking progress and simulation. Confirm only this step in your wallet; wait for its receipt.');
  await exclusive(() => studio.execute());
  status('Step confirmed and saved. Download progress before continuing.');
  download('supporter-progress.json', { manifest, session: studio.session });
  if (!nextStep(studio.session)) document.dispatchEvent(new CustomEvent('dnft:minted', { detail: {
    tokenId: studio.session.completed.register.tokenId, chainId: '0x2105',
  } }));
});
$('recover').onclick = () => action(async () => {
  await exclusive(async () => { await studio.verifyProgress(); await studio.reconcile($('recovery-hash').value.trim()); });
  status('Receipt reconciled and progress saved. No new transaction sent.');
  if (!nextStep(studio.session)) document.dispatchEvent(new Event('market:refresh-listings'));
});
$('backup').onclick = () => action(async () => download('supporter-progress.json', { manifest, session: studio.session }));
$('restore').onclick = () => action(async () => {
  if (!studio) throw new Error('Connect the creator wallet first');
  const backup = await jsonFile('progress-file');
  studio.validateSession(backup.session);
  const restored = new SupporterMint(manifest, { provider: studio.provider, storage: { getItem: () => JSON.stringify(backup.session), setItem() {} } });
  await restored.verifyProgress();
  if (studio.session?.pending && JSON.stringify(studio.session) !== JSON.stringify(backup.session)) throw new Error('Existing pending state cannot be overwritten; reconcile it first');
  await exclusive(async () => {
    const currentCount = STEPS.filter(step => studio.session?.completed[step]).length;
    const importedCount = STEPS.filter(step => restored.session.completed[step]).length;
    if (importedCount < currentCount) throw new Error('Cannot roll progress back to an earlier step');
    studio.session = restored.session; studio.save();
  });
  status('Imported progress verified against receipts. Pending transactions still require reconciliation.');
});
$('evidence').onclick = () => action(async () => {
  await studio.verifyProgress();
  const { account } = await studio.wallet(); await studio.checkContracts(account);
  const s = studio.session, nft = new ethers.Contract(BASE.DNFT, NFT_ABI, studio.provider);
  const escrow = new ethers.Contract(BASE.ESCROW, ESCROW_ABI, studio.provider);
  const l = await escrow.listings(s.completed.list.listingId);
  if (!l.active || l.available <= 0n || l.priceAmount !== 10000000n || l.priceETH !== 0n
    || l.priceToken.toLowerCase() !== BASE.USDC.toLowerCase() || l.nftContract.toLowerCase() !== BASE.DNFT.toLowerCase()
    || l.tokenId !== BigInt(s.completed.register.tokenId) || await nft.balanceOf(BASE.ESCROW, l.tokenId) < l.available) throw new Error('Listing is inactive, changed, or insufficiently stocked');
  const evidence = buildEvidence(manifest, s, $('purchase-base').value.trim());
  download('supporter-evidence.json', evidence);
  $('purchase').href = evidence.purchaseUrl; $('purchase').hidden = false;
  status('Current listing verified. Evidence downloaded for steward registration; notifier still checks 12 confirmations. No Discord message sent.');
});
const walletChanged = event => {
  if (!event.detail.connected) status('Wallet disconnected. Progress is preserved; reconnect before continuing.', true);
  render();
};
window.addEventListener('decenthead:wallet', walletChanged);
render();
return () => window.removeEventListener('decenthead:wallet', walletChanged);
}
const standalone = document.querySelector('main[data-supporter-studio]');
if (standalone) mountSupporterStudio(standalone);
