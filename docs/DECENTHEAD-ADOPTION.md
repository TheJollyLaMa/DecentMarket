# DecentMarket: DecentHead v2 adoption

## Provenance and scope

`vendor/decent-head/2.0.0/` is an unmodified distribution from
[DecentHead v2.0.0](https://github.com/TheJollyLaMa/DecentHead/releases/tag/v2.0.0),
source commit `072a5206489d0e4a3f2576c56f8debb729d933c9`.
The source, artwork licenses and NOTICE travel with it. Do not edit the vendor
copy; host integration belongs in `decent-head.config.js` and `js/market-*.mjs`.
This adoption does not retag Head, alter its frozen metadata, or create a new
Market version or mint.

The existing Three.js r128 and matching OrbitControls runtime are now served
locally from `js/vendor/` (unchanged upstream versions, MIT license included),
so CDN script failures cannot prevent the gallery from booting. Ethers uses
the already-vendored Studio dependency. Host clipping contains the rotating
orbit's decorative mobile overflow without changing the frozen vendor source.

Both the landing/gallery page and Supporter Release Studio load the same
foundation. Market-specific identity, context, links and palette stay in host
configuration. Admin and My Profile ankh entries are inert skeletons, not
authorization controls.

## Wallet boundary

The header owns provider discovery, connection, selected EIP-6963 provider,
chain/account listeners, ENS and disconnect. Existing toolbar transactions use
`market-wallet.mjs` rather than selecting `window.ethereum` independently.
If more than one wallet is available, choose in the header before using another
control. Market's default public network is Base; the legacy network selector
remains available for configured deployments.

No account request occurs on load, listing reads, gallery loading or ownership
display. Transaction buttons require deliberate connection and retain their
existing wallet confirmations. Disconnect is a local session forget operation;
it does not revoke permissions at the wallet. Studio progress keys and saved
receipts are unchanged. Disconnect preserves progress but disables the next
transaction; reconnect/review before continuing. The Studio still validates
the account, Base, contracts, calldata and receipts at every step.

## Storage boundary

The active page no longer loads the retired web3.storage browser script.
`js/ipfs.js` preserves the generic minter's metadata builder and public
`uploadFileToIPFS` / `uploadMetadataToIPFS` APIs, using the header's in-memory
Pinata or local Kubo provider and credentials. Multipart binary uploads are
host-specific; shared session request, credential and CID helpers are reused.
Pinata without credentials fails explicitly; no shared key is provided.
Kubo needs reachable API/CORS configuration. Upload errors are not converted to
successful-looking URIs.

Uploads happen only when explicitly submitting the mint/upload action.
File and metadata uploads pin public plaintext: never upload secrets or private
health data. There is no automatic localStorage dump, backup/restore importer,
reward eligibility proof, payment or UCAN authorization adapter configured.
The header honestly reports unconfigured host-specific capabilities.

## Public release discovery and gallery

`releases/listings.json` is a curated index of official prepared releases,
not a blockchain-wide log watcher. Add a record only after verifying a completed
mint/listing. Keep the prepared manifest/metadata byte-identical to the official
release. `listingId: "0"` is valid and must not be tested by truthiness.

On initial load the public shelf checks Base network, exact contract/token/URI,
10-USDC terms, creator royalty, active/paused status and escrow stock coverage.
Failures are visible and do not produce a purchase link. Stock can change:
the purchase page rechecks it. This shelf is a latest-state listing check, not a
replacement for the release announcer's confirmed mint/receipt verification.
Published Head entry: token **70**, escrow listing **0**.

Metadata is the bundled official prepared release, matched to its on-chain URI.
The same verified product is placed in the 3D gallery automatically, with
independent front/back textures. Asset reads use a non-retired configurable
gateway. Unavailable artwork is identified; it is not replaced with fake art.

The complete toolbar gallery formerly scanned oldest-first, serially awaited
every metadata gateway, had no fetch timeout, and only displayed after finishing
all tokens. It now starts newest-first with four workers, an eight-second metadata
timeout, incremental rendering, explicit partial-read errors and retryable
uncached failures. Failed chain reads never fabricate zero supply.

## Validation and remaining release work

- `npm run test:supporter`: fixed protocol/receipt/display tests.
- `npm run test:market-adoption`: gallery order/concurrency/failures, actual
  listing-zero terms, stock/pause/purchase binding, shared upload and wallet rules.
- `npm run test:supporter:browser`: actual Studio UI and ethers with synthetic
  EIP-1193; rejection, resume, all four steps, evidence and mobile layout.
- `npm run test:market-adoption:browser`: migrated landing page, public shelf and
  real front/back meshes, consent, shared session and responsive layout.

Serve the repository locally on port 8793 (or set `BASE_URL`).
Browser tests never broadcast real transactions. A separate live read-only check
must confirm token 70 and the purchase route against Base.

Next marathon gates: deploy adoption, finish Market's full UI remodel and choose
its next semver, publish Market-specific release artwork/metadata, steward
mint/list its own edition, and prove one Discord lobby announcement per verified
release. Then align/release Canopy, Busking and BigNuten in order. No future mint,
buyer purchase, release or Discord delivery is implied by these tests.
