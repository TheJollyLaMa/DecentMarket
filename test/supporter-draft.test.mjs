import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DRAFT_STORE_KEY, DRAFT_STORE_SCHEMA, LOCAL_SCOPE, MAX_DRAFTS, createDraft, draftsForScope, isStale, loadDrafts,
  markEdited, newProject, parseDraftStore, previewMetadata, projectFromReleaseMetadata, removeDraft, saveDrafts,
  serializeDraftStore, termsSummary, upsertDraft, validateDraft, validateFields,
} from '../js/supporter-draft.mjs';

const metadata = JSON.parse(readFileSync(new URL('../releases/decenthead-v2.0.0/supporter-metadata.json', import.meta.url)));
const now = new Date('2026-11-23T12:00:00.000Z');
const memory = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data }; };
const valid = { name: 'Moonlit Album Supporter', description: 'Helps finish the album.', image: 'https://example.com/front.png',
  backImage: '', externalUrl: 'https://example.com', editionSize: '100', priceUSDC: '10', royaltyBps: '500', payoutAddress: '' };

test('existing release metadata prefills editable, source-labelled fields without a payout address', () => {
  const project = projectFromReleaseMetadata('decenthead-v2.0.0', metadata, 'release file');
  assert.equal(project.id, 'release:decenthead-v2.0.0');
  assert.equal(project.label, 'DecentHead v2.0.0');
  assert.deepEqual([project.fields.editionSize, project.fields.priceUSDC, project.fields.royaltyBps], ['1000', '10', '1000']);
  assert.equal(project.fields.image, metadata.image);
  assert.equal(project.provenance.name.kind, 'source');
  assert.equal(project.fields.payoutAddress, '');
  assert.equal(project.provenance.payoutAddress.kind, 'unknown');
  assert.throws(() => projectFromReleaseMetadata('x', { description: 'no name' }, 'file'), /name/);
});

test('unsupported or unsafe source values become unknown instead of being copied', () => {
  const project = projectFromReleaseMetadata('odd', { name: 'Odd', image: 'javascript:alert(1)', external_url: 'http://insecure.example',
    properties: { supply: 7, price: '3 USDC', royalty_bps: 1234 } }, 'file');
  for (const field of ['image', 'externalUrl', 'editionSize', 'priceUSDC', 'royaltyBps', 'description']) {
    assert.equal(project.fields[field], '', field);
    assert.equal(project.provenance[field].kind, 'unknown', field);
  }
});

test('new projects start from supported default terms and unknown details', () => {
  const project = newProject();
  assert.deepEqual([project.fields.editionSize, project.fields.priceUSDC, project.fields.royaltyBps], ['1000', '10', '1000']);
  assert.equal(project.provenance.priceUSDC.kind, 'default');
  assert.equal(project.provenance.name.kind, 'unknown');
  assert.deepEqual(validateFields(project.fields).missing, ['name', 'description', 'image']);
});

test('field validation reports format errors separately from missing values', () => {
  assert.deepEqual(validateFields(valid), { errors: {}, missing: [] });
  const { errors } = validateFields({ ...valid, name: 'ab', image: 'http://example.com/a.png', backImage: 'ipfs://not-a-cid',
    externalUrl: 'javascript:alert(1)', editionSize: '50', priceUSDC: '5', royaltyBps: '1001', payoutAddress: '0x123' });
  assert.deepEqual(Object.keys(errors).sort(), ['backImage', 'editionSize', 'externalUrl', 'image', 'name', 'payoutAddress', 'priceUSDC', 'royaltyBps']);
  assert.match(validateFields({ ...valid, payoutAddress: `0x${'0'.repeat(40)}` }).errors.payoutAddress, /zero/);
  assert.match(validateFields({ ...valid, royaltyBps: '125' }).errors.royaltyBps, /half-percent/);
  assert.deepEqual(validateFields({ ...valid, image: 'ipfs://QmcuhKLo46hwSdUQJm93VoHeB1YrpjhzeySg6Q7D9srabS' }).errors, {});
  assert.match(validateFields({ ...valid, description: 'x'.repeat(1001) }).errors.description, /1000/);
});

test('drafts save, reopen, edit and delete through a versioned store', () => {
  const storage = memory();
  const draft = createDraft({ project: newProject(), fields: valid, provenance: { name: { kind: 'edited' } }, now, id: 'draft-one' });
  saveDrafts(storage, upsertDraft(loadDrafts(storage), draft, now));
  const stored = JSON.parse(storage.data.get(DRAFT_STORE_KEY));
  assert.equal(stored.schema, DRAFT_STORE_SCHEMA);
  assert.equal(stored.version, 1);
  const later = new Date('2026-11-24T00:00:00.000Z');
  saveDrafts(storage, upsertDraft(loadDrafts(storage), { ...draft, fields: { ...draft.fields, name: 'Renamed edition' } }, later));
  const [reopened] = draftsForScope(loadDrafts(storage));
  assert.equal(reopened.fields.name, 'Renamed edition');
  assert.equal(reopened.createdAt, now.toISOString());
  assert.equal(reopened.updatedAt, later.toISOString());
  saveDrafts(storage, removeDraft(loadDrafts(storage), 'draft-one'));
  assert.deepEqual(draftsForScope(loadDrafts(storage)), []);
  assert.throws(() => removeDraft(loadDrafts(storage), 'draft-one'), /no longer exists/);
});

test('invalid fields cannot be saved', () => {
  assert.throws(() => createDraft({ project: newProject(), fields: { ...valid, priceUSDC: '7' }, now }), /priceUSDC/);
  assert.throws(() => validateDraft({ version: 2 }), /version/);
});

test('corrupt, foreign and newer stores are read-only and never overwritten', () => {
  for (const raw of ['{not json', JSON.stringify({ schema: 'other', drafts: [] }), JSON.stringify({ schema: DRAFT_STORE_SCHEMA, version: 9, drafts: [] })]) {
    const parsed = parseDraftStore(raw);
    assert.equal(parsed.writable, false);
    assert.ok(parsed.problem);
    assert.throws(() => serializeDraftStore(parsed), /read-only/);
  }
});

test('individually invalid drafts are hidden but preserved when saving others', () => {
  const good = createDraft({ project: newProject(), fields: valid, now, id: 'draft-good' });
  const bad = { ...good, id: 'draft-bad', fields: { ...good.fields, image: 'javascript:alert(1)' } };
  const parsed = parseDraftStore(JSON.stringify({ schema: DRAFT_STORE_SCHEMA, version: 1, drafts: [good, bad] }));
  assert.deepEqual(parsed.drafts.map(d => d.id), ['draft-good']);
  assert.equal(parsed.rejected.length, 1);
  const written = JSON.parse(serializeDraftStore(removeDraft(parsed, 'draft-good')));
  assert.deepEqual(written.drafts.map(d => d.id), ['draft-bad']);
});

test('drafts from another account or network do not cross into this scope', () => {
  const other = { kind: 'wallet', account: '0x807061DF657A7697c04045dA7d16D941861cAABc', chainId: 8453 };
  const mine = createDraft({ project: newProject(), fields: valid, now, id: 'draft-mine' });
  const theirs = createDraft({ project: newProject(), fields: valid, now, id: 'draft-theirs', scope: other });
  const parsed = parseDraftStore(JSON.stringify({ schema: DRAFT_STORE_SCHEMA, version: 1, drafts: [mine, theirs] }));
  assert.deepEqual(draftsForScope(parsed, LOCAL_SCOPE).map(d => d.id), ['draft-mine']);
  assert.deepEqual(draftsForScope(parsed, { ...other, account: other.account.toLowerCase() }).map(d => d.id), ['draft-theirs']);
  assert.throws(() => removeDraft(parsed, 'draft-theirs', LOCAL_SCOPE), /different account/);
  assert.throws(() => upsertDraft(parsed, { ...theirs, scope: LOCAL_SCOPE }), /different account/);
});

test('draft count is limited and stale drafts are flagged', () => {
  let parsed = parseDraftStore(null);
  for (let i = 0; i < MAX_DRAFTS; i++) parsed = upsertDraft(parsed, createDraft({ project: newProject(), fields: valid, now, id: `draft-${i}x` }), now);
  assert.throws(() => upsertDraft(parsed, createDraft({ project: newProject(), fields: valid, now, id: 'draft-extra' })), /up to/);
  assert.equal(isStale(parsed.drafts[0], new Date('2027-01-01T00:00:00.000Z')), false);
  assert.equal(isStale(parsed.drafts[0], new Date('2027-03-01T00:00:00.000Z')), true);
});

test('edits are labelled and reverting restores the original provenance', () => {
  const project = projectFromReleaseMetadata('decenthead-v2.0.0', metadata, 'release file');
  const fields = { ...project.fields, name: 'Changed' };
  let provenance = markEdited(project.provenance, 'name', fields, project);
  assert.equal(provenance.name.kind, 'edited');
  fields.name = project.fields.name;
  provenance = markEdited(provenance, 'name', fields, project);
  assert.deepEqual(provenance.name, project.provenance.name);
  fields.name = '';
  assert.equal(markEdited(provenance, 'name', fields, project).name.kind, 'unknown');
});

test('previews mirror published metadata shape and state the supporter terms honestly', () => {
  const preview = previewMetadata({ ...valid, backImage: 'https://example.com/back.png' });
  assert.equal(preview.properties.price, '10 USDC');
  assert.equal(preview.properties.supply, 100);
  assert.equal(preview.properties.back_image, 'https://example.com/back.png');
  assert.ok(!JSON.stringify(preview).match(/tokenId|listingId|Qm|bafy/));
  assert.equal(previewMetadata({ ...valid, image: 'javascript:alert(1)' }).image, undefined);
  const terms = termsSummary(valid);
  const text = terms.map(t => `${t.term}: ${t.value}`).join('\n');
  assert.match(text, /not an investment, a share, a treasury claim/);
  assert.match(text, /Base \(chain 8453\)/);
  assert.match(text, /5% royalty/);
  assert.match(text, /Not set/);
  assert.equal(terms.find(t => t.term === 'Primary sales').known, false);
  assert.match(termsSummary({ ...valid, editionSize: '' }).find(t => t.term === 'Edition').value, /Unknown/);
});
