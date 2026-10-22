import { BASE } from './supporter-mint.mjs';
export const ADMIN = '0x807061DF657A7697c04045dA7d16D941861cAABc';
const KEY = 'decentmarket:moderation-preview:v1';
let published = { version: 1, hidden: [] }, preview = null, failure = '', ready = false;
export const isMarketAdmin = (state = globalThis.DecentHead?.getWallet().snapshot()) =>
  !!state?.connected && state.address?.toLowerCase() === ADMIN.toLowerCase() && BigInt(state.chainId || 0) === 8453n;
export const moderationKey = product => `8453:${(product.nftContract || BASE.DNFT).toLowerCase()}:${product.tokenId}`;
export function validateModeration(value) {
  if (value?.version !== 1 || !Array.isArray(value.hidden) || value.hidden.some(key => !/^8453:0x[a-f0-9]{40}:\d+$/.test(key)))
    throw new Error('Invalid Market moderation policy');
  return { version: 1, hidden: [...new Set(value.hidden)] };
}
export const moderationState = () => ({ policy: isMarketAdmin() && preview ? preview : published, preview: !!preview, failure, ready });
export function visibleMarketProducts(products) {
  if (!ready) return [];
  const hidden = new Set(moderationState().policy.hidden);
  return products.filter(product => !hidden.has(moderationKey(product)));
}
function notify() { document.dispatchEvent(new Event('market:moderation')); }
export async function loadModeration() {
  try {
    const response = await fetch('data/market-moderation.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Moderation policy HTTP ${response.status}`);
    published = validateModeration(await response.json());
    ready = true;
    const saved = localStorage.getItem(KEY);
    if (saved) preview = validateModeration(JSON.parse(saved));
  } catch (error) {
    failure = error.message;
    console.error('[Market moderation]', error);
    document.dispatchEvent(new CustomEvent('market:gallery-status', { detail: { error: `Display policy unavailable: ${failure}` } }));
  }
  notify();
}
export function previewHidden(key, hide) {
  if (!isMarketAdmin()) throw new Error('Connect the aABc admin wallet on Base');
  const next = new Set((preview || published).hidden);
  if (hide) next.add(key); else next.delete(key);
  const policy = validateModeration({ version: 1, hidden: [...next] });
  localStorage.setItem(KEY, JSON.stringify(policy));
  preview = policy;
  notify();
}
export function clearModerationPreview() {
  if (!isMarketAdmin()) throw new Error('Connect the aABc admin wallet on Base');
  localStorage.removeItem(KEY); preview = null; notify();
}
if (typeof window !== 'undefined') window.addEventListener('decenthead:wallet', notify);
