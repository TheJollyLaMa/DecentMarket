# Supporter Release Studio

Open [`supporter.html`](../supporter.html) directly, from the Market landing-page
link, or from **Mint New DNFT → prepared-release studio**. The existing generic
minter remains available and unchanged. Do not use it to rebuild prepared
Supporter metadata.

## Prepare and review

The product's release automation must first pin its tagged source, front/back
art, self-contained presentation and metadata, and publish `supporter-release.json`
and `supporter-metadata.json`. The studio never uploads or regenerates these.
Load the included DecentHead v2.0.0 preset, or import both JSON files downloaded
from another official product release. Imported JSON is not an independently
authenticated GitHub release: review the linked repository, commit, assets,
metadata CID and creator before signing. Metadata fields are checked against the
manifest; this is not a cryptographic CID recomputation or an ENS lookup.

The included files in `releases/decenthead-v2.0.0/` are exact copies of the
[published release assets](https://github.com/TheJollyLaMa/DecentHead/releases/tag/v2.0.0).
They are not new preparations or replacement metadata. Gateway failures are
shown explicitly; the official release assets provide another review path.

The initial supported protocol is deliberately fixed:

- Base (8453), configured DecentNFT v0.2 and DecentEscrow deployments.
- 1,000 Product editions, 10 USDC per edition (10,000,000 six-decimal units).
- Creator `thejollylama.eth` with an explicit prepared public address.
- Royalty recipient is that creator address, 1,000 bps / 10%.
- NFT administrator and escrow owner must both be the connected creator.
- Escrow must be unpaused; every on-chain metadata/royalty recheck must pass.
- No alternate recipients, ETH pricing, arbitrary contracts or achievement lane.

Royalties are marketplace-dependent, not universally enforced. Primary-sale
USDC stays in the owner-controlled escrow until withdrawn. No financial return
is promised.

## Four explicit wallet confirmations

Connect only after reviewing the release and checking the confirmation box.
The page requests no account access on load or while reviewing the release.
Use your regular MetaMask-enabled browser; the VS Code integrated browser may
not have an injected wallet.

1. **Register release:** `registerToken(1000, preparedMetadataURI, 0, creator, 1000)`.
   Parse `TokenRegistered` from the approved contract receipt; never guess an ID.
2. **Mint:** `mintProduct(creator, verifiedTokenId, 1000)`.
3. **Transfer:** `safeTransferFrom(creator, escrow, tokenId, 1000, "0x")`.
   This is a direct transfer from the signing holder, not `setApprovalForAll`.
4. **List:** `listDNFT(nft, tokenId, 0, BaseUSDC, 10000000, 1000, releaseLabel)`.
   Parse `Listed` for the actual listing ID.

Each click sends only one named step. Wallet simulation and gas estimation run
first. You send **zero ETH value**, paying only Base network gas. Buyers later
pay USDC; minting 1,000 editions does not cost 10,000 USDC. The page cannot
sign on your behalf. Review every wallet prompt; reject unexpected operations.

## Resume, backups and ambiguous delivery

Browser localStorage holds release/account-bound progress and transaction
hashes; completed steps are rechecked against exact transaction calldata and
successful receipt events. A durable intent with nonce is saved **before**
broadcast; the returned hash is saved before waiting. Successful receipts retain
the exact token/listing IDs. Download the public progress JSON after every step
(the studio also initiates a download after each successful action).

Web Locks prevent simultaneous signing in this origin; a stale-tab storage
check stops old state from broadcasting another registration. Use one browser
and tab. These safeguards are **not global on-chain deduplication**:
another browser, cleared storage, another origin or another tool can still
register the same release. Never start a new registration to recover an
existing one. Keep backups and public transaction hashes.

After reload, load the same release and reconnect. Completed steps are verified
and skipped. A known pending hash is checked without sending again. If the hash
was lost after broadcasting, copy it from wallet activity into recovery.
Speed-up replacements are accepted only if account, Base chain, nonce, contract,
zero value and exact calldata match. A cancellation transaction does not match:
stop and ask the steward to reconcile; do not clear state blindly.

A reverted receipt clears that failed intent without discarding completed
steps. Wallet rejection clears an unsigned intent. Unknown network/send failures
retain the claim and block a second send. If saving progress fails, no new
transaction is sent; if saving fails after broadcast, recover from wallet
activity. Never clear a pending record merely because a request timed out.

To move browsers, load the identical official release, connect its creator,
then import your progress backup. The engine verifies completed transaction
receipts before saving; it refuses rollback or overwriting an unresolved intent.
No seeds, private keys, JWTs, or webhook secrets belong in these public files.

## After listing

Enter the product's deployed HTTPS `supporter/buy.html` route, then choose
**Verify stock and download evidence**. The studio rechecks current active
listing, approved contracts/token, price, unpaused escrow, royalty and stock.
It exports the raw public evidence expected by the product release protocol:
mint hash, NFT/token, escrow/listing, 12-confirmation requirement and bound
purchase URL. Downloading **does not register evidence or post Discord**.

Register the downloaded file once from an authenticated steward terminal in the
product repository:

```sh
GITHUB_REPOSITORY=OWNER/PRODUCT TAG=vVERSION \
  node scripts/publish-supporter-assets.mjs --evidence /path/to/supporter-evidence.json
```

The product must already carry that reviewed release tooling. Provision its
Discord webhook secret privately and enable its notification workflow. The
notifier independently verifies mint quantity, metadata, confirmations and
stock before announcing. Do not claim a sale or announcement merely because
the browser displayed a successful mint. Review/test the real purchase URL.

## Validation

```sh
npm run test:supporter
```

For a full browser rehearsal with synthetic EIP-1193 replies (no real signing):

```sh
python3 -m http.server 8792 --bind 127.0.0.1
# In another terminal, with Playwright/Chromium installed:
BASE_URL=http://127.0.0.1:8792 npm run test:supporter:browser
```

`PLAYWRIGHT_MODULE` may point to an existing Playwright installation.
`SCREENSHOT_PATH` optionally records the mobile final state. CI runs both the
unit suite and browser rehearsal. Browser fixtures intercept asset gateways;
actual IPFS availability and real wallet signing are separate live gates.
