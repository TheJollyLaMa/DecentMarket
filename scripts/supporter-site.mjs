import { execFileSync } from 'node:child_process';

// Mirrors DecentHead scripts/supporter-site.mjs and DecentCanopy repo pins: tracked blobs minus dot-paths,
// symlinks and submodules, in one folder named after the repo, so every pinner derives the same CID.
export const CID_V1 = /^b[a-z2-7]{20,}$/;
export const ENS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+eth$/;

export function siteFiles(commit, git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 })) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Full commit SHA required');
  return git(['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean).map(line => {
    const [meta, path] = line.split('\t');
    const [mode, type] = meta.split(' ');
    return { mode, type, path };
  }).filter(f => f.type === 'blob' && (f.mode === '100644' || f.mode === '100755'))
    .map(f => f.path).filter(path => !path.split('/').some(part => part.startsWith('.')));
}

export async function pinSite({ repo, commit, jwt, files = siteFiles(commit), readBlob = path => execFileSync('git', ['cat-file', 'blob', `${commit}:${path}`], { maxBuffer: 256 << 20 }), fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !jwt) throw new Error('Repository and PINATA_JWT required for the site pin');
  if (!files.includes('index.html')) throw new Error(`${repo} has no root index.html at ${commit.slice(0, 7)}; it is not a static site`);
  const folder = repo.split('/')[1], form = new FormData();
  let bytes = 0;
  for (const path of files) {
    const blob = readBlob(path);
    bytes += blob.length;
    form.append('file', new Blob([blob]), `${folder}/${path}`);
  }
  form.append('pinataMetadata', JSON.stringify({ name: `${folder} site ${commit.slice(0, 7)}` }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
  const response = await fetchImpl('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form, signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`Pinata site upload failed (HTTP ${response.status})`);
  const cid = (await response.json()).IpfsHash;
  if (!CID_V1.test(cid || '')) throw new Error('Pinata did not return a CIDv1 site folder');
  return { cid, fileCount: files.length, bytes };
}
