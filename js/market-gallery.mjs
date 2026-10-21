export function publicMarketProvider(ethers, rpcUrl) {
  const request = new ethers.FetchRequest(rpcUrl);
  request.timeout = 10000;
  return new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 10 });
}

export function resolveMarketAsset(uri) {
  if (typeof uri !== 'string' || !uri) return '';
  if (uri.startsWith('ipfs://')) {
    const path = uri.slice(7).replace(/^ipfs\//, '');
    if (!/^[a-zA-Z0-9]+(?:\/[^?#]*)?$/.test(path)) throw new Error('Invalid IPFS asset URI');
    const gateway = globalThis.DECENT_CONFIG?.providers?.gateway || 'https://gateway.pinata.cloud/ipfs/';
    return `${gateway.replace(/\/?$/, '/')}${path}`;
  }
  const url = new URL(uri);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported asset URL');
  return url.href;
}

export async function loadGalleryProducts(contract, { fetchJSON = async uri => {
  const response = await fetch(resolveMarketAsset(uri), { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
  return response.json();
}, onProgress = () => {}, concurrency = 4 } = {}) {
  const count = Number(await contract.nextTokenId());
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid token count');
  let cursor = count - 1;
  const products = [], errors = [];
  const sorted = () => [...products].sort((a, b) => b.blockNumber - a.blockNumber);
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, async () => {
    while (cursor >= 0) {
      const id = cursor--;
      try {
        if (Number(await contract.kindOf(id)) !== 0) continue;
        const [uri, cap, minted] = await Promise.all([contract.uri(id), contract.maxSupply(id), contract.totalMinted(id)]);
        let metadata;
        try {
          metadata = await fetchJSON(uri);
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid metadata object');
        } catch (error) {
          errors.push(`Token ${id} metadata unavailable: ${error.message}`);
          metadata = { name: `Token #${id} (metadata unavailable)`, description: `Metadata could not be loaded: ${error.message}`, image: '' };
        }
        products.push({ tokenId: String(id), maxSupply: String(cap), totalMinted: String(minted), uri, blockNumber: id, metadata });
        onProgress(sorted());
      } catch (error) {
        errors.push(`Token ${id} on-chain read failed: ${error.message}`);
      }
    }
  }));
  return { products: sorted(), errors };
}
