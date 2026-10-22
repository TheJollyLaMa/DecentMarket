import { ethers, BASE } from './supporter-mint.mjs';
import { publicMarketProvider, resolveMarketAsset } from './market-gallery.mjs';
import { marketBrowserProvider } from './market-wallet.mjs';

export const MARKET_ESCROW_ABI = [
  'function nextListingId() view returns(uint256)',
  'function paused() view returns(bool)',
  'function listings(uint256) view returns(address nftContract,uint256 tokenId,uint256 priceETH,address priceToken,uint256 priceAmount,uint256 available,bool active,string note)',
  'function purchaseWithETH(uint256,uint256) payable',
  'function purchaseWithToken(uint256,uint256)',
  'event Purchased(uint256 indexed listingId,address indexed buyer,uint256 amount,address indexed paymentToken,uint256 totalPaid)',
];
const NFT = ['function uri(uint256) view returns(string)', 'function balanceOf(address,uint256) view returns(uint256)'];
const ERC20 = ['function decimals() view returns(uint8)', 'function symbol() view returns(string)',
  'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)'];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export function parseMarketPurchase(search) {
  const params = new URLSearchParams(search);
  for (const key of ['chainId', 'escrow', 'listingId']) {
    if (params.getAll(key).length !== 1) throw new Error(`Exactly one ${key} required`);
  }
  if (params.get('chainId') !== '8453' || !same(params.get('escrow'), BASE.ESCROW)
    || !/^(0|[1-9]\d*)$/.test(params.get('listingId') || ''))
    throw new Error('A valid Base Market escrow listing link is required');
  return params.get('listingId');
}
export const assetKey = product => same(product.nftContract || BASE.DNFT, BASE.DNFT)
  ? String(product.tokenId) : `${product.nftContract.toLowerCase()}:${product.tokenId}`;
export const listingTerms = listing => [listing.nftContract.toLowerCase(), String(listing.tokenId),
  String(listing.priceETH), listing.priceToken.toLowerCase(), String(listing.priceAmount)].join(':');

export function listingPrices(listing) {
  const prices = [];
  const trim = value => value.replace(/\.0+$/, '');
  if (listing.priceETH > 0n) prices.push({ method: 'eth', label: `${trim(ethers.formatEther(listing.priceETH))} ETH` });
  if (listing.priceAmount > 0n && listing.tokenInfo) prices.push({ method: 'token',
    label: `${trim(ethers.formatUnits(listing.priceAmount, listing.tokenInfo.decimals))} ${listing.tokenInfo.symbol}` });
  return prices;
}

export async function readFundedListings({ escrow, nftFor, tokenFor, blockTag, fetchMetadata, onProgress = () => {} }) {
  const [count, paused] = await Promise.all([escrow.nextListingId({ blockTag }), escrow.paused({ blockTag })]);
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Listing count is too large');
  const listings = [], errors = [], stock = new Map(), totals = new Map(), tokens = new Map();
  // Read the small escrow index, not every registered NFT. Serial reads avoid public-RPC bursts.
  for (let id = Number(count) - 1; id >= 0; id--) {
    try {
      const raw = await escrow.listings(id, { blockTag });
      if (!raw.active || raw.available === 0n) continue;
      const listing = { id: String(id), nftContract: raw.nftContract, tokenId: String(raw.tokenId),
        priceETH: raw.priceETH, priceToken: raw.priceToken, priceAmount: raw.priceAmount,
        available: raw.available, note: raw.note };
      const key = assetKey(listing), nft = nftFor(listing.nftContract);
      totals.set(key, (totals.get(key) || 0n) + raw.available);
      if (!stock.has(key)) stock.set(key, await nft.balanceOf(BASE.ESCROW, listing.tokenId, { blockTag }));
      if (raw.priceAmount > 0n) {
        const address = raw.priceToken.toLowerCase();
        if (!tokens.has(address)) {
          const token = tokenFor(raw.priceToken);
          const [decimals, symbol] = await Promise.all([token.decimals({ blockTag }), token.symbol({ blockTag })]);
          if (Number(decimals) > 255 || typeof symbol !== 'string' || !symbol.trim() || symbol.length > 32) throw new Error('Invalid payment-token metadata');
          tokens.set(address, { decimals: Number(decimals), symbol });
        }
        listing.tokenInfo = tokens.get(address);
      }
      let metadata;
      try { metadata = await fetchMetadata((await nft.uri(listing.tokenId, { blockTag })).replace(/\{id\}/g, BigInt(listing.tokenId).toString(16).padStart(64, '0'))); }
      catch (error) {
        errors.push(`Listing ${id} artwork/metadata unavailable: ${error.message}`);
        metadata = { name: `DNFT #${listing.tokenId}`, description: 'Metadata unavailable; inspect the contract before purchasing.' };
      }
      listings.push({ ...listing, metadata });
      onProgress({ checked: Number(count) - id, total: Number(count) });
    } catch (error) { errors.push(`Listing ${id} could not be verified: ${error.message}`); }
  }
  // The escrow can list the same inventory twice. Do not advertise uncovered reservations.
  const products = new Map();
  for (const listing of listings) {
    const key = assetKey(listing);
    listing.purchasable = !paused && stock.get(key) >= totals.get(key) && listingPrices(listing).length > 0 && errors.every(e => !e.includes('could not be verified'));
    listing.status = paused ? 'Escrow paused' : stock.get(key) < totals.get(key) ? 'Uncovered escrow stock'
      : listing.purchasable ? 'Ready to purchase' : 'Listing verification incomplete';
    if (!products.has(key)) products.set(key, { tokenId: listing.tokenId, nftContract: listing.nftContract,
      metadata: listing.metadata, escrowStock: stock.get(key).toString(), blockNumber: Number(listing.id), listings: [] });
    products.get(key).listings.push(listing);
  }
  return { products: [...products.values()], errors, paused };
}

export async function loadMarketListings() {
  const provider = publicMarketProvider(ethers, 'https://mainnet.base.org');
  try {
    if ((await provider.getNetwork()).chainId !== 8453n) throw new Error('Marketplace RPC is not Base');
    const blockTag = await provider.getBlockNumber();
    return await readFundedListings({
      escrow: new ethers.Contract(BASE.ESCROW, MARKET_ESCROW_ABI, provider),
      nftFor: address => new ethers.Contract(address, NFT, provider),
      tokenFor: address => new ethers.Contract(address, ERC20, provider),
      blockTag,
      fetchMetadata: async uri => {
        const url = resolveMarketAsset(uri);
        if (!url) throw new Error('Missing metadata URL');
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
        const value = await response.json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata');
        return value;
      },
    });
  } finally { provider.destroy(); }
}

export async function executeMarketPurchase({ listing, method, provider, escrow, tokenFor, nftFor, account, assertSession, status }) {
  if (!['eth', 'token'].includes(method)) throw new Error('Unknown payment method');
  if (!listing.purchasable) throw new Error('This listing is not verified for purchase');
  const price = method === 'eth' ? listing.priceETH : listing.priceAmount;
  if (price <= 0n) throw new Error('This payment method is unavailable');
  const verify = async () => {
    await assertSession();
    if ((await provider.getNetwork()).chainId !== 8453n) throw new Error('Switch to Base before buying');
    const [raw, paused, stock] = await Promise.all([
      escrow.listings(listing.id), escrow.paused(), nftFor(listing.nftContract).balanceOf(BASE.ESCROW, listing.tokenId),
    ]);
    if (listingTerms(raw) !== listingTerms(listing) || !raw.active || raw.available < 1n || paused || stock < raw.available)
      throw new Error('Listing changed, sold out, paused or uncovered. Refresh and review it again.');
    const count = await escrow.nextListingId();
    let reserved = 0n;
    for (let id = 0n; id < count; id++) {
      const other = await escrow.listings(id);
      if (other.active && same(other.nftContract, listing.nftContract) && other.tokenId === BigInt(listing.tokenId)) reserved += other.available;
    }
    if (stock < reserved) throw new Error('Escrow inventory is reserved by overlapping listings. Refresh after the steward corrects it.');
    await assertSession();
  };
  status('Checking current price and stock...');
  await verify();
  if (method === 'token') {
    const token = tokenFor(listing.priceToken);
    if (await token.balanceOf(account) < price) throw new Error('Insufficient payment-token balance');
    if (await token.allowance(account, BASE.ESCROW) < price) {
      await assertSession();
      status(`Approve exactly ${listingPrices(listing).find(p => p.method === method).label} for this edition in your wallet.`);
      const receipt = await (await token.approve(BASE.ESCROW, price, { chainId: 8453n })).wait();
      if (receipt?.status !== 1) throw new Error('Payment-token approval did not confirm');
    }
  }
  await verify();
  status('Confirm purchase of one edition in your wallet...');
  const tx = method === 'eth' ? await escrow.purchaseWithETH(listing.id, 1n, { value: price, chainId: 8453n })
    : await escrow.purchaseWithToken(listing.id, 1n, { chainId: 8453n });
  status('Purchase submitted. Waiting for confirmation; do not submit again...');
  const receipt = await tx.wait();
  if (receipt?.status !== 1) throw new Error(`Purchase not confirmed. Check ${tx.hash} before retrying.`);
  const event = receipt.logs.filter(log => same(log.address, BASE.ESCROW)).map(log => {
    try { return escrow.interface.parseLog(log); } catch { return null; }
  }).find(event => event?.name === 'Purchased' && event.args.listingId === BigInt(listing.id) &&
    same(event.args.buyer, account) && event.args.amount === 1n &&
    same(event.args.paymentToken, method === 'eth' ? ethers.ZeroAddress : listing.priceToken) && event.args.totalPaid === price);
  if (!event) throw new Error(`Receipt lacks the expected purchase event. Inspect ${tx.hash}; do not retry blindly.`);
  return tx.hash;
}

export async function purchaseMarketListing(listing, method, status) {
  const provider = await marketBrowserProvider();
  const signer = await provider.getSigner(), account = await signer.getAddress();
  const session = globalThis.DecentHead.getWallet();
  const rawProvider = session.rawProvider;
  const assertSession = async () => {
    const state = session.snapshot();
    const accounts = await rawProvider.request({ method: 'eth_accounts' });
    const chain = await rawProvider.request({ method: 'eth_chainId' });
    if (!state.connected || session.rawProvider !== rawProvider || !same(state.address, account) ||
      !same(accounts[0], account) || BigInt(chain) !== 8453n) throw new Error('Wallet account or chain changed. Review again.');
  };
  return executeMarketPurchase({ listing, method, provider, account, assertSession, status,
    escrow: new ethers.Contract(BASE.ESCROW, MARKET_ESCROW_ABI, signer),
    tokenFor: address => new ethers.Contract(address, ERC20, signer),
    nftFor: address => new ethers.Contract(address, NFT, provider) });
}
