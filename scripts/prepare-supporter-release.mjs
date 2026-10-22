import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ethers, validateRelease, validateMetadata } from '../js/supporter-mint.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { TAG: tag, GITHUB_REPOSITORY: repo, PINATA_JWT: jwt } = process.env;
if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || repo !== 'TheJollyLaMa/DecentMarket' || !jwt)
  throw new Error('Market release tag, repository and PINATA_JWT required');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
const release = JSON.parse(run('gh', ['release', 'view', tag, '--repo', repo, '--json', 'publishedAt,assets,isDraft']));
if (release.isDraft || release.assets.some(asset => asset.name === 'supporter-release.json'))
  throw new Error('Published, not-yet-prepared release required; frozen assets must never be replaced');
const commit = run('git', ['rev-parse', `refs/tags/${tag}^{commit}`]);
if (commit !== run('git', ['rev-parse', 'HEAD'])) throw new Error('Checkout must exactly match release tag');
const releaseDate = new Date(release.publishedAt).toISOString();
const request = new ethers.FetchRequest('https://ethereum-rpc.publicnode.com'); request.timeout = 12000;
const provider = new ethers.JsonRpcProvider(request, 1, { staticNetwork: true });
let creatorAddress, ensObservedBlock;
try {
  creatorAddress = await provider.resolveName('thejollylama.eth');
  if (creatorAddress?.toLowerCase() !== '0x807061df657a7697c04045da7d16d941861caabc') throw new Error('Creator ENS does not match approved steward');
  ensObservedBlock = await provider.getBlockNumber();
} finally { provider.destroy(); }
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8793/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('decent-canvas')._productSprites?.['70'], {}, { timeout: 60000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: 'supporter-preview.png' });
  if (errors.length) throw new Error(`Release preview failed: ${errors.join('; ')}`);
  const screenshot = readFileSync('supporter-preview.png').toString('base64');
  await page.setViewportSize({ width: 1200, height: 1200 });
  await page.setContent(`<!doctype html><html><meta charset="utf-8"><style>
    body{margin:0;width:1200px;height:1200px;background:linear-gradient(150deg,#050b20,#143a34);color:#edfff8;font:26px system-ui}
    main{padding:48px;display:flex;flex-direction:column;align-items:center;gap:26px;box-sizing:border-box;height:1200px;border:12px solid #7af0c6}
    h1{font-size:66px;margin:0;color:#baffe2}p{margin:0;text-align:center;overflow-wrap:anywhere}img{width:1056px;border:2px solid #a78cff;border-radius:20px}
    .back{display:none}body.back .front{display:none}body.back .back{display:block}small{font-size:21px}strong{color:#baffe2}</style>
    <main><p>✦ A DECENT AGENCY · SUPPORTER DNFT ✦</p><h1>Decent Market ${tag}</h1>
    <img class="front" alt="Actual release storefront" src="data:image/png;base64,${screenshot}">
    <section class="back"><h2>Another Decent Frankenstein</h2><p>Base marketplace · two-sided DNFT stars · spiral flight · ENS portals · resumable Supporter studio</p>
    <p>Exact source commit<br>${commit}</p><p>github.com/${repo}/releases/tag/${tag}</p>
    <p>Apache-2.0 + NOTICE · original artwork/docs CC BY 4.0</p><p>Clone the tagged source to customize. Preserve attribution and review contract/identity configuration.</p>
    <p>No product ownership or financial return promised. Royalties are not universally enforced.</p></section>
    <p><strong>1,000 editions · $10 / 10 USDC each · Base</strong></p>
    <p>thejollylama.eth<br><small>${creatorAddress}</small></p><p>Release ${releaseDate}</p></main></html>`);
  await page.screenshot({ path: 'supporter-front.png' });
  await page.locator('body').evaluate(body => body.classList.add('back'));
  await page.screenshot({ path: 'supporter-back.png' });
} finally { await browser.close(); }
const frontData = readFileSync('supporter-front.png').toString('base64'), backData = readFileSync('supporter-back.png').toString('base64');
writeFileSync('supporter-presentation.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Decent Market ${tag} Supporter</title>
<style>body{margin:0;background:#050b20;color:white;display:grid;place-items:center;min-height:100vh;font:16px system-ui;perspective:1600px}
button{background:none;border:0;color:inherit;cursor:pointer}.card{display:block;position:relative;width:min(85vw,80vh);aspect-ratio:1;transform-style:preserve-3d;transition:transform .5s}
img{position:absolute;width:100%;inset:0;backface-visibility:hidden}img+img{transform:rotateY(180deg)}@media(prefers-reduced-motion:reduce){.card{transition:none}}</style>
<button aria-label="Rotate supporter card"><span class="card"><img alt="Release front" src="data:image/png;base64,${frontData}"><img alt="Release provenance back" src="data:image/png;base64,${backData}"></span><p>Click / tap / Enter to turn</p></button>
<script>let angle=0;document.querySelector('button').onclick=()=>{angle+=180;document.querySelector('.card').style.transform='rotateY('+angle+'deg)'};</script></html>`);
run('git', ['archive', '--format=tar.gz', '--output=supporter-source.tar.gz', commit]);
async function pin(filename, type) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(filename)], { type }), filename);
  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form, signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Pinata ${filename} HTTP ${response.status}`);
  const result = await response.json();
  if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(result.IpfsHash || '')) throw new Error('Invalid returned CID');
  return result.IpfsHash;
}
const codeArchiveCid = await pin('supporter-source.tar.gz', 'application/gzip');
const front = `ipfs://${await pin('supporter-front.png', 'image/png')}`;
const back = `ipfs://${await pin('supporter-back.png', 'image/png')}`;
const animation = `ipfs://${await pin('supporter-presentation.html', 'text/html')}`;
const manifest = { schema: 1, repo, version: tag, commit, releaseDate, creator: 'thejollylama.eth', creatorAddress,
  ensChainId: 1, ensObservedBlock, chainId: 8453, quantity: '1000', priceUSDC: '10000000', codeArchiveCid, front, back, animation };
const properties = { repo, version: tag, commit, code_archive_cid: codeArchiveCid, creator: manifest.creator,
  creator_address: creatorAddress, release_date: releaseDate, back_image: back,
  supply: 1000, price: '10 USDC', chain: 'Base', royalty_bps: 1000, license: 'Apache-2.0 + NOTICE',
  product: { version: tag, repo_url: `https://github.com/${repo}`, commit: `https://github.com/${repo}/commit/${commit}`, artifact_cid: `ipfs://${codeArchiveCid}` } };
const metadata = { name: `DecentMarket ${tag} Supporter DNFT`, description: 'Support the Decent Market release. Clone the tagged source under its license. No product ownership or financial return promised.',
  image: front, animation_url: animation, external_url: `https://github.com/${repo}/releases/tag/${tag}`,
  attributes: [{ trait_type: 'Kind', value: 'Supporter' }, { trait_type: 'Version', value: tag }], properties };
writeFileSync('supporter-metadata.json', JSON.stringify(metadata, null, 2) + '\n');
manifest.metadataURI = `ipfs://${await pin('supporter-metadata.json', 'application/json')}`;
validateRelease(manifest); validateMetadata(manifest, metadata);
writeFileSync('supporter-release.json', JSON.stringify(manifest, null, 2) + '\n');
run('gh', ['release', 'upload', tag, 'supporter-source.tar.gz', 'supporter-preview.png', 'supporter-front.png', 'supporter-back.png',
  'supporter-presentation.html', 'supporter-metadata.json', 'supporter-release.json', '--repo', repo]);
console.log('Frozen source/art/metadata pinned and release assets published. No mint, listing or Discord transaction sent.');
