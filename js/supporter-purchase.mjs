import { ethers } from './supporter-mint.mjs';
import { SELLER_LISTINGS_ABI, readCreatorListings } from './supporter-listings.mjs';

const TOKEN_ABI = [
  'function allowance(address,address) view returns(uint256)', 'function balanceOf(address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)', 'event Approval(address indexed owner,address indexed spender,uint256 value)',
];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const uint = value => typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const serial = JSON.stringify;
export const purchaseJournalKey = (config, buyer, listingId) =>
  `decentmarket:supporter-purchase:8453:${config.listingsAddress.toLowerCase()}:${buyer.toLowerCase()}:${listingId}`;

export class SupporterPurchase {
  constructor({ config, creator, projectKey, listingId, quantity }, { provider, storage, getWallet, confirm }) {
    requireValue(uint(listingId) && uint(quantity) && BigInt(quantity) > 0n, 'Choose a nonnegative listing ID and positive edition quantity');
    requireValue(config?.chainId === 8453 && [config.collectionAddress, config.listingsAddress, creator].every(address =>
      ethers.isAddress(address) && !same(address, ethers.ZeroAddress)) && /^[a-zA-Z0-9_-]{1,50}$/.test(projectKey || ''),
    'Verified Base creator/listings deployment and published project required');
    this.config = config; this.creator = creator; this.projectKey = projectKey;
    this.listingId = listingId; this.quantity = quantity;
    this.provider = provider; this.storage = storage; this.getWallet = getWallet; this.confirm = confirm;
  }
  async wallet() {
    const w = await this.getWallet();
    requireValue(Number((await this.provider.getNetwork()).chainId) === 8453, 'Connect the buyer wallet on Base');
    await w.check();
    requireValue(ethers.isAddress(w.address) && !same(w.address, ethers.ZeroAddress), 'A nonzero buyer wallet is required');
    return w;
  }
  read(w) {
    const key = purchaseJournalKey(this.config, w.address, this.listingId), raw = this.storage.getItem(key);
    const session = raw ? JSON.parse(raw) : null;
    if (session) {
      requireValue(session.format === 'decentmarket-supporter-purchase' && session.version === 1 &&
        session.chainId === 8453 && same(session.buyer, w.address) && same(session.creator, this.creator) &&
        same(session.collection, this.config.collectionAddress) && same(session.listings, this.config.listingsAddress) &&
        session.projectKey === this.projectKey && session.listingId === this.listingId &&
        uint(session.quantity) && BigInt(session.quantity) > 0n && uint(session.total) && BigInt(session.total) > 0n && ethers.isAddress(session.payToken),
      'Purchase journal does not match this wallet, project and deployment; do not overwrite it');
      if (session.pending) requireValue(['approve', 'purchase'].includes(session.pending.step) &&
        Number.isSafeInteger(session.pending.nonce) && session.pending.nonce >= 0, 'Saved pending purchase step is invalid');
    }
    return { key, raw, session };
  }
  expected(session, step) {
    if (step === 'approve') return { to: session.payToken, value: 0n,
      data: new ethers.Interface(TOKEN_ABI).encodeFunctionData('approve', [session.listings, session.total]) };
    const native = same(session.payToken, ethers.ZeroAddress);
    return { to: session.listings, value: native ? BigInt(session.total) : 0n,
      data: new ethers.Interface(SELLER_LISTINGS_ABI).encodeFunctionData(native ? 'purchaseWithETH' : 'purchaseWithToken',
        [session.listingId, session.quantity, ...(native ? [] : [session.total])]) };
  }
  archive(key, session) {
    this.storage.setItem(`${key}:receipt:${crypto.randomUUID()}`, serial(session));
    this.storage.removeItem(key);
  }
  async reset() {
    const w = await this.wallet(), { key, session } = this.read(w);
    requireValue(session && !session.pending, 'Reconcile any pending transaction before discarding a quote');
    this.archive(key, session);
  }
  async execute() {
    const w = await this.wallet();
    const { key, raw, session: previous } = this.read(w);
    requireValue(!previous?.pending, 'A wallet transaction is pending or unknown. Reconcile its exact hash; do not send again');
    requireValue(!previous || previous.quantity === this.quantity, 'This saved quote has a different quantity; discard the unsubmitted quote explicitly first');
    const rows = await readCreatorListings(this.config, this.creator, [this.projectKey], { ethers, provider: this.provider });
    const row = rows.find(r => r.listingId === this.listingId);
    requireValue(row && BigInt(this.quantity) <= BigInt(row.quantity), 'This project listing is inactive or has insufficient editions');
    const listings = new ethers.Contract(this.config.listingsAddress, SELLER_LISTINGS_ABI, this.provider);
    const quote = await listings.quote(this.listingId, this.quantity);
    const session = previous || { format: 'decentmarket-supporter-purchase', version: 1, chainId: 8453,
      buyer: w.address, creator: this.creator, projectKey: this.projectKey, collection: this.config.collectionAddress,
      listings: this.config.listingsAddress, listingId: this.listingId, quantity: this.quantity,
      payToken: row.payToken, total: quote.total.toString(), pending: null };
    requireValue(same(row.payToken, session.payToken) && quote.total <= BigInt(session.total), 'Price or asset changed; review a new quote, never silently increase payment');
    const display = { ...row, quantity: this.quantity, total: ethers.formatUnits(session.total, row.decimals),
      sellerProceeds: ethers.formatUnits(quote.sellerProceeds, row.decimals),
      platformFee: ethers.formatUnits(quote.platformFee, row.decimals),
      royaltyAmount: ethers.formatUnits(quote.royaltyAmount, row.decimals), buyer: w.address, seller: this.creator };
    if (!await this.confirm(display)) return { cancelled: true };
    await w.check();
    requireValue(this.storage.getItem(key) === raw, 'Purchase progress changed in another tab; reconcile it before signing');
    this.storage.setItem(key, serial(session));
    let step = 'purchase';
    if (!same(session.payToken, ethers.ZeroAddress)) {
      const token = new ethers.Contract(session.payToken, TOKEN_ABI, this.provider);
      requireValue(await token.balanceOf(w.address) >= quote.total, 'Buyer payment-token balance is insufficient');
      if (await token.allowance(w.address, session.listings) < BigInt(session.total)) step = 'approve';
    }
    const expected = this.expected(session, step);
    await this.provider.call({ ...expected, from: w.address });
    const gasLimit = (await this.provider.estimateGas({ ...expected, from: w.address })) * 120n / 100n;
    const nonce = await this.provider.getTransactionCount(w.address, 'pending');
    await w.check();
    requireValue(this.storage.getItem(key) === serial(session), 'Purchase progress changed while preparing the nonce');
    session.pending = { step, nonce };
    this.storage.setItem(key, serial(session));
    let tx;
    try { tx = await w.signer.sendTransaction({ ...expected, nonce, gasLimit }); }
    catch (error) {
      if (error.code === 4001 || error.code === 'ACTION_REJECTED') { session.pending = null; this.storage.setItem(key, serial(session)); }
      throw error;
    }
    session.pending.hash = tx.hash;
    try { this.storage.setItem(key, serial(session)); }
    catch (error) { throw new Error(`Transaction ${tx.hash} was sent but persistence failed: ${error.message}. Reconcile that hash; do not send again.`); }
    await tx.wait(2);
    return this.reconcile(tx.hash);
  }
  async reconcile(hash) {
    const w = await this.wallet(), { key, raw, session } = this.read(w);
    requireValue(session?.pending, 'No pending purchase or approval is saved for this wallet/listing');
    hash ||= session.pending.hash;
    requireValue(/^0x[0-9a-f]{64}$/i.test(hash || ''), 'Enter the exact wallet transaction hash');
    const expected = this.expected(session, session.pending.step), tx = await this.provider.getTransaction(hash);
    requireValue(tx && same(tx.from, session.buyer) && same(tx.to, expected.to) && tx.nonce === session.pending.nonce &&
      tx.value === expected.value && same(tx.data, expected.data), 'Transaction does not match the saved purchase/approval and exact nonce');
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (!receipt || await this.provider.getBlockNumber() - receipt.blockNumber + 1 < 2) return { pending: true };
    requireValue((await this.provider.getBlock(receipt.blockNumber))?.hash === receipt.blockHash, 'Purchase receipt is not in the canonical Base block');
    requireValue(this.storage.getItem(key) === raw, 'Purchase progress changed during receipt verification; reload it');
    if (receipt.status === 0) {
      session.pending = null; this.storage.setItem(key, serial(session)); return { reverted: true };
    }
    requireValue(receipt.status === 1, 'Purchase receipt status is unavailable');
    const step = session.pending.step, iface = new ethers.Interface(step === 'approve' ? TOKEN_ABI : SELLER_LISTINGS_ABI);
    const events = receipt.logs.filter(log => same(log.address, expected.to)).map(log => iface.parseLog(log)).filter(Boolean);
    requireValue(step === 'approve' ? events.some(e => e.name === 'Approval' && same(e.args.owner, session.buyer) &&
      same(e.args.spender, session.listings) && e.args.value === BigInt(session.total)) :
      events.some(e => e.name === 'Purchased' && e.args.listingId === BigInt(session.listingId) &&
        same(e.args.buyer, session.buyer) && same(e.args.seller, session.creator) &&
        e.args.quantity === BigInt(session.quantity) && same(e.args.payToken, session.payToken) &&
        e.args.totalPaid > 0n && e.args.totalPaid <= BigInt(session.total)), 'Receipt lacks this exact buyer purchase/approval event');
    session[step] = { hash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber };
    session.pending = null;
    if (step === 'purchase') this.archive(key, session);
    else this.storage.setItem(key, serial(session));
    return { completed: step, hash };
  }
}
