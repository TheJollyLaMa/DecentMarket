import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ENS_NAME, pinSite, siteFiles } from '../scripts/supporter-site.mjs';

const CID = 'bafybeieu4ypnyluhjokrpjyjcr6rcguwokvawsgrq7qqcaa264vc2qqt34';
const commit = 'b'.repeat(40);

test('site files are tracked blobs minus dot-paths, symlinks and submodules', () => {
  const tree = ['100644 blob x\tindex.html', '100755 blob x\ttools/a.sh', '100644 blob x\t.github/x.yml',
    '120000 blob x\tlink', '160000 commit x\tlib/sub', '100644 blob x\tjs/.hidden/y.js'].join('\0') + '\0';
  assert.deepEqual(siteFiles(commit, () => tree), ['index.html', 'tools/a.sh']);
  assert.throws(() => siteFiles('HEAD', () => tree), /commit/);
});

test('the real Market tree is a static site', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const files = siteFiles(head);
  assert.ok(files.includes('index.html'));
  assert.ok(!files.some(f => f.startsWith('.') || f.includes('/.')));
});

test('site pin uploads a DecentMarket-rooted CIDv1 folder', async () => {
  let body;
  const fetchImpl = async (_url, init) => { body = init.body; return { ok: true, json: async () => ({ IpfsHash: CID }) }; };
  const result = await pinSite({ repo: 'TheJollyLaMa/DecentMarket', commit, jwt: 'jwt', files: ['index.html', 'css/a.css'], readBlob: () => Buffer.from('x'), fetchImpl });
  assert.deepEqual(result, { cid: CID, fileCount: 2, bytes: 2 });
  assert.deepEqual(body.getAll('file').map(f => f.name), ['DecentMarket/index.html', 'DecentMarket/css/a.css']);
  await assert.rejects(pinSite({ repo: 'TheJollyLaMa/DecentMarket', commit, jwt: 'jwt', files: ['README.md'], readBlob: () => Buffer.from('x'), fetchImpl }), /index\.html/);
  await assert.rejects(pinSite({ repo: 'TheJollyLaMa/DecentMarket', commit, jwt: 'jwt', files: ['index.html'], readBlob: () => Buffer.from('x'), fetchImpl: async () => ({ ok: true, json: async () => ({ IpfsHash: 'QmOld' }) }) }), /CIDv1/);
});

test('ENS names are lowercase .eth names', () => {
  assert.ok(ENS_NAME.test('decentmarket.decentagency.eth'));
  assert.ok(!ENS_NAME.test('DecentMarket.eth'));
  assert.ok(!ENS_NAME.test('decentmarket.com'));
});
