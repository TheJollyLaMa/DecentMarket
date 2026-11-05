import { BASE } from './supporter-mint.mjs';
export function parseMarketArrival(search) {
  const params = new URLSearchParams(search);
  if (!params.has('supporters')) return null;
  for (const key of ['supporters', 'chainId', 'nftContract', 'tokenId']) {
    if (params.getAll(key).length !== 1) throw new Error(`Exactly one ${key} is required for a Supporter Star link.`);
  }
  if (params.get('supporters') !== '1' || params.get('chainId') !== '8453'
    || params.get('nftContract')?.toLowerCase() !== BASE.DNFT.toLowerCase()
    || !/^(0|[1-9]\d*)$/.test(params.get('tokenId') || '') || BigInt(params.get('tokenId')) >= 2n ** 256n) {
    throw new Error('This Supporter Star link does not identify a supported Base edition.');
  }
  return { tokenId: params.get('tokenId'), nftContract: BASE.DNFT };
}
export function arrivalProduct(products, selection) {
  return products.find(product => product.tokenId === selection.tokenId
    && (product.nftContract || BASE.DNFT).toLowerCase() === selection.nftContract.toLowerCase()) || null;
}
