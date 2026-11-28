import './market-head.mjs';
import { ethers } from './supporter-mint.mjs';
import { CreatorSupporter, creatorJournalKey, creatorProjectId, CREATOR_NFT_ABI, validateCreatorManifest, checkCreatorContracts } from './creator-supporter.mjs';
import { previewMetadata, validateFields } from './supporter-draft.mjs';
import { uploadMetadataToIPFS } from './ipfs.js';
import { loadPublishedCreator } from '../vendor/decent-canopy/community/published-creator.mjs';

export async function loadCanopyProjects(wallet, fetchImpl = fetch) {
  const { record, sourceRevision, cid } = await loadPublishedCreator(wallet, { fetchImpl, verifyMessage: ethers.verifyMessage });
  return record.projects.map(project => ({ ...project, creator: record.wallet, projectId: creatorProjectId(record.wallet, project.key),
    sourceRevision, profileCid: cid }));
}

export async function mountCreatorSupporter(root, studioRoot) {
  const $ = name => root.querySelector(`[data-creator-${name}]`);
  let config, projects = [], creator, client, busy = false;
  const status = message => { $('status').textContent = message; };
  async function wallet() {
    const state = window.DecentHead.getWallet().snapshot();
    if (!state.connected || !state.provider || Number(state.chainId) !== 8453) throw new Error('Connect your Base wallet through the shared header first');
    const signer = await state.provider.getSigner();
    const check = async () => {
      const current = window.DecentHead.getWallet().snapshot();
      if (!current.connected || current.provider !== state.provider || current.address?.toLowerCase() !== state.address.toLowerCase() ||
          Number(current.chainId) !== 8453 || Number(await state.provider.send('eth_chainId', [])) !== 8453 ||
          (await signer.getAddress()).toLowerCase() !== state.address.toLowerCase()) throw new Error('Creator wallet or Base network changed');
    };
    await check();
    return { address: state.address, signer, provider: state.provider, check };
  }
  function render() {
    const s = client?.session;
    $('progress').textContent = s ? `Mint: ${s.completed.mint ? 'verified' : 'not completed'}; operator approval: ${s.completed.approve ? 'verified' : 'not completed'}; listing: ${s.completed.list ? `verified #${s.listingId}` : 'not completed'}. ${s.pending ? `Pending ${s.pending.step}: ${s.pending.hash || 'wallet response unknown; inspect history'}. Do not send again.` : ''}` : 'No creator transaction prepared.';
    $('next').disabled = busy || !client || !$('consent').checked || !client.nextStep() && !s?.pending;
    $('next').textContent = s?.pending ? 'Reconcile pending step · no new send' : `Confirm ${client?.nextStep() || 'mint/list'} step`;
    $('review').textContent = client ? JSON.stringify(client.manifest, null, 2) : '';
    $('return').hidden = !s?.completed.list;
    $('sale').hidden = !s?.completed.list;
    if (s?.completed.list) {
      const back = new URL('https://thejollylama.github.io/DecentCanopy/');
      const params = new URLSearchParams(location.search);
      if (params.get('canopyCampaign')) back.searchParams.set('canopyCampaign', params.get('canopyCampaign'));
      back.searchParams.set('projectKey', client.manifest.projectKey);
      back.searchParams.set('mintTxHash', s.completed.mint.hash);
      back.searchParams.set('listingId', s.listingId);
      $('return').href = back.href;
      const sale = new URL('project-supporters.html', location.href);
      sale.search = new URLSearchParams({ creator: client.manifest.creator, projectKey: client.manifest.projectKey, listingId: s.listingId }).toString();
      $('sale').href = sale.href;
      $('evidence').textContent = `Mint ${s.completed.mint.hash}; listing ID ${s.listingId}; collection ${client.manifest.collection}. Return to Canopy for independent verification and steward review.`;
    }
  }
  async function action(fn) {
    if (busy) return;
    busy = true; render();
    try { await fn(); }
    catch (error) { status(error.shortMessage || error.message); console.error('[Creator Supporter]', error); }
    finally { busy = false; render(); }
  }
  async function load(who) {
    projects = await loadCanopyProjects(who);
    const selector = $('project'), selected = new URLSearchParams(location.search).get('projectKey') || selector.value;
    selector.replaceChildren(...projects.map(project => {
      const option = document.createElement('option'); option.value = project.key; option.textContent = project.name; return option;
    }));
    if (projects.some(p => p.key === selected)) selector.value = selected;
    status('Current public signatures verified. Association is self-reported; a steward must approve creator and project before minting.');
  }
  function selectedProject() {
    const project = projects.find(p => p.key === $('project').value);
    if (!project) throw new Error('Choose a current published Canopy project');
    return project;
  }
  $('load').addEventListener('click', () => action(async () => {
    const w = await wallet(); await load(w.address); await w.check();
  }));
  $('use').addEventListener('click', () => {
    try {
      const p = selectedProject(), fields = { name: `${p.name} Supporter`, description: p.description, image: p.image,
        backImage: '', externalUrl: p.website || 'https://thejollylama.github.io/DecentCanopy/', editionSize: '100',
        priceUSDC: '10', royaltyBps: '500', payoutAddress: '' };
      const controller = studioRoot.draftStudio;
      if (!controller) throw new Error('Draft editor is not ready');
      controller.selectPublishedProject({ id: p.projectId, label: p.name, source: `signed Canopy publication ${p.sourceRevision}`,
        fields, provenance: Object.fromEntries(Object.keys(fields).map(key => [key, { kind: ['name', 'description', 'image', 'externalUrl'].includes(key) ? 'source' : 'default' }])) });
      creator = p;
    } catch (error) { status(error.message); }
  });
  $('prepare').addEventListener('click', () => action(async () => {
    const w = await wallet();
    if (!creator || w.address.toLowerCase() !== creator.creator) throw new Error('Use your own published project for this draft');
    if (!config?.collectionAddress || !config.listingsAddress) throw new Error('Creator collection v0.4 and seller listings are not deployed/configured yet; the legacy Agency contracts are not substitutes');
    const current = studioRoot.draftStudio.current();
    const validation = validateFields(current?.fields);
    if (!current || current.project.id !== creator.projectId || validation.missing.length || Object.keys(validation.errors).length) throw new Error('Complete this published project’s draft details before uploading or minting');
    const live = (await loadCanopyProjects(w.address)).find(p => p.key === creator.key);
    if (!live) throw new Error('Project is no longer in the published Canopy profile');
    const key = creatorJournalKey({ creator: w.address, projectKey: creator.key });
    const saved = localStorage.getItem(key);
    if (saved) throw new Error('A series already has a journal for this project. Resume it or explicitly archive a completed series before preparing another.');
    const give = root.querySelector('[name="creator-gift"]:checked')?.value;
    if (!['give', 'skip'].includes(give)) throw new Error('Choose Give or Skip for this mint; both choices are welcome');
    const nft = new ethers.Contract(config.collectionAddress, CREATOR_NFT_ABI, w.provider);
    const giftRecipient = give === 'give' ? await nft.editionGiftRecipient() : ethers.ZeroAddress;
    const manifest = { format: 'decentmarket-creator-supporter', version: 1, chainId: 8453,
      creator: w.address.toLowerCase(), projectKey: creator.key, projectId: creator.projectId,
      collection: config.collectionAddress, listings: config.listingsAddress,
      metadataURI: `ipfs://baf${'a'.repeat(40)}`,
      amount: String($('amount').value), maxSupply: current.fields.editionSize, listQuantity: String($('quantity').value),
      unitPrice: ethers.parseUnits(current.fields.priceUSDC, 6).toString(), royaltyBps: Number(current.fields.royaltyBps),
      give: give === 'give', giftRecipient };
    validateCreatorManifest(manifest);
    await checkCreatorContracts(manifest, w.provider);
    const metadata = previewMetadata(current.fields);
    metadata.properties = { ...metadata.properties, decentProjectId: creator.projectId, creator: w.address.toLowerCase(),
      canopyProfileCid: live.profileCid, canopySourceRevision: live.sourceRevision };
    if (!confirm('Upload these reviewed Supporter details to public IPFS? This does not mint or list. Public copies may persist permanently.')) return;
    const metadataURI = await uploadMetadataToIPFS(metadata);
    await w.check();
    manifest.metadataURI = metadataURI;
    client = new CreatorSupporter(manifest, { provider: w.provider, storage: localStorage, getWallet: wallet });
    await client.checkContracts();
    status('Metadata uploaded. Review the exact creator, project, quantities, royalty, recipient and contracts below. Every transaction is a separate explicit wallet action.');
  }));
  $('resume').addEventListener('click', () => action(async () => {
    const w = await wallet(), p = selectedProject();
    const raw = localStorage.getItem(creatorJournalKey({ creator: w.address, projectKey: p.key }));
    if (!raw) throw new Error('No series journal exists for this wallet/project');
    const saved = JSON.parse(raw);
    client = new CreatorSupporter(saved.manifest, { provider: w.provider, storage: localStorage, getWallet: wallet });
    await client.verifyProgress();
    status('Saved series restored. Pending wallet responses must be reconciled, never resent.');
  }));
  $('next').addEventListener('click', () => action(async () => {
    if (!$('consent').checked || !client) throw new Error('Review and accept these exact mint/list terms first');
    if (!(await loadCanopyProjects(client.manifest.creator)).some(p => p.projectId === client.manifest.projectId)) throw new Error('This project is no longer in the current signed Canopy profile');
    if (!navigator.locks) throw new Error('Use a browser with Web Locks for safe cross-tab mint/list coordination');
    const result = await navigator.locks.request(creatorJournalKey(client.manifest), { ifAvailable: true },
      lock => { if (!lock) throw new Error('Another tab is preparing this project mint/list step'); return client.execute(); });
    status(result.pending ? 'Still pending; do not send again.' : result.reverted ? 'Exact transaction reverted; no mint/list step was completed.' : `Verified ${result.completed} step.`);
  }));
  $('reconcile').addEventListener('click', () => action(async () => {
    if (!client) throw new Error('Resume this project’s series journal first');
    const result = await client.reconcile($('hash').value.trim() || undefined);
    status(result.pending ? 'Awaiting two canonical confirmations.' : result.reverted ? 'Reverted transaction verified; no mint/list completed.' : `Verified ${result.completed}.`);
  }));
  $('new').addEventListener('click', () => action(async () => {
    if (!client || client.session.pending || client.nextStep() && client.nextStep() !== 'mint') throw new Error('Finish/reconcile the existing mint/list flow before starting another series');
    await client.verifyProgress();
    if (!confirm('Archive this series journal in this browser and prepare another series? Existing mint/list receipts are retained; no on-chain change occurs.')) return;
    const key = creatorJournalKey(client.manifest);
    localStorage.setItem(`${key}:archive:${crypto.randomUUID()}`, JSON.stringify(client.session));
    localStorage.removeItem(key); client = null;
    status('Journal archived; existing series remains on-chain. Use your current published project and prepare new reviewed metadata.');
  }));
  $('consent').addEventListener('change', render);
  window.addEventListener('decenthead:wallet', () => { client = null; creator = null; projects = []; $('project').replaceChildren(); render(); status('Wallet changed. Reload your published projects and resume any pending series.'); });
  const response = await fetch('community-supporter.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Creator deployment configuration unavailable (${response.status})`);
  config = await response.json();
  if (config.chainId !== 8453) throw new Error('Creator Supporter flow requires Base');
  const linked = new URLSearchParams(location.search).get('creator');
  if (linked) await load(linked);
  render();
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-creator-supporter]'), studio = document.querySelector('[data-supporter-draft-studio]');
  if (root && studio) mountCreatorSupporter(root, studio).catch(error => {
    root.querySelector('[data-creator-status]').textContent = error.message;
    console.error('[Creator Supporter setup]', error);
  });
}
