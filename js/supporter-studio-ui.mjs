import {
  FIELDS, LOCAL_SCOPE, MAX_ROYALTY_BPS, createDraft, draftsForScope, editionGiftPreview, isStale, loadDrafts, markEdited,
  newProject, previewMetadata, projectFromReleaseMetadata, removeDraft, saveDrafts, termsSummary, upsertDraft, validateFields,
} from './supporter-draft.mjs';
import { collectibleArtwork, collectibleEditionDetails } from './market-card-view.mjs';
import { element, externalLink } from './market-dialog.mjs';

// Published Market releases whose public metadata can seed a draft. Read-only, same-origin files.
export const RELEASE_SOURCES = ['decentmarket-v0.3.1', 'decenthead-v2.0.0', 'decentvoyager-v1.0.0'];
const PROVENANCE_TEXT = { source: 'from source', default: 'default', edited: 'edited', unknown: 'unknown' };
const FIELD_LABELS = { name: 'Edition name', description: 'Description', image: 'Front artwork', backImage: 'Back artwork',
  externalUrl: 'Project page', editionSize: 'Edition size', priceUSDC: 'Price', royaltyBps: 'Resale royalty', payoutAddress: 'Payout address' };

export function mountDraftStudio(root, { storage = globalThis.localStorage, fetchImpl = globalThis.fetch.bind(globalThis), base = new URL('../', import.meta.url) } = {}) {
  const $ = id => root.querySelector(`#${id}`);
  const form = $('studio-form');
  const projects = new Map();
  let project = null, original = null, fields = null, provenance = null, draftId = null, dirty = false;
  let touched = new Set(), frame = 0, storageReady = true;

  const status = (message, error = false) => { $('status').textContent = message; $('status').dataset.error = String(error); };
  const resetGiftChoice = () => { $('gift-preview-result').textContent = 'Preview only. No gift choice has been made.'; };

  const royalty = $('f-royaltyBps');
  royalty.append(element('option', 'Choose…'));
  royalty.firstChild.value = '';
  for (let bps = 0; bps <= MAX_ROYALTY_BPS; bps += 50) {
    const option = element('option', `${bps / 100}%`); option.value = String(bps); royalty.append(option);
  }
  for (const field of FIELDS) {
    const wrapper = form.querySelector(`[data-field="${field}"]`);
    const source = element('span', '', 'visually-hidden'); source.id = `f-${field}-source`;
    const error = element('span', '', 'field-error'); error.id = `f-${field}-error`;
    wrapper.append(source, error);
  }

  function readStore() {
    try { return loadDrafts(storage); } catch (error) {
      storageReady = false;
      return { drafts: [], rejected: [], writable: false, problem: `This browser blocks local storage (${error.message}). Drafts cannot be saved here.` };
    }
  }

  function renderProvenance() {
    for (const field of FIELDS) {
      const entry = provenance?.[field] || { kind: 'unknown' };
      const badge = form.querySelector(`[data-field="${field}"] label .badge`);
      badge.dataset.kind = entry.kind;
      badge.textContent = PROVENANCE_TEXT[entry.kind];
      $(`f-${field}-source`).textContent = `Value ${PROVENANCE_TEXT[entry.kind]}${entry.label ? `: ${entry.label}` : ''}.`;
      badge.title = entry.label || PROVENANCE_TEXT[entry.kind];
    }
  }

  function renderErrors(showAll = false) {
    const { errors, missing } = validateFields(fields);
    for (const field of FIELDS) {
      const input = $(`f-${field}`), message = (showAll || touched.has(field)) ? errors[field] || '' : '';
      $(`f-${field}-error`).textContent = message;
      if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }
    return { errors, missing };
  }

  function cardPreview(metadata) {
    const card = element('article', undefined, 'market-dialog studio-preview');
    const header = element('header'); header.append(element('h4', metadata.name, 'studio-preview-title'));
    const body = element('div', undefined, 'market-dialog-body market-collectible-card');
    const info = element('section');
    info.append(element('p', metadata.description || 'A Decent digital keepsake.'));
    info.append(element('p', 'Base · DNFT # not minted yet (preview)', 'market-token-label'));
    const offers = element('section', undefined, 'market-offers');
    const supply = metadata.properties.supply ?? '?', price = metadata.properties.price;
    offers.append(element('h5', `Listing preview · ${supply} editions`));
    offers.append(element('p', 'Preview only — not minted or listed. Minting and listing wait on #47 and #84.'));
    const buy = element('button', `Buy one · ${price || 'price unknown'}`); buy.type = 'button'; buy.disabled = true;
    offers.append(buy);
    info.append(offers);
    const links = element('nav'); links.setAttribute('aria-label', 'Preview project links');
    const link = externalLink('Release / project ↗', metadata.external_url);
    if (link) links.append(link);
    info.append(links, collectibleEditionDetails(metadata));
    body.append(collectibleArtwork(metadata), info);
    card.append(header, body);
    return card;
  }

  function listingPreview(metadata) {
    const wrapper = element('div', undefined, 'market-dialog studio-preview');
    const rows = element('div', undefined, 'market-catalog-items');
    const row = element('div', undefined, 'studio-listing-row');
    row.append(element('strong', metadata.name),
      element('span', `${metadata.properties.price || 'Price unknown'} · ${metadata.properties.supply ?? '?'} editions · Preview only — not listed`));
    rows.append(row); wrapper.append(rows);
    return wrapper;
  }

  function renderPreviews() {
    frame = 0;
    if (!fields) return;
    const metadata = previewMetadata(fields);
    $('card-preview').replaceChildren(cardPreview(metadata));
    $('listing-preview').replaceChildren(listingPreview(metadata));
    const terms = termsSummary(fields);
    $('terms-preview').replaceChildren(...terms.flatMap(({ term, value, known }) => {
      const dd = element('dd', value); if (!known) dd.dataset.known = 'false';
      return [element('dt', term), dd];
    }));
    const { missing } = validateFields(fields);
    const gaps = missing.map(field => FIELD_LABELS[field]);
    $('dirty-state').textContent = `${dirty ? 'Unsaved changes.' : draftId ? 'All changes saved.' : 'Not saved yet.'}${gaps.length ? ` Still unknown: ${gaps.join(', ')}.` : ''}`;
    $('gift-preview-open').disabled = !editionGiftPreview(fields.editionSize);
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(renderPreviews); };

  function fillForm() {
    for (const field of FIELDS) $(`f-${field}`).value = fields[field] || '';
    $('studio-project-label').textContent = `Project: ${project.label} · ${project.source}${draftId ? ' · saved draft' : ' · new draft'}`;
    form.hidden = false; $('previews').hidden = false;
    renderProvenance(); renderErrors(); renderPreviews();
  }

  function confirmDiscard() {
    return !dirty || globalThis.confirm('Discard unsaved changes to this draft?');
  }

  function begin(nextProject, saved) {
    project = nextProject;
    draftId = saved?.id || null;
    fields = { ...(saved?.fields || nextProject.fields) };
    provenance = structuredClone(saved?.provenance || nextProject.provenance);
    original = { fields: { ...fields }, provenance: structuredClone(provenance) };
    dirty = false; touched = new Set();
    resetGiftChoice();
    fillForm();
    $('studio-form-heading').focus();
  }

  function renderDrafts() {
    const parsed = readStore();
    const list = $('draft-list');
    const drafts = parsed.writable || parsed.drafts.length ? draftsForScope(parsed, LOCAL_SCOPE) : [];
    list.replaceChildren(...drafts.map(draft => {
      const li = element('li');
      const title = element('strong', draft.fields.name || 'Untitled draft');
      const meta = element('span', `${draft.projectLabel} · saved ${new Date(draft.updatedAt).toLocaleString()}`, 'help');
      li.append(title, meta);
      if (isStale(draft)) li.append(element('span', 'Stale: last edited over 90 days ago. Recheck source values before using it.', 'badge stale'));
      const open = element('button', 'Open'); open.type = 'button';
      open.setAttribute('aria-label', `Open draft ${draft.fields.name || 'Untitled draft'}`);
      open.onclick = () => {
        if (!confirmDiscard()) return;
        begin({ id: draft.projectId, label: draft.projectLabel, source: 'Saved draft' }, draft);
        status(`Opened draft "${draft.fields.name || 'Untitled draft'}". Nothing was sent anywhere.`);
      };
      const remove = element('button', 'Delete'); remove.type = 'button';
      remove.setAttribute('aria-label', `Delete draft ${draft.fields.name || 'Untitled draft'}`);
      remove.onclick = () => {
        if (!globalThis.confirm(`Delete the draft "${draft.fields.name || 'Untitled draft'}" from this browser? This cannot be undone.`)) return;
        try {
          saveDrafts(storage, removeDraft(readStore(), draft.id, LOCAL_SCOPE));
          if (draftId === draft.id) { draftId = null; dirty = true; fillForm(); }
          renderDrafts();
          $('drafts-heading').focus();
          status(`Deleted draft "${draft.fields.name || 'Untitled draft'}" from this browser.`);
        } catch (error) { status(error.message, true); }
      };
      li.append(element('span', undefined, 'draft-buttons'));
      li.lastChild.append(open, remove);
      return li;
    }));
    if (!drafts.length) list.append(element('li', parsed.writable ? 'No saved drafts yet.' : 'Saved drafts are unavailable.', 'help'));
    if (parsed.problem) list.append(element('li', parsed.problem, 'field-error'));
    $('save-draft').disabled = !storageReady || !parsed.writable;
  }

  async function loadProjects() {
    const select = $('existing-project');
    const options = [];
    await Promise.all(RELEASE_SOURCES.map(async slug => {
      const path = `releases/${slug}/supporter-metadata.json`;
      try {
        const response = await fetchImpl(new URL(path, base), { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const item = projectFromReleaseMetadata(slug, await response.json(), `published Market release metadata (${path})`);
        projects.set(item.id, item);
        options.push({ value: item.id, label: item.label, order: RELEASE_SOURCES.indexOf(slug) });
      } catch (error) {
        console.error('[Supporter Studio project]', slug, error);
        options.push({ value: '', label: `${slug} — metadata unavailable (${error.message})`, disabled: true, order: RELEASE_SOURCES.indexOf(slug) });
      }
    }));
    options.sort((a, b) => a.order - b.order);
    select.replaceChildren(...options.map(({ value, label, disabled }) => {
      const option = element('option', label); option.value = value; option.disabled = !!disabled; return option;
    }));
    const firstReady = options.find(option => !option.disabled);
    if (firstReady) select.value = firstReady.value;
    if (!firstReady) status('Existing project details could not be loaded. You can still start a new project.', true);
  }

  const kind = () => root.querySelector('input[name="project-kind"]:checked').value;
  const syncKind = () => {
    const existing = kind() === 'existing';
    $('existing-project').disabled = !existing;
    $('existing-project-field').classList.toggle('muted', !existing);
  };
  root.querySelectorAll('input[name="project-kind"]').forEach(input => input.addEventListener('change', syncKind));
  syncKind();

  $('start-draft').addEventListener('click', () => {
    const chosen = kind() === 'new' ? newProject() : projects.get($('existing-project').value);
    if (!chosen) { status('Choose an available project, or start a new project.', true); $('existing-project').focus(); return; }
    if (!confirmDiscard()) return;
    begin(chosen);
    status(chosen.id === 'new'
      ? 'Started a new project draft with the current supported terms. Fill in the unknown fields.'
      : `Started a draft from ${chosen.label}. Every value is editable; source labels show where it came from.`);
  });

  form.addEventListener('input', event => {
    const field = event.target.name;
    if (!fields || !FIELDS.includes(field)) return;
    fields[field] = event.target.value;
    if (field === 'editionSize') resetGiftChoice();
    provenance = markEdited(provenance, field, fields, original);
    dirty = true;
    renderProvenance(); renderErrors(); schedule();
  });
  // Errors appear on the next edit or save, not on blur, so a message cannot shift the button being clicked.
  form.addEventListener('focusout', event => { if (FIELDS.includes(event.target.name)) touched.add(event.target.name); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const { errors } = renderErrors(true);
    const invalid = FIELDS.find(field => errors[field]);
    if (invalid) {
      $(`f-${invalid}`).focus();
      status(`Draft not saved: ${FIELD_LABELS[invalid]} — ${errors[invalid]}.`, true);
      return;
    }
    try {
      const parsed = readStore();
      const existing = draftId && parsed.drafts.find(item => item.id === draftId);
      const draft = createDraft({ project, fields, provenance, id: existing ? draftId : undefined });
      saveDrafts(storage, upsertDraft(parsed, existing ? { ...draft, createdAt: existing.createdAt } : draft));
      draftId = draft.id; dirty = false;
      original = { fields: { ...fields }, provenance: structuredClone(provenance) };
      fillForm(); renderDrafts();
      status(`Draft "${fields.name || 'Untitled draft'}" saved in this browser only. Nothing was uploaded or sent.`);
    } catch (error) {
      console.error('[Supporter Studio save]', error);
      status(`Draft not saved: ${error.message}`, true);
    }
  });
  $('discard-draft').addEventListener('click', () => {
    if (!confirmDiscard()) return;
    project = fields = provenance = original = null; draftId = null; dirty = false;
    form.hidden = true; $('previews').hidden = true;
    $('gift-preview-open').disabled = true;
    resetGiftChoice();
    $('start-draft').focus();
    status('Draft closed. Saved drafts are still listed below.');
  });
  form.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && event.target.matches('input, textarea, select')) {
      event.target.blur(); $('save-draft').focus();
    }
  });

  const giftDialog = $('gift-preview');
  const giftExample = $('gift-example-amount');
  const formatCount = value => value.toLocaleString('en-US');
  function renderGiftExample() {
    const maximum = editionGiftPreview(fields?.editionSize);
    const example = editionGiftPreview(giftExample.value);
    const valid = maximum && example && example.amount <= maximum.amount;
    $('gift-example-error').textContent = valid ? '' : 'Enter a whole number between 1 and the series maximum.';
    giftExample.setAttribute('aria-invalid', String(!valid));
    $('gift-counts').textContent = valid
      ? `If you give: you keep ${formatCount(example.kept)}; the Agency receives ${formatCount(example.gifted)} of ${formatCount(example.amount)} minted editions. If you skip: you keep ${formatCount(example.amount)}; the Agency receives 0.`
      : 'Gift amounts are unavailable until the example is valid.';
    $('gift-give').disabled = $('gift-skip').disabled = !valid;
    return valid ? example : null;
  }
  $('gift-preview-open').addEventListener('click', () => {
    const maximum = editionGiftPreview(fields?.editionSize);
    if (!maximum) { status('Enter a valid edition size before previewing the gift.', true); return; }
    resetGiftChoice();
    giftExample.value = String(maximum.amount);
    giftExample.max = String(maximum.amount);
    renderGiftExample();
    giftDialog.showModal();
  });
  giftExample.addEventListener('input', renderGiftExample);
  function chooseGift(give) {
    const example = renderGiftExample();
    if (!example) return;
    const gifted = give ? example.gifted : 0;
    const kept = give ? example.kept : example.amount;
    $('gift-preview-result').textContent = `Preview only: ${give ? 'Give' : 'Skip'} — you keep ${formatCount(kept)}; the Agency receives ${formatCount(gifted)}. Nothing was minted or saved.`;
    giftDialog.close();
  }
  $('gift-give').addEventListener('click', () => chooseGift(true));
  $('gift-skip').addEventListener('click', () => chooseGift(false));
  $('gift-cancel').addEventListener('click', () => { resetGiftChoice(); giftDialog.close(); });
  giftDialog.addEventListener('cancel', resetGiftChoice);
  giftDialog.addEventListener('close', () => $('gift-preview-open').focus());

  const onStorage = event => { if (event.key === null || event.key?.startsWith('decent-market:supporter-studio')) renderDrafts(); };
  const beforeUnload = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('storage', onStorage);
  window.addEventListener('beforeunload', beforeUnload);

  renderDrafts();
  const ready = loadProjects();
  return { ready, dispose() { window.removeEventListener('storage', onStorage); window.removeEventListener('beforeunload', beforeUnload); } };
}

const root = typeof document !== 'undefined' && document.querySelector('main[data-supporter-draft-studio]');
if (root) mountDraftStudio(root);
