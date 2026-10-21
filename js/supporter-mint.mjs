import * as ethersModule from './vendor/ethers.umd.min.js';
import { CONTRACTS } from './config/contracts.js';
export const ethers = globalThis.ethers || ethersModule.default;
export const BASE = CONTRACTS.base.addresses;
export const STEPS = ['register', 'mint', 'transfer', 'list'];
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const cid = value => typeof value === 'string' && /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(value);
const pinned = value => typeof value === 'string' && value.startsWith('ipfs://') && cid(value.slice(7));
export const NFT_ABI = [
  'function hasRole(bytes32,address) view returns(bool)',
  'function uri(uint256) view returns(string)',
  'function balanceOf(address,uint256) view returns(uint256)',
  'function royaltyInfo(uint256,uint256) view returns(address,uint256)',
  'function registerToken(uint256,string,uint8,address,uint96) returns(uint256)',
  'function mintProduct(address,uint256,uint256)',
  'function safeTransferFrom(address,address,uint256,uint256,bytes)',
  'event TokenRegistered(uint256 indexed tokenId,address indexed creator,uint256 maxSupply,uint8 kind,string uri)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
];
export const ESCROW_ABI = [
  'function owner() view returns(address)',
  'function paused() view returns(bool)',
  'function listDNFT(address,uint256,uint256,address,uint256,uint256,string) returns(uint256)',
  'function listings(uint256) view returns(address nftContract,uint256 tokenId,uint256 priceETH,address priceToken,uint256 priceAmount,uint256 available,bool active,string note)',
  'event Listed(uint256 indexed listingId,address indexed nftContract,uint256 indexed tokenId,uint256 priceETH,address priceToken,uint256 priceAmount,uint256 quantity,string note)',
];
export function validateRelease(m) {
  requireThat(m?.schema === 1 && /^[\w.-]+\/[\w.-]+$/.test(m.repo || '') && /^[\w.-]+$/.test(m.version || ''), 'Expected a schema-1 prepared repository/version release');
  requireThat(/^[a-f0-9]{40}$/.test(m.commit || '') && cid(m.codeArchiveCid), 'Exact source commit and pinned archive required');
  requireThat(Number.isFinite(Date.parse(m.releaseDate)) && new Date(m.releaseDate).toISOString() === m.releaseDate, 'Canonical release date required');
  requireThat(m.creator === 'thejollylama.eth' && ethers.isAddress(m.creatorAddress) && !same(m.creatorAddress, ethers.ZeroAddress), 'Resolved Decent creator identity required');
  requireThat(m.chainId === 8453 && m.quantity === '1000' && m.priceUSDC === '10000000', 'Only Base / 1,000 editions / 10 USDC is supported');
  for (const key of ['front', 'back', 'animation', 'metadataURI']) requireThat(pinned(m[key]), `Pinned ${key} CID required`);
  return m;
}
export function validateMetadata(m, metadata) {
  validateRelease(m);
  const p = metadata?.properties;
  requireThat(metadata.image === m.front && metadata.animation_url === m.animation && p?.back_image === m.back, 'Metadata artwork differs from prepared release');
  for (const [key, expected] of Object.entries({ repo: m.repo, version: m.version, commit: m.commit, code_archive_cid: m.codeArchiveCid, creator_address: m.creatorAddress, release_date: m.releaseDate })) {
    requireThat(p[key] === expected, `Metadata ${key} differs from prepared release`);
  }
  requireThat(p.supply === 1000 && p.price === '10 USDC' && p.chain === 'Base' && p.royalty_bps === 1000, 'Metadata edition, price, chain or royalty terms differ');
  return metadata;
}
export const releaseKey = m => `decent-supporter:8453:${m.repo}:${m.version}`;
export const fingerprint = m => ethers.sha256(ethers.toUtf8Bytes(JSON.stringify([
  m.repo, m.version, m.commit, m.codeArchiveCid, m.metadataURI, m.front, m.back,
  m.animation, m.releaseDate, m.creatorAddress, m.chainId, m.quantity, m.priceUSDC,
])));
export function newSession(m, account) {
  validateRelease(m);
  requireThat(same(account, m.creatorAddress), 'Connect the prepared creator wallet');
  return { schema: 1, fingerprint: fingerprint(m), account: ethers.getAddress(account), completed: {}, pending: null };
}
export function nextStep(session) {
  return STEPS.find(step => !session.completed[step]) || null;
}
export function transactionFor(m, s, step) {
  requireThat(STEPS.includes(step), 'Unknown transaction step');
  const nft = new ethers.Interface(NFT_ABI), escrow = new ethers.Interface(ESCROW_ABI);
  const token = s.completed.register?.tokenId;
  if (step !== 'register') requireThat(/^\d+$/.test(token || ''), 'Verified registration token ID required');
  const calls = {
    register: () => [BASE.DNFT, nft.encodeFunctionData('registerToken', [1000, m.metadataURI, 0, s.account, 1000])],
    mint: () => [BASE.DNFT, nft.encodeFunctionData('mintProduct', [s.account, token, 1000])],
    transfer: () => [BASE.DNFT, nft.encodeFunctionData('safeTransferFrom', [s.account, BASE.ESCROW, token, 1000, '0x'])],
    list: () => [BASE.ESCROW, escrow.encodeFunctionData('listDNFT', [BASE.DNFT, token, 0, BASE.USDC, 10000000, 1000, `${m.repo} ${m.version} Supporter DNFT`])],
  };
  const [to, data] = calls[step]();
  return { to, data, value: 0n };
}
export function verifyTransaction(tx, expected, account, nonce) {
  requireThat(tx && Number(tx.chainId) === 8453 && same(tx.from, account) && same(tx.to, expected.to)
    && same(tx.data, expected.data) && BigInt(tx.value) === 0n && tx.nonce === nonce, 'Transaction does not match this account, Base network, nonce and exact release step');
}
export function verifyReceipt(m, s, step, receipt) {
  requireThat(receipt && Number(receipt.status) === 1, 'Transaction has not succeeded');
  const nft = new ethers.Interface(NFT_ABI), escrow = new ethers.Interface(ESCROW_ABI);
  const target = step === 'list' ? BASE.ESCROW : BASE.DNFT;
  const iface = step === 'list' ? escrow : nft;
  const events = receipt.logs.filter(log => same(log.address, target)).map(log => iface.parseLog(log)).filter(Boolean);
  let result = { hash: receipt.hash, blockNumber: receipt.blockNumber };
  if (step === 'register') {
    const event = events.find(e => e.name === 'TokenRegistered');
    requireThat(event && same(event.args.creator, s.account) && event.args.maxSupply === 1000n && event.args.kind === 0n && event.args.uri === m.metadataURI, 'Registration event differs from prepared release');
    result.tokenId = event.args.tokenId.toString();
  } else if (step === 'list') {
    const e = events.find(e => e.name === 'Listed')?.args;
    requireThat(e && same(e.nftContract, BASE.DNFT) && e.tokenId === BigInt(s.completed.register.tokenId)
      && e.priceETH === 0n && same(e.priceToken, BASE.USDC) && e.priceAmount === 10000000n && e.quantity === 1000n, 'Listing event differs from fixed Supporter terms');
    result.listingId = e.listingId.toString();
  } else {
    const from = step === 'mint' ? ethers.ZeroAddress : s.account;
    const to = step === 'mint' ? s.account : BASE.ESCROW;
    const event = events.find(e => e.name === 'TransferSingle' && same(e.args.from, from) && same(e.args.to, to)
      && e.args.id === BigInt(s.completed.register.tokenId) && e.args.value === 1000n);
    requireThat(event, 'Expected 1,000-edition mint/transfer event not found');
  }
  return result;
}
export function buildEvidence(m, s, purchaseBase) {
  requireThat(!nextStep(s) && !s.pending, 'Complete and verify all four steps before exporting evidence');
  const url = new URL(purchaseBase);
  requireThat(url.protocol === 'https:' && !url.username && !url.password && url.pathname.endsWith('/supporter/buy.html'), 'Public HTTPS supporter/buy.html purchase route required');
  url.search = new URLSearchParams({ chainId: '8453', escrow: BASE.ESCROW, listingId: s.completed.list.listingId });
  return {
    chainId: 8453, rpcUrl: 'https://mainnet.base.org', mintTxHash: s.completed.mint.hash,
    nftContract: BASE.DNFT, tokenId: s.completed.register.tokenId, escrow: BASE.ESCROW,
    listingId: s.completed.list.listingId, confirmations: 12, purchaseUrl: url.href,
  };
}
export class SupporterMint {
  constructor(manifest, { provider, storage = localStorage } = {}) {
    this.manifest = validateRelease(manifest);
    this.provider = provider;
    this.storage = storage;
    const saved = storage.getItem(releaseKey(manifest));
    this.session = saved ? JSON.parse(saved) : null;
    if (this.session) this.validateSession(this.session);
    this.busy = false;
  }
  validateSession(s) {
    requireThat(s.schema === 1 && s.fingerprint === fingerprint(this.manifest) && same(s.account, this.manifest.creatorAddress), 'Saved progress belongs to different release metadata/account; do not overwrite it');
    requireThat(s.completed && typeof s.completed === 'object', 'Invalid saved progress');
    let missing = false;
    for (const step of STEPS) {
      if (!s.completed[step]) missing = true;
      else requireThat(!missing && /^0x[a-fA-F0-9]{64}$/.test(s.completed[step].hash || ''), 'Invalid or out-of-order saved transaction');
    }
    if (s.pending) requireThat(s.pending.step === nextStep(s) && Number.isSafeInteger(s.pending.nonce) && s.pending.nonce >= 0, 'Invalid pending step');
  }
  save() {
    this.storage.setItem(releaseKey(this.manifest), JSON.stringify(this.session));
  }
  async wallet() {
    const chain = await this.provider.send('eth_chainId', []);
    requireThat(BigInt(chain) === 8453n, 'Switch your wallet to Base (8453) before continuing');
    const signer = await this.provider.getSigner();
    const account = await signer.getAddress();
    requireThat(same(account, this.manifest.creatorAddress), 'Select the prepared creator wallet');
    return { signer, account };
  }
  async checkContracts(account) {
    const nft = new ethers.Contract(BASE.DNFT, NFT_ABI, this.provider);
    const escrow = new ethers.Contract(BASE.ESCROW, ESCROW_ABI, this.provider);
    requireThat(await nft.hasRole(ethers.ZeroHash, account), 'Creator wallet does not have NFT administrator permission');
    requireThat(same(await escrow.owner(), account), 'Creator wallet must own this escrow');
    requireThat(!(await escrow.paused()), 'Escrow is paused');
    const registration = this.session?.completed.register;
    if (registration) {
      requireThat(await nft.uri(registration.tokenId) === this.manifest.metadataURI, 'On-chain metadata changed; stop and reconcile');
      const royalty = await nft.royaltyInfo(registration.tokenId, 10000);
      requireThat(same(royalty[0], account) && royalty[1] === 1000n, 'On-chain royalty terms differ from this release');
    }
  }
  async verifyProgress() {
    if (!this.session) return;
    this.validateSession(this.session);
    const verified = newSession(this.manifest, this.session.account);
    for (const step of STEPS) {
      const recorded = this.session.completed[step];
      if (!recorded) break;
      const expected = transactionFor(this.manifest, verified, step);
      const tx = await this.provider.getTransaction(recorded.hash);
      requireThat(tx, `Recorded ${step} transaction is unavailable; do not restart`);
      verifyTransaction(tx, expected, verified.account, tx.nonce);
      const receipt = await this.provider.getTransactionReceipt(recorded.hash);
      const result = verifyReceipt(this.manifest, verified, step, receipt);
      requireThat(JSON.stringify(result) === JSON.stringify(recorded), 'Saved IDs or receipt provenance differ from chain');
      verified.completed[step] = result;
    }
  }
  async reconcile(hash) {
    requireThat(this.session?.pending, 'No pending transaction to reconcile');
    const pending = this.session.pending;
    const txHash = hash || pending.hash;
    requireThat(/^0x[a-fA-F0-9]{64}$/.test(txHash || ''), 'Enter the public transaction hash from wallet activity');
    const expected = transactionFor(this.manifest, this.session, pending.step);
    const tx = await this.provider.getTransaction(txHash);
    verifyTransaction(tx, expected, this.session.account, pending.nonce);
    const receipt = await this.provider.getTransactionReceipt(txHash);
    requireThat(receipt, 'Transaction is still pending or unavailable; no new transaction will be sent');
    if (Number(receipt.status) === 0) {
      this.session.pending = null;
      this.save();
      throw new Error('Transaction reverted on chain; progress preserved. Review the error before retrying this step.');
    }
    const result = verifyReceipt(this.manifest, this.session, pending.step, receipt);
    this.session.completed[pending.step] = result;
    this.session.pending = null;
    this.save();
    return result;
  }
  async execute() {
    requireThat(!this.busy, 'A step is already in progress');
    this.busy = true;
    try {
      const { signer, account } = await this.wallet();
      if (!this.session) { this.session = newSession(this.manifest, account); this.save(); }
      await this.verifyProgress();
      if (this.session.pending) return await this.reconcile();
      await this.checkContracts(account);
      const step = nextStep(this.session);
      requireThat(step, 'All steps are already complete');
      const expected = transactionFor(this.manifest, this.session, step);
      await this.provider.call({ ...expected, from: account });
      const gasLimit = (await this.provider.estimateGas({ ...expected, from: account })) * 120n / 100n;
      // Stop if another tab has already claimed or completed this release step.
      requireThat(this.storage.getItem(releaseKey(this.manifest)) === JSON.stringify(this.session), 'Progress changed in another tab; reload before continuing');
      const nonce = await this.provider.getTransactionCount(account, 'pending');
      const current = await this.wallet();
      requireThat(same(current.account, account), 'Wallet changed during preparation; reconnect before signing');
      this.session.pending = { step, nonce };
      this.save();
      let tx;
      try { tx = await signer.sendTransaction({ ...expected, nonce, gasLimit }); }
      catch (error) {
        if (error.code === 'ACTION_REJECTED' || error.code === 4001) { this.session.pending = null; this.save(); }
        throw error;
      }
      this.session.pending.hash = tx.hash;
      this.save();
      await tx.wait();
      return await this.reconcile();
    } finally { this.busy = false; }
  }
}
