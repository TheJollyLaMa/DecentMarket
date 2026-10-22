import { BASE } from './supporter-mint.mjs';
import { collectibleFaces, resolveCollectibleAsset } from './supporter-display.mjs';
import { element, externalLink, openMarketDialog } from './market-dialog.mjs';
import { listingPrices, purchaseMarketListing } from './market-listings.mjs';
import { visibleMarketProducts } from './market-moderation.mjs';

const addLink = (root, label, url) => { const link = externalLink(label, url); if (link) root.append(link); };
export function openCollectibleCard(product) {
  const { metadata = {}, tokenId, nftContract = BASE.DNFT, listings = [] } = product;
  const { dialog, body } = openMarketDialog('nft-detail-modal', metadata.name || `DNFT #${tokenId ?? '?'}`);
  body.classList.add('market-collectible-card');
  const artwork = element('div', undefined, 'market-card-art');
  const faces = collectibleFaces(metadata);
  if (faces.front) {
    const image = element('img'); image.src = faces.front; image.alt = metadata.name || 'DNFT artwork';
    image.onerror = () => artwork.replaceChildren(element('p', 'Artwork unavailable. Metadata and contract links remain below.'));
    artwork.append(image);
    if (faces.back) {
      const flip = element('button', 'View back'); let back = false;
      flip.onclick = () => {
        back = !back; image.src = back ? faces.back : faces.front;
        flip.textContent = back ? 'View front' : 'View back';
        artwork.classList.remove('market-card-flip'); void artwork.offsetWidth; artwork.classList.add('market-card-flip');
      };
      artwork.append(flip);
    }
  } else artwork.append(element('p', '✦ Artwork not available ✦'));
  const info = element('section');
  info.append(element('p', metadata.description || 'A Decent digital keepsake.'));
  if (tokenId !== undefined) info.append(element('p', `Base · DNFT #${tokenId}`, 'market-token-label'));
  const offers = element('section', undefined, 'market-offers');
  if (!listings.length) offers.append(element('p', 'Not verified for sale in this Base escrow. A metadata price alone is not an active listing.'));
  let busy = false;
  const status = element('p'); status.setAttribute('role', 'status');
  for (const listing of listings) {
    offers.append(element('h3', `Listing #${listing.id} · ${listing.available} editions`));
    offers.append(element('p', listing.status));
    for (const price of listingPrices(listing)) {
      const button = element('button', `Buy one · ${price.label}`);
      button.disabled = !listing.purchasable;
      button.onclick = async () => {
        if (busy) return;
        busy = true;
        offers.querySelectorAll('button').forEach(button => { button.disabled = true; });
        dialog.addEventListener('cancel', preventClose);
        try {
          const hash = await purchaseMarketListing(listing, price.method, message => { status.textContent = message; });
          status.textContent = 'Edition purchased and confirmed. Welcome to its story. ';
          addLink(status, 'View your receipt ↗', `https://basescan.org/tx/${hash}`);
          document.dispatchEvent(new Event('market:refresh-listings'));
        } catch (error) {
          console.error('[Market purchase]', error);
          status.textContent = `${error.shortMessage || error.message} Check wallet activity before trying again. Close and reopen a refreshed listing to retry.`;
        } finally {
          busy = false; dialog.removeEventListener('cancel', preventClose);
        }
      };
      offers.append(button);
    }
  }
  const preventClose = event => { event.preventDefault(); };
  dialog.querySelector('header button').addEventListener('click', event => {
    if (busy) { event.stopImmediatePropagation(); status.textContent = 'Purchase is in progress. Check your wallet; do not submit again.'; }
  }, { capture: true });
  dialog.addEventListener('click', event => { if (busy && event.target === dialog) event.stopImmediatePropagation(); }, { capture: true });
  offers.append(status);
  info.append(offers);
  const provenance = element('nav'); provenance.setAttribute('aria-label', 'Collectible provenance and links');
  if (tokenId !== undefined && /^0x[a-fA-F0-9]{40}$/.test(nftContract)) {
    addLink(provenance, 'Purchases / transfers on Base ↗', `https://basescan.org/token/${nftContract}?a=${tokenId}`);
    addLink(provenance, 'Escrow contract / purchase events ↗', `https://basescan.org/address/${BASE.ESCROW}#events`);
  }
  const properties = metadata.properties || {}, source = properties.product || {};
  addLink(provenance, 'Release / project ↗', metadata.external_url);
  addLink(provenance, 'Source repository ↗', source.repo_url);
  addLink(provenance, 'Versioned commit ↗', source.commit);
  if (source.artifact_cid) addLink(provenance, 'Source archive on IPFS ↗', resolveCollectibleAsset(source.artifact_cid));
  const parent = metadata.parentTokenId ?? properties.parentTokenId;
  if (/^\d+$/.test(String(parent))) addLink(provenance, `Parent DNFT #${parent} ↗`, `https://basescan.org/token/${nftContract}?a=${parent}`);
  info.append(provenance);
  const attributes = element('details'); attributes.append(element('summary', 'Edition details'));
  const dl = element('dl');
  for (const trait of Array.isArray(metadata.attributes) ? metadata.attributes : []) {
    if (trait && typeof trait.trait_type === 'string' && ['string', 'number', 'boolean'].includes(typeof trait.value))
      dl.append(element('dt', trait.trait_type), element('dd', String(trait.value)));
  }
  attributes.append(dl); info.append(attributes);
  body.append(artwork, info);
  return dialog;
}

export function openMarketCatalog(products) {
  const { dialog, body } = openMarketDialog('market-catalog', 'Base marketplace');
  body.append(element('p', 'Live funded escrow listings. Review a collectible and its exact price before signing. Refresh to check new stock.'));
  const refresh = element('button', 'Refresh listings');
  refresh.onclick = () => document.dispatchEvent(new Event('market:refresh-listings'));
  body.append(refresh);
  const treasury = element('button', 'Public treasury / subscriptions');
  treasury.onclick = () => { dialog.close(); void document.querySelector('decent-right-toolbar')._openEscrowPanel(); };
  body.append(treasury);
  const rows = element('div', undefined, 'market-catalog-items');
  const render = items => {
    rows.replaceChildren();
    for (const product of items) {
      const button = element('button');
      button.append(element('strong', product.metadata?.name || `DNFT #${product.tokenId}`));
      for (const listing of product.listings || []) button.append(element('span',
        `${listingPrices(listing).map(p => p.label).join(' or ')} · ${listing.available} editions · ${listing.status}`));
      button.onclick = () => openCollectibleCard(product);
      rows.append(button);
    }
    if (!items.length) rows.append(element('p', 'No verified listings loaded. Check the status in the filter panel and refresh to retry.'));
  };
  let currentProducts = products;
  const moderated = () => render(visibleMarketProducts(currentProducts));
  moderated();
  const update = event => { currentProducts = event.detail.products; moderated(); };
  document.addEventListener('market:listed-products', update);
  document.addEventListener('market:moderation', moderated);
  document.getElementById('market-catalog').addEventListener('close', () => {
    document.removeEventListener('market:listed-products', update);
    document.removeEventListener('market:moderation', moderated);
  }, { once: true });
  body.append(rows);
}
