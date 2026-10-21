import { BASE, NFT_ABI, ESCROW_ABI, ethers, validateRelease, validateMetadata } from './supporter-mint.mjs';
import { publicMarketProvider } from './market-gallery.mjs';
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export async function verifyPublicListing({ nft, escrow, entry, manifest }) {
  validateRelease(manifest);
  if (!/^\d+$/.test(entry.tokenId) || !/^\d+$/.test(entry.listingId)) throw new Error('Invalid token/listing ID');
  const [listing, paused, uri, balance, royalty] = await Promise.all([
    escrow.listings(entry.listingId), escrow.paused(), nft.uri(entry.tokenId),
    nft.balanceOf(BASE.ESCROW, entry.tokenId), nft.royaltyInfo(entry.tokenId, 10000),
  ]);
  if (!same(listing.nftContract, BASE.DNFT) || listing.tokenId !== BigInt(entry.tokenId) || uri !== manifest.metadataURI) throw new Error('On-chain listing or metadata differs from prepared release');
  if (listing.priceETH !== 0n || !same(listing.priceToken, BASE.USDC) || listing.priceAmount !== BigInt(manifest.priceUSDC)) throw new Error('Listing price differs from prepared 10-USDC terms');
  if (!same(royalty[0], manifest.creatorAddress) || royalty[1] !== 1000n) throw new Error('Creator royalty differs from prepared release');
  if (balance < listing.available) throw new Error('Escrow stock does not cover the listing');
  const url = new URL(entry.purchaseUrl);
  if (url.protocol !== 'https:' || url.searchParams.get('chainId') !== '8453' || !same(url.searchParams.get('escrow'), BASE.ESCROW) || url.searchParams.get('listingId') !== entry.listingId) throw new Error('Purchase URL does not match verified listing');
  return { available: listing.available.toString(), purchasable: !paused && listing.active && listing.available > 0n, paused };
}
async function json(path) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
export async function showPublicReleases() {
  document.dispatchEvent(new CustomEvent('market:prepared-products', { detail: { products: [] } }));
  const provider = publicMarketProvider(ethers, 'https://mainnet.base.org');
  const nft = new ethers.Contract(BASE.DNFT, NFT_ABI, provider);
  const escrow = new ethers.Contract(BASE.ESCROW, ESCROW_ABI, provider);
  const products = [];
  try {
    const entries = await json('releases/listings.json');
    if (Number((await provider.getNetwork()).chainId) !== 8453) throw new Error('Public RPC returned the wrong chain');
    for (const entry of entries) {
      try {
        const [manifest, metadata] = await Promise.all([
          json(`releases/${entry.release}/supporter-release.json`), json(`releases/${entry.release}/supporter-metadata.json`),
        ]);
        validateMetadata(manifest, metadata);
        const result = await verifyPublicListing({ nft, escrow, entry, manifest });
        products.push({ tokenId: entry.tokenId, metadata, uri: manifest.metadataURI, blockNumber: Number(entry.tokenId),
          purchaseUrl: result.purchasable ? entry.purchaseUrl : null });
      } catch (error) {
        document.dispatchEvent(new CustomEvent('market:gallery-status', { detail: { error: `Release ${entry.release} could not be verified: ${error.message}` } }));
        console.error('[Market release]', error);
      }
    }
    document.dispatchEvent(new CustomEvent('market:prepared-products', { detail: { products } }));
  } catch (error) {
    document.dispatchEvent(new CustomEvent('market:gallery-status', { detail: { error: `Live listings unavailable: ${error.message}. Refresh in filters to retry.` } }));
    console.error('[Market listings]', error);
  } finally { provider.destroy(); }
}
