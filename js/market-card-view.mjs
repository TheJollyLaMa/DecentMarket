import { collectibleFaces } from './supporter-display.mjs';
import { element } from './market-dialog.mjs';

// Shared by live Market cards and Supporter Studio previews so both render identically.
export function collectibleArtwork(metadata = {}) {
  const artwork = element('div', undefined, 'market-card-art');
  const faces = collectibleFaces(metadata);
  if (faces.front) {
    const image = element('img'); image.src = faces.front; image.alt = metadata.name || 'DNFT artwork';
    image.onerror = () => artwork.replaceChildren(element('p', 'Artwork unavailable. Metadata and contract links remain below.'));
    artwork.append(image);
    if (faces.back) {
      const flip = element('button', 'View back'); let back = false;
      flip.type = 'button';
      flip.onclick = () => {
        back = !back; image.src = back ? faces.back : faces.front;
        flip.textContent = back ? 'View front' : 'View back';
        artwork.classList.remove('market-card-flip'); void artwork.offsetWidth; artwork.classList.add('market-card-flip');
      };
      artwork.append(flip);
    }
  } else artwork.append(element('p', '✦ Artwork not available ✦'));
  return artwork;
}

export function collectibleEditionDetails(metadata = {}) {
  const attributes = element('details'); attributes.append(element('summary', 'Edition details'));
  const dl = element('dl');
  for (const trait of Array.isArray(metadata.attributes) ? metadata.attributes : []) {
    if (trait && typeof trait.trait_type === 'string' && ['string', 'number', 'boolean'].includes(typeof trait.value))
      dl.append(element('dt', trait.trait_type), element('dd', String(trait.value)));
  }
  attributes.append(dl);
  return attributes;
}
