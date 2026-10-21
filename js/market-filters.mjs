export const defaultFilters = { category: 'all', search: '' };
export function dnftCategory(metadata = {}) {
  if (metadata.audioUrl || metadata.videoUrl || /^(audio|video)\//.test(metadata.mediaType || '')) return 'music';
  if (metadata.properties?.back_image && metadata.properties?.repo && metadata.properties?.price === '10 USDC') return 'supporter';
  if (Array.isArray(metadata.attributes) && metadata.attributes.some(a => a.trait_type === 'Kind' && /supporter/i.test(String(a.value)))) return 'supporter';
  if (metadata.animation_url && (metadata.artist || metadata.creator) && !metadata.properties?.product && !metadata.properties?.repo) return 'music';
  return 'regular';
}
export function filterDnfts(products, filters = defaultFilters) {
  const query = filters.search.trim().toLowerCase();
  return products.filter(product => {
    const metadata = product.metadata || {};
    if (filters.category !== 'all' && dnftCategory(metadata) !== filters.category) return false;
    const text = [product.tokenId, metadata.name, metadata.description, metadata.artist, metadata.creator, metadata.properties?.repo, metadata.properties?.version].filter(Boolean).join(' ').toLowerCase();
    return !query || text.includes(query);
  });
}
