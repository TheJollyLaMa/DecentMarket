import { ethers } from './supporter-mint.mjs';
import { SELLER_LISTINGS_ABI, CREATOR_USDC } from './supporter-listings.mjs';
export { SELLER_LISTINGS_ABI, CREATOR_USDC } from './supporter-listings.mjs';

export const CREATOR_NFT_ABI = [
  'function hasRole(bytes32,address) view returns(bool)', 'function paused() view returns(bool)',
  'function isCreatorProjectApproved(address,bytes32) view returns(bool)',
  'function creatorEditionLimit(address) view returns(uint64)', 'function creatorRoyaltyCapBps() view returns(uint96)',
  'function editionGiftRecipient() view returns(address)',
  'function productCreator(uint256) view returns(address)', 'function productProject(uint256) view returns(bytes32)',
  'function balanceOf(address,uint256) view returns(uint256)',
  'function isApprovedForAll(address,address) view returns(bool)', 'function setApprovalForAll(address,bool)',
  'function registerAndMintProduct(uint256,uint256,string,address,uint96,bytes32) returns(uint256)',
  'function registerAndMintProductWithGift(uint256,uint256,string,address,uint96,bytes32,address) returns(uint256)',
  'event CreatorProjectLinked(uint256 indexed tokenId,address indexed creator,bytes32 indexed projectHash)',
  'event CreatorProductRegistered(uint256 indexed tokenId,address indexed creator,address indexed royaltyReceiver,uint96 royaltyFeeBps,uint256 maxSupply)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'event ApprovalForAll(address indexed account,address indexed operator,bool approved)',
];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const uint = value => typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const nonzero = value => ethers.isAddress(value) && !same(value, ethers.ZeroAddress);
const serial = value => JSON.stringify(value);

export function creatorProjectId(wallet, key) {
  requireValue(nonzero(wallet) && /^[a-zA-Z0-9_-]{1,50}$/.test(key || ''), 'Valid creator wallet and published project key required');
  return `decent-project:${wallet.toLowerCase()}:${key}`;
}
export function validateCreatorManifest(m) {
  requireValue(m?.format === 'decentmarket-creator-supporter' && m.version === 1 && m.chainId === 8453 &&
    nonzero(m.creator) && nonzero(m.collection) && nonzero(m.listings) &&
    m.projectId === creatorProjectId(m.creator, m.projectKey), 'Creator Supporter manifest/deployment identity is invalid');
  requireValue(/^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,100})$/.test(m.metadataURI || ''), 'Upload the reviewed public metadata to IPFS before minting');
  requireValue(uint(m.amount) && uint(m.maxSupply) && uint(m.listQuantity) && uint(m.unitPrice) &&
    BigInt(m.amount) > 0n && BigInt(m.maxSupply) >= BigInt(m.amount) && BigInt(m.listQuantity) > 0n &&
    BigInt(m.listQuantity) <= BigInt(m.amount) - (m.give ? BigInt(m.amount) / 10n : 0n) &&
    BigInt(m.unitPrice) > 0n && typeof m.give === 'boolean' &&
    Number.isInteger(m.royaltyBps) && m.royaltyBps >= 0 && m.royaltyBps <= 1000, 'Mint/list quantities, price or royalty are invalid');
  requireValue(!m.give || nonzero(m.giftRecipient), 'Give requires the explicitly reviewed Agency gift recipient');
  requireValue(!m.give || !same(m.giftRecipient, m.creator), 'The edition gift recipient must be different from the creator');
  return m;
}
export function creatorJournalKey(m) { return `decentmarket:creator-supporter:${m.creator.toLowerCase()}:${m.projectKey}`; }
export async function checkCreatorContracts(m, provider) {
  const nft = new ethers.Contract(m.collection, CREATOR_NFT_ABI, provider);
  const listings = new ethers.Contract(m.listings, SELLER_LISTINGS_ABI, provider);
  requireValue(await nft.hasRole(ethers.id('CREATOR_ROLE'), m.creator) &&
    await nft.isCreatorProjectApproved(m.creator, ethers.id(m.projectId)) && !await nft.paused(),
  'A steward must approve both this creator and published project before minting');
  requireValue(BigInt(m.maxSupply) <= await nft.creatorEditionLimit(m.creator) &&
    BigInt(m.royaltyBps) <= await nft.creatorRoyaltyCapBps(), 'Supply or royalty exceeds this creator collection’s on-chain allowance');
  requireValue(!m.give || same(await nft.editionGiftRecipient(), m.giftRecipient), 'Agency gift recipient changed; review it again without losing a pending mint');
  requireValue(await listings.allowedCollection(m.collection) && await listings.useProductCreator(m.collection) &&
    await listings.allowedPayToken(CREATOR_USDC) && await listings.feesConfigured() && !await listings.paused() &&
    await listings.creatorSaleFeeBps() === 1000n && await listings.resaleFeeBps() === 500n &&
    nonzero(await listings.feeRecipient()), 'Seller listings require the approved collection, Base USDC and reviewed 10%/5% fee configuration');
}
export function creatorTransaction(m, session, step) {
  const nft = new ethers.Interface(CREATOR_NFT_ABI), listings = new ethers.Interface(SELLER_LISTINGS_ABI);
  if (step === 'mint') return { to: m.collection, value: 0n, data: nft.encodeFunctionData(
    m.give ? 'registerAndMintProductWithGift' : 'registerAndMintProduct',
    [m.amount, m.maxSupply, m.metadataURI, m.creator, m.royaltyBps, ethers.id(m.projectId), ...(m.give ? [m.giftRecipient] : [])]) };
  requireValue(uint(session.tokenId), 'Reconcile the minted token before approving or listing');
  if (step === 'approve') return { to: m.collection, value: 0n,
    data: nft.encodeFunctionData('setApprovalForAll', [m.listings, true]) };
  requireValue(step === 'list', 'Unknown creator mint/list step');
  return { to: m.listings, value: 0n, data: listings.encodeFunctionData('list',
    [m.collection, session.tokenId, m.listQuantity, CREATOR_USDC, m.unitPrice]) };
}

export class CreatorSupporter {
  constructor(manifest, { provider, storage, getWallet }) {
    this.manifest = validateCreatorManifest(manifest);
    this.provider = provider; this.storage = storage; this.getWallet = getWallet; this.busy = false;
    const raw = storage.getItem(creatorJournalKey(manifest));
    this.session = raw ? JSON.parse(raw) : {
      format: 'decentmarket-creator-supporter-journal', version: 1, manifest, completed: {}, pending: null,
    };
    requireValue(this.session.format === 'decentmarket-creator-supporter-journal' && this.session.version === 1 &&
      serial(this.session.manifest) === serial(manifest) && this.session.completed && typeof this.session.completed === 'object' &&
      !Array.isArray(this.session.completed), 'Creator journal is invalid or belongs to different mint terms; do not discard it');
    for (const key of Object.keys(this.session.completed)) requireValue(['mint', 'approve', 'list'].includes(key), 'Creator journal contains an unsupported step');
    if (this.session.completed.approve || this.session.completed.list) requireValue(this.session.completed.mint, 'Creator journal is missing the mint receipt');
    if (this.session.completed.list) requireValue(this.session.completed.approve, 'Creator journal is missing the approval receipt');
    if (this.session.pending) requireValue(this.session.pending.step === this.nextStep() &&
      Number.isSafeInteger(this.session.pending.nonce) && this.session.pending.nonce >= 0, 'Creator pending transaction journal is invalid');
    this.save();
  }
  save() { this.storage.setItem(creatorJournalKey(this.manifest), serial(this.session)); }
  nextStep() { return ['mint', 'approve', 'list'].find(step => !this.session.completed[step]) || null; }
  async wallet() {
    const w = await this.getWallet();
    requireValue(same(w.address, this.manifest.creator) && Number((await this.provider.getNetwork()).chainId) === 8453,
      'Connect the published project creator wallet on Base');
    await w.check();
    return w;
  }
  async checkContracts() {
    return checkCreatorContracts(this.manifest, this.provider);
  }
  async verifyTransaction(hash, expected, nonce) {
    requireValue(/^0x[0-9a-f]{64}$/i.test(hash || ''), 'Enter a wallet transaction hash to reconcile');
    const tx = await this.provider.getTransaction(hash);
    requireValue(tx && same(tx.from, this.manifest.creator) && same(tx.to, expected.to) &&
      tx.data.toLowerCase() === expected.data.toLowerCase() && tx.value === 0n && tx.nonce === nonce,
    'Transaction does not match this exact creator mint/list step and saved nonce');
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (!receipt || await this.provider.getBlockNumber() - receipt.blockNumber + 1 < 2) return null;
    requireValue((await this.provider.getBlock(receipt.blockNumber))?.hash === receipt.blockHash, 'Creator transaction is no longer in the canonical Base block');
    return receipt;
  }
  verifyEvents(step, receipt) {
    const m = this.manifest;
    const iface = new ethers.Interface(step === 'list' ? SELLER_LISTINGS_ABI : CREATOR_NFT_ABI);
    const events = receipt.logs.filter(log => same(log.address, step === 'list' ? m.listings : m.collection))
      .map(log => iface.parseLog(log)).filter(Boolean);
    if (step === 'mint') {
      const linked = events.find(e => e.name === 'CreatorProjectLinked' && same(e.args.creator, m.creator) &&
        e.args.projectHash === ethers.id(m.projectId));
      requireValue(linked, 'Mint receipt lacks this creator/project binding');
      const tokenId = linked.args.tokenId;
      requireValue(events.some(e => e.name === 'CreatorProductRegistered' && e.args.tokenId === tokenId &&
        same(e.args.creator, m.creator) && same(e.args.royaltyReceiver, m.creator) &&
        e.args.royaltyFeeBps === BigInt(m.royaltyBps) && e.args.maxSupply === BigInt(m.maxSupply)),
      'Mint receipt lacks the exact creator royalty and supply terms');
      const gifted = m.give ? BigInt(m.amount) / 10n : 0n;
      requireValue(events.some(e => e.name === 'TransferSingle' && same(e.args.from, ethers.ZeroAddress) &&
        same(e.args.to, m.creator) && e.args.id === tokenId && e.args.value === BigInt(m.amount) - gifted),
      'Mint receipt does not deliver the expected editions to the creator');
      if (gifted) requireValue(events.some(e => e.name === 'TransferSingle' && same(e.args.from, ethers.ZeroAddress) &&
        same(e.args.to, m.giftRecipient) && e.args.id === tokenId && e.args.value === gifted), 'Gift receipt does not match the reviewed recipient and edition count');
      this.session.tokenId = tokenId.toString();
    } else if (step === 'approve') requireValue(events.some(e => e.name === 'ApprovalForAll' &&
      same(e.args.account, m.creator) && same(e.args.operator, m.listings) && e.args.approved), 'Approval receipt does not authorize the configured seller listings');
    else {
      const created = events.find(e => e.name === 'ListingCreated' && same(e.args.seller, m.creator) &&
        same(e.args.collection, m.collection) && e.args.tokenId === BigInt(this.session.tokenId) &&
        e.args.quantity === BigInt(m.listQuantity) && same(e.args.payToken, CREATOR_USDC) &&
        e.args.unitPrice === BigInt(m.unitPrice) && e.args.feeBps === 1000n);
      requireValue(created, 'Listing receipt does not match the exact seller, project token, quantity, price and fee');
      this.session.listingId = created.args.listingId.toString();
    }
  }
  async verifyProgress() {
    for (const step of ['mint', 'approve', 'list']) {
      const completed = this.session.completed[step];
      if (!completed) break;
      const receipt = await this.verifyTransaction(completed.hash, creatorTransaction(this.manifest, this.session, step), completed.nonce);
      requireValue(receipt && Number(receipt.status) === 1 && receipt.blockHash === completed.blockHash, 'Saved creator receipt is unavailable or reorganized; do not mint/list again');
      this.verifyEvents(step, receipt);
    }
  }
  async reconcile(hash = this.session.pending?.hash) {
    const pending = this.session.pending;
    requireValue(pending, 'No pending creator transaction to reconcile');
    await this.wallet();
    const receipt = await this.verifyTransaction(hash, creatorTransaction(this.manifest, this.session, pending.step), pending.nonce);
    if (!receipt) { pending.hash = hash; this.save(); return { pending: true }; }
    if (Number(receipt.status) !== 1) {
      this.session.lastRevertedHash = hash; this.session.pending = null; this.save();
      return { reverted: true };
    }
    this.verifyEvents(pending.step, receipt);
    this.session.completed[pending.step] = { hash, nonce: pending.nonce, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber };
    this.session.pending = null; this.save();
    return { completed: pending.step, tokenId: this.session.tokenId, listingId: this.session.listingId };
  }
  async execute() {
    requireValue(!this.busy, 'Creator transaction step is busy');
    this.busy = true;
    try {
      const w = await this.wallet();
      await this.verifyProgress();
      if (this.session.pending) return this.reconcile();
      const step = this.nextStep();
      requireValue(step, 'This series has already been minted and listed');
      await this.checkContracts();
      const expected = creatorTransaction(this.manifest, this.session, step);
      await this.provider.call({ ...expected, from: w.address });
      const gasLimit = (await this.provider.estimateGas({ ...expected, from: w.address })) * 120n / 100n;
      requireValue(this.storage.getItem(creatorJournalKey(this.manifest)) === serial(this.session), 'Creator progress changed in another tab; reload before signing');
      const nonce = await this.provider.getTransactionCount(w.address, 'pending');
      await w.check();
      requireValue(this.storage.getItem(creatorJournalKey(this.manifest)) === serial(this.session), 'Creator progress changed while preparing the nonce; reconcile the other tab');
      this.session.pending = { step, nonce }; this.save();
      let tx;
      try { tx = await w.signer.sendTransaction({ ...expected, nonce, gasLimit }); }
      catch (error) {
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') { this.session.pending = null; this.save(); }
        throw error;
      }
      this.session.pending.hash = tx.hash;
      try { this.save(); } catch (error) { throw new Error(`Creator transaction ${tx.hash} was sent but journal persistence failed: ${error.message}. Reconcile that hash; do not send again.`); }
      await tx.wait(2);
      return this.reconcile();
    } finally { this.busy = false; }
  }
}
