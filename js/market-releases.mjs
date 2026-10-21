import { BASE, NFT_ABI, ESCROW_ABI, ethers, validateRelease, validateMetadata } from './supporter-mint.mjs';
import { publicMarketProvider, resolveMarketAsset } from './market-gallery.mjs';
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
  const container = document.getElementById('supporter-listing-cards');
  const provider = publicMarketProvider(ethers, 'https://mainnet.base.org');
  const nft = new ethers.Contract(BASE.DNFT, NFT_ABI, provider);
  const escrow = new ethers.Contract(BASE.ESCROW, ESCROW_ABI, provider);
  const products = [];
  try {
    const entries = await json('releases/listings.json');
    if (Number((await provider.getNetwork()).chainId) !== 8453) throw new Error('Public RPC returned the wrong chain');
    container.replaceChildren();
    for (const entry of entries) {
      const article = document.createElement('article');
      container.append(article);
      try {
        const [manifest, metadata] = await Promise.all([
          json(`releases/${entry.release}/supporter-release.json`), json(`releases/${entry.release}/supporter-metadata.json`),
        ]);
        validateMetadata(manifest, metadata);
        const result = await verifyPublicListing({ nft, escrow, entry, manifest });
        const img = document.createElement('img'); img.src = resolveMarketAsset(metadata.image); img.alt = `${metadata.name} front`;
        const details = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = metadata.name;
        const terms = document.createElement('p'); terms.textContent = `10 USDC · ${result.available} available · Base · Token ${entry.tokenId} / Listing ${entry.listingId}`;
        const flip = document.createElement('button'); flip.textContent = 'View back'; let back = false;
        flip.onclick = () => { back = !back; img.src = resolveMarketAsset(back ? metadata.properties.back_image : metadata.image); img.alt = `${metadata.name} ${back ? 'back' : 'front'}`; flip.textContent = back ? 'View front' : 'View back'; };
        const note = document.createElement('p'); note.textContent = 'Live listing checked on Base. Edition provenance is from the bundled official release. Stock is rechecked on the purchase page.';
        details.append(title, terms, flip);
        if (result.purchasable) {
          const link = document.createElement('a'); link.href = entry.purchaseUrl; link.textContent = 'Review / buy edition'; link.target = '_blank'; link.rel = 'noopener noreferrer';
          details.append(document.createElement('br'), link);
        } else {
          const inactive = document.createElement('p'); inactive.textContent = result.paused ? 'Escrow paused — purchasing unavailable.' : 'Not currently for sale.';
          details.append(inactive);
        }
        details.append(note); article.append(img, details);
        img.onerror = () => { img.alt = 'Artwork gateway unavailable. Open the official release to review.'; };
        products.push({ tokenId: entry.tokenId, metadata, uri: manifest.metadataURI, blockNumber: Number(entry.tokenId),
          purchaseUrl: result.purchasable ? entry.purchaseUrl : null });
      } catch (error) { article.textContent = `Release ${entry.release} could not be verified: ${error.message}`; console.error('[Market release]', error); }
    }
    if (!entries.length) container.textContent = 'No prepared releases published yet.';
    document.dispatchEvent(new CustomEvent('gallery:products-loaded', { detail: { products } }));
  } catch (error) {
    container.textContent = `Live listings unavailable: ${error.message}. Reload to retry.`;
    console.error('[Market listings]', error);
  } finally { provider.destroy(); }
}
