import { detectSubmissionMedia, mediaFilename, validateCreatorSplits } from '../vendor/decent-busking/music-submission/js/submission-media.mjs';
import { buildSubmissionAuthorizationMessage } from '../vendor/decent-busking/music-submission/js/mint-submission.js';
import { uploadFileToIPFS } from './ipfs.js';
import { marketBrowserProvider } from './market-wallet.mjs';
import { validCID } from '../vendor/decent-head/2.0.0/js/ipfs.js';

export const BUSKING_SERVICE = 'https://decentbusking.onrender.com';
export function musicCID(value) {
  const cid = value.trim().replace(/^ipfs:\/\//, '');
  if (!validCID(cid)) throw new Error('Enter a file CID or ipfs://CID (not a gateway URL or folder)');
  return cid;
}
export function validateMusicSubmission({ title, artist, recipient, tipWallet, parentTokenId, creatorSplits }) {
  if (!title.trim() || title.trim().length > 120 || !artist.trim() || artist.trim().length > 80) throw new Error('Track title (up to 120 characters) and artist name (up to 80) are required');
  for (const address of [recipient, tipWallet]) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) throw new Error('Enter valid nonzero artist and tip wallets');
  }
  if (!Number.isSafeInteger(parentTokenId) || parentTokenId < 0) throw new Error('Parent token ID must be a nonnegative safe integer');
  return validateCreatorSplits(creatorSplits, recipient);
}
export function mountMusicSubmission(root) {
  root.innerHTML = `
    <p>Audio/video for DecentBusking’s Base owner-approval queue. This submits a request; it does not mint or list a token immediately.</p>
    <label>Track title<input name="title" maxlength="120" required></label>
    <label>Artist name<input name="artist" maxlength="80" required></label>
    <label>Audio/video file<input name="mediaFile" type="file" accept="audio/*,video/mp4"></label>
    <label>Or already-pinned media CID<input name="mediaCID" placeholder="ipfs://…"></label>
    <p>MP3, WAV, M4A, OGG/Opus, FLAC, AAC, WebM audio or MP4 video. File uploads up to 50 MB; formats are detected, not guessed.</p>
    <label>Cover artwork (optional)<input name="coverFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
    <label>Or cover CID<input name="coverCID" placeholder="ipfs://…"></label>
    <label>Artist earning wallet<input name="recipient" placeholder="0x… (required)"></label>
    <details><summary>Collaborators, tips and remix ancestry</summary>
      <p>DJuke earning shares must total 100%. These are not ERC-2981 resale royalties. Include the artist earning wallet.</p>
      <div data-splits></div><button type="button" data-add-split>Add earning wallet</button>
      <label>Tip wallet<input name="tipWallet" placeholder="Defaults to artist earning wallet"></label>
      <label>Parent token ID (remix / derivative)<input name="parentTokenId" type="number" min="0" step="1" value="0"></label>
      <label><input name="isDevertAd" type="checkbox"> Submit as DeVert advertising media</label>
    </details>
    <label><input name="consent" type="checkbox"> I have rights/permission to share this media and approve public IPFS uploads and a signed submission for owner review.</label>
    <button type="button" data-submit>Submit music for owner approval</button>
    <p role="status" data-music-status>No uploads, wallet prompts or signatures requested.</p>
    <a href="https://thejollylama.github.io/DecentBusking/" target="_blank" rel="noopener noreferrer">Open DecentBusking · player and owner approval tools</a>`;
  const input = name => root.querySelector(`[name="${name}"]`);
  const output = root.querySelector('[data-music-status]');
  const submit = root.querySelector('[data-submit]');
  const rows = root.querySelector('[data-splits]');
  function addSplit(wallet = '', percent = '') {
    if (rows.children.length >= 10) { output.textContent = 'At most 10 earning wallets are supported.'; return; }
    const row = document.createElement('div'); row.className = 'music-split-row';
    const address = document.createElement('input'); address.value = wallet; address.placeholder = '0x… earning wallet'; address.setAttribute('aria-label', 'Earning wallet');
    const share = document.createElement('input'); share.type = 'number'; share.min = '0.01'; share.max = '100'; share.step = '0.01'; share.value = percent; share.placeholder = '%'; share.setAttribute('aria-label', 'Earning share percent');
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.onclick = () => row.remove();
    row.append(address, share, remove); rows.append(row);
  }
  root.querySelector('[data-add-split]').onclick = () => addSplit();
  let busy = false;
  const uploaded = new WeakMap();
  async function upload(file) {
    if (uploaded.has(file)) return uploaded.get(file);
    const cid = musicCID(await uploadFileToIPFS(file)); uploaded.set(file, cid); return cid;
  }
  submit.onclick = async () => {
    if (busy) return;
    busy = true; submit.disabled = true;
    let submissionAttempted = false;
    try {
      if (!input('consent').checked) throw new Error('Review and confirm your sharing rights and submission consent first');
      const recipient = input('recipient').value.trim();
      const media = {
        title: input('title').value.trim(), artist: input('artist').value.trim(), recipient,
        tipWallet: input('tipWallet').value.trim() || recipient,
        parentTokenId: Number(input('parentTokenId').value || 0),
        isDevertAd: input('isDevertAd').checked,
      };
      const splits = [...rows.children].map(row => {
        const [wallet, share] = row.querySelectorAll('input');
        if (!/^\d+(?:\.\d{1,2})?$/.test(share.value)) throw new Error('Earning shares allow at most two decimal places');
        return { wallet: wallet.value.trim(), shareBps: Math.round(Number(share.value) * 100) };
      });
      media.creatorSplits = validateMusicSubmission({ ...media, creatorSplits: splits.length ? splits : undefined });
      const file = input('mediaFile').files[0], cover = input('coverFile').files[0];
      const cidInput = input('mediaCID').value.trim(), coverInput = input('coverCID').value.trim();
      if (file && cidInput) throw new Error('Choose a media file OR a media CID, not both');
      if (!file && !cidInput) throw new Error('Choose audio/video or a pinned media CID');
      if (cover && coverInput) throw new Error('Choose cover artwork OR a cover CID, not both');
      if (cover && (cover.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(cover.type))) throw new Error('Cover must be PNG, JPEG, WebP or GIF, up to 10 MB');
      if (coverInput) media.artworkCid = musicCID(coverInput);
      if (file) {
        if (file.size > 50 * 1024 * 1024) throw new Error('Uploads are limited to 50 MB; use an already-pinned file CID');
        const prefix = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
        const tail = new Uint8Array(await file.slice(Math.max(65536, file.size - 65536)).arrayBuffer());
        const bytes = new Uint8Array(prefix.length + tail.length); bytes.set(prefix); bytes.set(tail, prefix.length);
        media.mediaType = detectSubmissionMedia(bytes, { filename: file.name, type: file.type });
        media.filename = mediaFilename(media.mediaType, file.name);
      } else {
        media.ipfsCid = musicCID(cidInput);
        output.textContent = 'Detecting pinned media format…';
        const response = await fetch(`${BUSKING_SERVICE}/api/ipfs/media-type?${new URLSearchParams({ cid: media.ipfsCid })}`, { signal: AbortSignal.timeout(35000) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Media detection HTTP ${response.status}`);
        media.mediaType = result.mediaType; media.filename = mediaFilename(result.mediaType);
      }
      const provider = await marketBrowserProvider();
      if (await provider.send('eth_chainId', []) !== '0x2105') throw new Error('Music submissions require Base; switch with the header and retry');
      const signer = await provider.getSigner(), address = await signer.getAddress();
      const owner = globalThis.DECENT_CONFIG?.musicSubmissionOwner || '';
      if (address.toLowerCase() !== recipient.toLowerCase() && address.toLowerCase() !== owner.toLowerCase()) throw new Error('Artists must submit to their own connected earning wallet');
      if (file) { output.textContent = 'Uploading public media through your shared IPFS provider…'; media.ipfsCid = await upload(file); input('mediaCID').placeholder = `Uploaded ${media.ipfsCid}`; }
      if (cover) media.artworkCid = await upload(cover);
      output.textContent = 'Review the signed music submission in your wallet. No blockchain mint transaction is sent.';
      const payload = { ...media, address, origin: location.origin, issuedAt: new Date().toISOString() };
      const signature = await signer.signMessage(buildSubmissionAuthorizationMessage(payload));
      submissionAttempted = true;
      const response = await fetch(`${BUSKING_SERVICE}/api/media/submit`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, signature }), signal: AbortSignal.timeout(35000) });
      const result = await response.json();
      if (!response.ok) { submissionAttempted = response.status >= 500; throw new Error(result.error || `Submission HTTP ${response.status}`); }
      if (typeof result.trackId !== 'string' || !result.trackId || typeof result.status !== 'string') throw new Error('Submission response did not include a queue receipt');
      output.textContent = `Submitted for DecentBusking owner approval · ${result.trackId}. Not minted yet. Check the Busking queue before submitting again.`;
      submit.textContent = 'Submitted · awaiting owner review';
    } catch (error) {
      output.textContent = submissionAttempted
        ? `Delivery is uncertain: ${error.message}. Check the DecentBusking queue before retrying; no automatic resend.`
        : error.shortMessage || error.message;
      console.error('[Market music submission]', error);
      submit.disabled = submissionAttempted;
    } finally {
      busy = false;
      if (!submissionAttempted) submit.disabled = false;
    }
  };
}
