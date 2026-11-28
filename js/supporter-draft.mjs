// Local, browser-only Supporter Studio drafts. No wallet, upload, contract, ENS or Discord access.
export const DRAFT_STORE_KEY = 'decent-market:supporter-studio:drafts';
export const DRAFT_STORE_SCHEMA = 'decent-market.supporter-studio.drafts';
export const DRAFT_VERSION = 1;
export const MAX_DRAFTS = 20;
export const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
export const PRICES_USDC = ['10', '100'];
export const MAX_ROYALTY_BPS = 1000;
export const LOCAL_SCOPE = Object.freeze({ kind: 'browser-local', account: null, chainId: 8453 });
export const FIELDS = ['name', 'description', 'image', 'backImage', 'externalUrl', 'editionSize', 'priceUSDC', 'royaltyBps', 'payoutAddress'];
const REQUIRED = ['name', 'description', 'image', 'editionSize', 'priceUSDC', 'royaltyBps'];
const LIMITS = { name: 100, description: 1000, image: 500, backImage: 500, externalUrl: 500, payoutAddress: 42 };
export const DEFAULT_TERMS = Object.freeze({ editionSize: '1000', priceUSDC: '10', royaltyBps: '500' });
const PROVENANCE_KINDS = ['source', 'default', 'edited', 'unknown'];
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})(\/[^?#\s]*)?$/;

const text = value => typeof value === 'string' ? value.trim() : '';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const editionCount = value => {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value.trim())) return null;
  const count = Number(value.trim());
  return Number.isSafeInteger(count) ? count : null;
};

/** Preview the optional gift for this mint, not the series' maximum supply. */
export function editionGiftPreview(value) {
  const amount = editionCount(value);
  if (amount === null) return null;
  const gifted = Math.floor(amount / 10);
  return { amount, gifted, kept: amount - gifted };
}

export function isArtworkUri(value) {
  if (value.startsWith('ipfs://')) return CID.test(value.slice(7).replace(/^ipfs\//, ''));
  return isHttpsUrl(value);
}
export function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

export function sameScope(a, b) {
  return isObject(a) && isObject(b) && a.kind === b.kind && a.chainId === b.chainId
    && String(a.account ?? '').toLowerCase() === String(b.account ?? '').toLowerCase();
}

export function blankFields() {
  return Object.fromEntries(FIELDS.map(field => [field, '']));
}

/** Validate draft fields. `errors` block saving; `missing` are honest gaps shown as Unknown. */
export function validateFields(fields) {
  const errors = {}, missing = [];
  if (!isObject(fields)) return { errors: { form: 'Draft fields are missing' }, missing: [...REQUIRED] };
  for (const field of FIELDS) {
    const value = fields[field];
    if (value !== undefined && typeof value !== 'string') errors[field] = 'Must be text';
    else if (LIMITS[field] && text(value).length > LIMITS[field]) errors[field] = `Keep this under ${LIMITS[field]} characters`;
  }
  const get = field => typeof fields[field] === 'string' ? fields[field].trim() : '';
  for (const field of REQUIRED) if (!get(field) && !errors[field]) missing.push(field);
  if (!errors.name && get('name') && get('name').length < 3) errors.name = 'Use at least 3 characters';
  for (const field of ['image', 'backImage'])
    if (!errors[field] && get(field) && !isArtworkUri(get(field))) errors[field] = 'Use an https:// link or an ipfs://CID you already have';
  if (!errors.externalUrl && get('externalUrl') && !isHttpsUrl(get('externalUrl'))) errors.externalUrl = 'Use a full https:// link';
  if (!errors.editionSize && get('editionSize') && editionCount(get('editionSize')) === null)
    errors.editionSize = 'Enter a positive whole number of editions';
  if (!errors.priceUSDC && get('priceUSDC') && !PRICES_USDC.includes(get('priceUSDC'))) errors.priceUSDC = 'Choose 10 or 100 USDC';
  if (!errors.royaltyBps && get('royaltyBps')) {
    const bps = get('royaltyBps');
    if (!/^(0|[1-9]\d*)$/.test(bps) || Number(bps) > MAX_ROYALTY_BPS || Number(bps) % 50) errors.royaltyBps = 'Choose 0% to 10% in half-percent steps';
  }
  if (!errors.payoutAddress && get('payoutAddress')) {
    const address = get('payoutAddress');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) errors.payoutAddress = 'Use a 0x… address with 40 hexadecimal characters, or leave it empty';
    else if (/^0x0{40}$/.test(address)) errors.payoutAddress = 'The zero address cannot receive sales';
  }
  return { errors, missing };
}

function validProvenance(provenance) {
  return isObject(provenance) && Object.entries(provenance).every(([field, entry]) => FIELDS.includes(field)
    && isObject(entry) && PROVENANCE_KINDS.includes(entry.kind) && (entry.label === undefined || typeof entry.label === 'string'));
}

/** Throws with a readable message if a stored draft is not a valid v1 draft. */
export function validateDraft(draft) {
  const fail = message => { throw new Error(message); };
  if (!isObject(draft)) fail('Draft is not an object');
  if (draft.version !== DRAFT_VERSION) fail(`Unsupported draft version ${draft.version}`);
  if (typeof draft.id !== 'string' || !/^[\w-]{6,64}$/.test(draft.id)) fail('Draft id is invalid');
  if (typeof draft.projectId !== 'string' || !/^(new|release:[\w.-]{1,80})$/.test(draft.projectId)) fail('Draft project is invalid');
  if (typeof draft.projectLabel !== 'string' || draft.projectLabel.length > 120) fail('Draft project label is invalid');
  if (!isTime(draft.createdAt) || !isTime(draft.updatedAt)) fail('Draft dates are invalid');
  if (!isObject(draft.scope) || typeof draft.scope.kind !== 'string' || !Number.isInteger(draft.scope.chainId)) fail('Draft scope is invalid');
  if (!isObject(draft.fields) || Object.keys(draft.fields).some(field => !FIELDS.includes(field))) fail('Draft fields are invalid');
  const { errors } = validateFields(draft.fields);
  if (Object.keys(errors).length) fail(`Draft field ${Object.keys(errors)[0]}: ${Object.values(errors)[0]}`);
  if (!validProvenance(draft.provenance)) fail('Draft provenance is invalid');
  return draft;
}

export function createDraft({ project, fields, provenance, scope = LOCAL_SCOPE, now = new Date(), id }) {
  const timestamp = now.toISOString();
  const draft = {
    version: DRAFT_VERSION,
    id: id || `draft-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: project.id, projectLabel: project.label,
    scope: { ...scope }, createdAt: timestamp, updatedAt: timestamp,
    fields: Object.fromEntries(FIELDS.map(field => [field, text(fields?.[field])])),
    provenance: structuredClone(provenance || {}),
  };
  return validateDraft(draft);
}

export function emptyStore() {
  return { schema: DRAFT_STORE_SCHEMA, version: DRAFT_VERSION, drafts: [] };
}

/**
 * Parse stored drafts without losing data. Invalid individual drafts are kept in `rejected`
 * and written back unchanged; an unreadable or newer store is read-only.
 */
export function parseDraftStore(raw) {
  if (raw === null || raw === undefined || raw === '') return { store: emptyStore(), drafts: [], rejected: [], writable: true, problem: '' };
  let value;
  try { value = JSON.parse(raw); } catch {
    return { store: null, drafts: [], rejected: [], writable: false, problem: 'Saved drafts in this browser could not be read. They were left untouched.' };
  }
  if (!isObject(value) || value.schema !== DRAFT_STORE_SCHEMA || !Array.isArray(value.drafts))
    return { store: null, drafts: [], rejected: [], writable: false, problem: 'Saved drafts use an unknown format. They were left untouched.' };
  if (!Number.isInteger(value.version) || value.version > DRAFT_VERSION)
    return { store: null, drafts: [], rejected: [], writable: false, problem: 'Saved drafts come from a newer Supporter Studio. Open them there; nothing was changed here.' };
  const migrated = migrateStore(value);
  const drafts = [], rejected = [];
  for (const draft of migrated.drafts) {
    try { drafts.push(validateDraft(draft)); } catch (error) { rejected.push({ draft, reason: error.message }); }
  }
  return { store: { ...migrated, drafts }, drafts, rejected, writable: true,
    problem: rejected.length ? `${rejected.length} saved draft(s) failed validation and are hidden. They were kept unchanged.` : '' };
}

// Version 1 is the first published format. Future versions upgrade older stores here, one step at a time.
export function migrateStore(store) {
  if (store.version === DRAFT_VERSION) return store;
  throw new Error(`No migration from draft store version ${store.version}`);
}

export function serializeDraftStore(parsed) {
  if (!parsed.writable) throw new Error('Saved drafts are read-only here; nothing was overwritten');
  return JSON.stringify({ schema: DRAFT_STORE_SCHEMA, version: DRAFT_VERSION,
    drafts: [...parsed.drafts, ...parsed.rejected.map(entry => entry.draft)] });
}

export function draftsForScope(parsed, scope = LOCAL_SCOPE) {
  return parsed.drafts.filter(draft => sameScope(draft.scope, scope))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function upsertDraft(parsed, draft, now = new Date()) {
  if (!parsed.writable) throw new Error('Saved drafts are read-only here; nothing was overwritten');
  const existing = parsed.drafts.find(item => item.id === draft.id);
  if (existing && !sameScope(existing.scope, draft.scope)) throw new Error('This draft belongs to a different account or network and was not changed');
  const next = validateDraft({ ...draft, createdAt: existing?.createdAt || draft.createdAt, updatedAt: now.toISOString() });
  const drafts = existing ? parsed.drafts.map(item => item.id === draft.id ? next : item) : [...parsed.drafts, next];
  if (drafts.length + parsed.rejected.length > MAX_DRAFTS) throw new Error(`This browser keeps up to ${MAX_DRAFTS} drafts. Delete one first.`);
  return { ...parsed, drafts, store: { ...parsed.store, drafts } };
}

export function removeDraft(parsed, id, scope = LOCAL_SCOPE) {
  if (!parsed.writable) throw new Error('Saved drafts are read-only here; nothing was deleted');
  const target = parsed.drafts.find(item => item.id === id);
  if (!target) throw new Error('That draft no longer exists');
  if (!sameScope(target.scope, scope)) throw new Error('This draft belongs to a different account or network and was not deleted');
  const drafts = parsed.drafts.filter(item => item.id !== id);
  return { ...parsed, drafts, store: { ...parsed.store, drafts } };
}

export function isStale(draft, now = new Date()) {
  return now.getTime() - Date.parse(draft.updatedAt) > STALE_AFTER_MS;
}

export function loadDrafts(storage) {
  return parseDraftStore(storage.getItem(DRAFT_STORE_KEY));
}
export function saveDrafts(storage, parsed) {
  storage.setItem(DRAFT_STORE_KEY, serializeDraftStore(parsed));
  return parsed;
}

/** Turn existing Market release metadata into editable, source-labelled project defaults. */
export function projectFromReleaseMetadata(slug, metadata, sourceLabel) {
  if (!/^[\w.-]{1,80}$/.test(slug) || !isObject(metadata) || typeof metadata.name !== 'string')
    throw new Error('Release metadata is missing a name');
  const p = isObject(metadata.properties) ? metadata.properties : {};
  const label = metadata.name.replace(/\s+Supporter DNFT$/i, '').trim().slice(0, 120) || slug;
  const fields = blankFields(), provenance = {};
  const take = (field, value, ok = true) => {
    if (typeof value === 'string' && value.trim() && ok) { fields[field] = value.trim(); provenance[field] = { kind: 'source', label: sourceLabel }; }
    else provenance[field] = { kind: 'unknown' };
  };
  take('name', metadata.name);
  take('description', metadata.description);
  take('image', metadata.image, typeof metadata.image === 'string' && isArtworkUri(metadata.image));
  take('backImage', p.back_image, typeof p.back_image === 'string' && isArtworkUri(p.back_image));
  take('externalUrl', metadata.external_url, typeof metadata.external_url === 'string' && isHttpsUrl(metadata.external_url));
  take('editionSize', String(p.supply ?? ''), editionCount(String(p.supply ?? '')) !== null);
  const price = /^(\d+) USDC$/.exec(String(p.price ?? ''))?.[1];
  take('priceUSDC', price, PRICES_USDC.includes(price));
  take('royaltyBps', String(p.royalty_bps ?? ''), Number.isInteger(p.royalty_bps) && p.royalty_bps >= 0 && p.royalty_bps <= MAX_ROYALTY_BPS && p.royalty_bps % 50 === 0);
  // A release's creator address is not proof that this person controls it, so it is never prefilled as a payout.
  provenance.payoutAddress = { kind: 'unknown', label: 'Not prefilled' };
  return { id: `release:${slug}`, label, source: sourceLabel, fields, provenance };
}

export function newProject() {
  const fields = { ...blankFields(), ...DEFAULT_TERMS }, provenance = {};
  for (const field of FIELDS) provenance[field] = field in DEFAULT_TERMS ? { kind: 'default', label: 'Current supported term' } : { kind: 'unknown' };
  return { id: 'new', label: 'New project', source: 'New project', fields, provenance };
}

export function markEdited(provenance, field, fields, original) {
  const next = { ...provenance };
  if ((fields[field] || '') === (original?.fields?.[field] || '')) next[field] = original?.provenance?.[field] || { kind: 'unknown' };
  else next[field] = fields[field] ? { kind: 'edited', label: 'Edited by you' } : { kind: 'unknown' };
  return next;
}

/** Preview metadata in the same shape as published Supporter metadata; never invents CIDs, tokens or addresses. */
export function previewMetadata(fields) {
  const metadata = {
    name: text(fields.name) || 'Untitled Supporter edition',
    description: text(fields.description),
    external_url: isHttpsUrl(text(fields.externalUrl)) ? text(fields.externalUrl) : undefined,
    image: isArtworkUri(text(fields.image)) ? text(fields.image) : undefined,
    attributes: [], properties: { chain: 'Base' },
  };
  if (isArtworkUri(text(fields.backImage))) metadata.properties.back_image = text(fields.backImage);
  const add = (trait, value) => { metadata.attributes.push({ trait_type: trait, value }); };
  const supply = editionCount(fields.editionSize);
  if (supply !== null) { metadata.properties.supply = supply; add('supply', supply); }
  if (PRICES_USDC.includes(fields.priceUSDC)) { metadata.properties.price = `${fields.priceUSDC} USDC`; add('price', `${fields.priceUSDC} USDC`); }
  add('chain', 'Base');
  if (/^\d+$/.test(fields.royaltyBps || '')) { metadata.properties.royalty_bps = Number(fields.royaltyBps); add('royalty_bps', Number(fields.royaltyBps)); }
  add('status', 'Draft preview · not minted or listed');
  return metadata;
}

export function termsSummary(fields) {
  const count = editionCount(fields.editionSize);
  const edition = count === null ? null : count.toLocaleString('en-US');
  const price = PRICES_USDC.includes(fields.priceUSDC) ? `${fields.priceUSDC} USDC` : null;
  const royalty = /^\d+$/.test(fields.royaltyBps || '') ? `${Number(fields.royaltyBps) / 100}%` : null;
  const payout = /^0x[0-9a-fA-F]{40}$/.test(fields.payoutAddress || '') ? fields.payoutAddress : null;
  return [
    { term: 'Edition', value: edition ? `${edition} editions` : 'Unknown — choose an edition size', known: !!edition },
    { term: 'Price', value: price ? `${price} each. Buyers also pay Base network gas.` : 'Unknown — choose a price', known: !!price },
    { term: 'Network', value: 'Base (chain 8453)', known: true },
    { term: 'Sales proceeds', value: payout ? `${payout} is a note only, not a payout instruction. The planned Market flow pays the seller wallet.`
      : 'The planned Market flow pays the seller wallet. No wallet is connected in this preview.', known: false },
    { term: 'Resale royalty', value: royalty ? `${royalty} for the creator wallet. The planned Market flow enforces it; other marketplaces may not honour it.` : 'Unknown — choose a royalty', known: !!royalty },
    { term: 'Market fees', value: 'Planned: creator sales have an Agency fee; on resale, the Agency fee and creator royalty total at most 10%. If they exceed that cap, resale is blocked. Rates are not connected in this preview.', known: false },
    { term: 'What supporters get', value: 'A collectible that shows support. It is not an investment, a share, a treasury claim, a redemption right, yield or a promise of resale value.', known: true },
    { term: 'Status', value: 'Local draft only. Not uploaded, minted, listed or announced. Those steps need a later authorized flow.', known: true },
  ];
}
