# DecentMarket
A Decent Market With a Decent Head, a Decent Canvas, and a Decent Foot in a Web3 space to display a gallery of Decent Assets and Tools in a coordinate system.

## Shared Head and live releases

Market and its Supporter Release Studio now adopt the unmodified released
**DecentHead v2.0.0** foundation: shared selected-wallet session, ENS orbit,
chain spark icons and themed About/IPFS dialogs. Host-only ankh actions open
the ENS profile portal and Base steward controls without changing frozen vendor files.
Pinata/local Kubo replace the active retired web3.storage upload path.
See [adoption provenance, boundaries and validation](./docs/DECENTHEAD-ADOPTION.md).

The first left sidepanel filters the DNFTs shown in 3D space, features verified
for-sale editions by default, and can include all minted editions (not unminted
registrations). Listing-check status and Browse / purchase live in this panel.
Prepared releases
are verified without connecting a wallet; click their collectible to review/buy.
**DecentHead v2.0.0: Base token 70, escrow listing 0, 10 USDC per edition.**
Stock and sale status are checked live; use the collectible's card to review current
terms and purchase one edition in Market. Its mint/listing evidence is published on the
[official Head release](https://github.com/TheJollyLaMa/DecentHead/releases/tag/v2.0.0).
Market's own next version and Supporter edition remain separate upcoming work.

The right **Mint New DNFT** panel has Regular, Supporter (embedded Release
Studio) and Music (Busking owner-approval submission) dropdowns.
See [mint lanes, filters and music protocol boundaries](./docs/MINT-LANES.md).
The Supporter Studio accepts frozen Base releases of 100 or 1,000 editions at
10 or 100 USDC each. It binds registration, mint, transfer, listing, receipts,
and displayed terms to that release; historical manifests are not rewritten.
100-USDC purchase evidence adds `priceUSDC=100000000` to the compatible Head
checkout route. Deploy that consumer before distributing new-price links.
See [Base storefront, ENS portal and display moderation](./docs/MARKET-MAKEOVER.md)
for the local makeover's release gates and read-only versus signing boundaries.

## DJuke contracts

DJuke v0.4 playlist checkout is an undeployed Base candidate. It preserves direct artist
settlement (`safeTransfer`, `artistLedger`, and `ArtistPaid`) for single-song requests,
radio batch requests, and private playlist purchases. Radio fee settlement is separate
from song payouts. The worker signs `PlaylistGasQuote` using the inherited EIP-712
`DecentJukeBox` domain version `0.2`; clients remain capability-gated until the v0.4
address, enable flag, and worker readiness are all present. See
[`docs/DJUKE-PLAYLISTS.md`](./docs/DJUKE-PLAYLISTS.md) for compiler, migration, and
steward approval gates. No deployment is authorized by this repository change.

## Supported Networks

| Network | Chain ID | Symbol | DecentNFT | DecentEscrow |
|---------|----------|--------|-----------|--------------|
| Base Mainnet | 8453 (0x2105) | ETH | [`0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B`](https://basescan.org/address/0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B) (v0.2) | [`0x31b07b83e99A9bdF379bf40225b8A80d3804C89d`](https://basescan.org/address/0x31b07b83e99A9bdF379bf40225b8A80d3804C89d) |
| Polygon Mainnet | 137 (0x89) | MATIC | `0x4cE20F0bbF7eA38488F9c9555EfD2b502E86A53E` (v0.1) | — |
| Optimism Mainnet | 10 (0xa) | ETH | `0xe870f7b1D10C41dbc6b75598a5308B9a2Bb52958` (v0.2, legacy) | `0x23A457AD3C33d68E4fAd2FCa7c5d9a511E0C350e` (legacy) |

Base is the current default deployment. DecentNFT and DecentEscrow are deployed,
and the UI routes legacy contract controls using the selected shared wallet chain.
Public prepared-release verification uses Base independently of wallet connection.
Subscription plans and further product listings require their own configuration.
Optimism is sunset/archived and is not available in active contract routing.

## Community Escrow Treasury

Early supporter DNFT proceeds are intended for the deployed Base **DecentEscrow**
contract. The Base escrow is live and Head's first Supporter sale is stocked as
listing **0**. Other products must be prepared, signed and listed separately.

The current Base escrow accepts ETH, Base USDC, and Base BNUT deposits:

| Token | Symbol | Address |
|-------|--------|---------|
| Ether | ETH | _(native)_ |
| USD Coin | USDC | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |
| BigNuten Token | **$BNUT** | [`0x25ACb773159Af5a5c672DEfe31C7Fff6a9A93736`](https://basescan.org/token/0x25ACb773159Af5a5c672DEfe31C7Fff6a9A93736) |

$BNUT is the BigNuten governance and rewards token. The Base token and escrow
contracts are configured in the app. Browse retains public Base treasury reads
and subscription controls; owner tools are under the left steward ankh.
The contract accepts BNUT deposits from any wallet after approval; the existing
advanced deposit form is in the steward panel.

See [`docs/ESCROW.md`](./docs/ESCROW.md) for:
- Contract address and Etherscan link
- What the funds are used for (bounties, infrastructure, community)
- Withdrawal policy (every withdrawal requires an on-chain `reason` string)
- Upgrade roadmap (single owner → Gnosis Safe → DAO governance)

---

## DNFT Metadata Standard

### Two-sided Supporter editions

The gallery reads `image` for the front and `properties.back_image` for the back
(HTTP(S) or `ipfs://`). The makeover renders two-sided five-point stars with the
edition name, live sale price/status and token identity on the coin itself.
Single-image tokens get a generated information back. The small bottom flip
button toggles each coin; hover does not turn or resize it.
Larger coins follow a wide spiral browsing sequence, initially framed in overview.
The existing footer has always-visible icon controls for
newer/older travel, a timeline slider, Inspect, Zoom in, Back up and Reset view.
The home icon restores the overview. Only two nearby coins can show flip controls.
Scroll/pinch zoom and drag orbit/pan are enabled. This sequence is not a
verified mint-date history. The Mandelblum video sphere is removed.
Background stars gently fly straight toward the viewer continuously, independent
of the DNFT spiral. There is no star-speed control; reduced motion stops travel.

[Footer, Canvas and Market release preparation / clone handoff](./docs/SUPPORTER-RELEASE-HANDOFF.md)
tracks the remaining source-freeze, packaging, artwork, mint and purchase gates.
Click/tap opens a large, keyboard-accessible card with artwork,
description, provenance and verified purchase controls. Reduced motion disables
the flip transition, and the card's explicit **View back / View front** button
still works. Missing artwork is reported and leaves the information coin usable.

Version, release date, creator identity and the original $10 USDC price belong
on the artwork and immutable metadata. They are historical release stamps, not
live resale prices or a promise of retained value. The shared
[Supporter release protocol](https://github.com/TheJollyLaMa/DecentHead/blob/main/docs/SUPPORTER-RELEASES.md)
prepares these assets and verifies mint/listing evidence before Discord announcements.

Focused display tests: `node --test test/supporter-display.test.mjs`.

DNFT metadata follows the [OpenSea ERC-1155 metadata standard](https://docs.opensea.io/docs/metadata-standards).

### tokenURI convention

All token URIs stored on-chain use the `ipfs://` scheme:

```
ipfs://<metadata-cid>
```

**Never store HTTP gateway URLs on-chain.** Gateways may change; CIDs are permanent.
Resolve `ipfs://` URIs in the UI via a public IPFS gateway (e.g. `https://<cid>.ipfs.w3s.link/`).

### Product NFT schema

Product DNFTs represent licensed digital goods (software, tools, datasets, …).
They are admin-minted and carry additional fields under `properties.product`:

| Field | Type | Description |
|-------|------|-------------|
| `properties.product.version` | string | Semver version string, e.g. `"1.0"` |
| `properties.product.repo_url` | string | Canonical source repository URL |
| `properties.product.commit` | string | Permalink to the exact commit / release |
| `properties.product.artifact_cid` | string | `ipfs://` URI for the zipped artifact snapshot |
| `properties.product.opensea_url` | string | Marketplace listing URL (fill in after minting) |

Additionally, a `"Version"` attribute is automatically added to the `attributes` array.

See [`docs/decenthead-v1-metadata.json`](./docs/decenthead-v1-metadata.json) for the full example of the first Product DNFT (DecentHead v1.0).

```json
{
  "name": "DecentHead v1.0",
  "description": "DecentHead v1.0 is the first Product DNFT minted in DecentMarket…",
  "image": "ipfs://<image-cid>",
  "external_url": "https://github.com/TheJollyLaMa/DecentMarket",
  "attributes": [
    { "trait_type": "Kind",    "value": "Product"    },
    { "trait_type": "Version", "value": "1.0"        },
    { "trait_type": "Collection", "value": "DecentHead" }
  ],
  "animation_url": "",
  "properties": {
    "layout": {},
    "model3d": "",
    "product": {
      "version":      "1.0",
      "repo_url":     "https://github.com/TheJollyLaMa/DecentMarket",
      "commit":       "https://github.com/TheJollyLaMa/DecentMarket/commit/HEAD",
      "artifact_cid": "ipfs://<artifact-cid>",
      "opensea_url":  "https://opensea.io/assets/optimism/<contract>/<token-id>"
    }
  }
}
```

### Product Gallery

The 🗿 button in the right toolbar opens the **Product Gallery** panel, which:

- Lists all known Product DNFTs with a gold `⭐ PRODUCT` badge
- Displays name, version, repo URL, and artifact CID
- Checks on-chain ownership (`balanceOf`): owners see a "✅ You own this NFT" indicator; non-owners see **Purchase on OpenSea** and **View Access** buttons
- To add a newly-minted product to the gallery, see [How to mint a new Decent product](#how-to-mint-a-new-decent-product) below

---

## How to mint a new Decent product

Any Decent product (e.g. BigNuten v1.0, DecentHead v1.0, …) can be immortalised on-chain as a
Product DNFT in a few steps — no code changes required.

### Prerequisites

- A connected MetaMask wallet with DEFAULT_ADMIN_ROLE on the target DecentNFT contract
- The contract address set in the 🔮 panel (auto-filled for supported networks)
- The product image and artifact zip uploaded to IPFS (or ready to upload via the form)

### Step-by-step

1. **Open the Mint modal** — click the **🌿** button in the right toolbar.

2. **Upload or paste the Image CID**
   - Drag & drop the product image into the 🖼️ Image drop zone to upload it to IPFS automatically, _or_
   - Paste an existing `ipfs://…` or `https://…` CID/URL into the Image CID field.

3. **Upload or paste the Artifact CID**
   - Drag & drop the repo `.zip` / `.tar.gz` into the 📦 Artifact drop zone to upload it automatically, _or_
   - Paste an existing `ipfs://bafybei…` CID into the Artifact CID field.

4. **Fill in the Metadata fields**
   - **Product Name** — e.g. `BigNuten v1.0`
   - **Description** — e.g. `BigNuten v1.0 — a privacy-first fitness tracker…`
   - **GitHub / Repo URL** — e.g. `https://github.com/TheJollyLaMa/BigNuten_Vanilla`

5. **Set Options**
   - **Kind** — `🔮 Product` (or `🏆 Achievement`)
   - **Max Supply** — `1` for a unique genesis mint, `0` for unlimited, or any edition size.
     _This sets the on-chain edition cap — the maximum number of editions that can ever be minted for this token._
   - **Mint Quantity** — how many editions you want to mint **right now** (defaults to `1`).
     Must be ≤ Max Supply (when Max Supply > 0). Additional editions can be minted later via the 📋 DNFT Contract Functions explorer.
   - **Mint to** — leave blank to mint to your own wallet, or enter a specific address

6. **Click ✨ Mint DNFT**
   The modal will:
   - Upload any pending files to IPFS
   - Build the OpenSea-compliant metadata JSON (including `repo_url` and `artifact_cid`)
   - Upload the metadata JSON to IPFS
   - Call `registerToken` on-chain → receive a `tokenId`
   - Call `mintProduct` (or `mintAchievement`) to mint the specified **Mint Quantity** to the recipient
   - Show a toast: `✅ Minted 5 × MyProduct — Token #3`

7. **Copy the tokenId** from the success message.

8. **Add the product to the gallery** — open `js/config/products.config.js` and append a new
   entry to `PRODUCT_REGISTRY` with the minted `tokenId`, image CID, and artifact CID.
   The Product Gallery (🗿) will then display the new card on next load.

### Example — BigNuten v1.0

| Field | Value |
|-------|-------|
| Product Name | `BigNuten v1.0` |
| Description | `BigNuten v1.0 — a privacy-first fitness tracker with IPFS data persistence and MetaMask wallet integration. Minted at v1.0.0 to mark the release on-chain.` |
| GitHub / Repo URL | `https://github.com/TheJollyLaMa/BigNuten_Vanilla` |
| Image CID | _(upload product image to IPFS via drop zone)_ |
| Artifact CID | _(upload repo zip to IPFS via drop zone)_ |
| Max Supply | `1` _(unique genesis mint)_ |
| Kind | `🔮 Product` |

---

### Metadata JSON fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Human-readable token name, e.g. `"DecentHead v1.0"` |
| `description` | string | ✅ | Long-form description of the token |
| `image` | string | ✅ | `ipfs://` URI of the cover image |
| `external_url` | string | — | Link to the dapp or project page |
| `attributes` | array | — | OpenSea trait objects `{ trait_type, value }` |
| `animation_url` | string | — | Reserved — future 3D model or video (`ipfs://` URI) |
| `properties.layout` | object | — | Reserved — future 2-D canvas layout config |
| `properties.model3d` | string | — | Reserved — future `ipfs://` URI for a glTF/GLB 3D model |
| `properties.product` | object | — | Product DNFT fields — see Product NFT schema above |

### Sample metadata

See [`metadata.json`](./metadata.json) for a complete example.

```json
{
  "name": "DecentHead #1",
  "description": "A limited-edition DecentHead collectible from DecentMarket.",
  "image": "ipfs://<image-cid>",
  "external_url": "https://decentmarket.io",
  "attributes": [
    { "trait_type": "Kind",    "value": "Product"    },
    { "trait_type": "Edition", "value": "1"          }
  ],
  "animation_url": "",
  "properties": {
    "layout":  {},
    "model3d": ""
  }
}
```

### IPFS upload utilities

All IPFS logic is centralised in [`js/ipfs.js`](./js/ipfs.js) and can be imported by any minting flow:

```js
import {
  uploadFileToIPFS,     // Upload a File → returns ipfs:// URI
  uploadMetadataToIPFS, // Serialise + upload metadata JSON → returns ipfs:// URI (tokenURI)
  buildDNFTMetadata,    // Construct an OpenSea-compliant metadata object (supports product field)
  validateDNFTFields,   // Validate required fields (name, description, image)
  getW3upClient,        // Get/cache the web3.storage w3up browser client
} from './js/ipfs.js';

// Example: build Product DNFT metadata
const metadata = buildDNFTMetadata({
  name: "DecentHead v1.0",
  description: "First Product DNFT…",
  image: "ipfs://<image-cid>",
  kind: "Product",
  product: {
    version:      "1.0",
    repo_url:     "https://github.com/TheJollyLaMa/DecentMarket",
    commit:       "https://github.com/TheJollyLaMa/DecentMarket/commit/HEAD",
    artifact_cid: "ipfs://<artifact-cid>",
  },
});
```

## Prepared Supporter releases

Open the [Supporter Release Studio](supporter.html) from the landing-page link
or **Mint New DNFT** modal to use an existing pinned release without rebuilding
its metadata. It separately registers, mints 1,000 editions, transfers to escrow,
and lists at 10 USDC on Base with explicit 10% creator royalties. Progress and
receipt IDs persist between steps; public backup/restore and pending-transaction
reconciliation avoid restarting a partially completed release. Other-browser
or external mints still require manual reconciliation, not a new registration.

The verified DecentHead v2.0.0 preparation is included as the first preset.
Other products import both official prepared JSON files. No automatic signing
or Discord posting is performed. See [setup, recovery and evidence registration](docs/SUPPORTER-STUDIO.md).

Validate with `npm run test:supporter`; browser rehearsal:
`BASE_URL=http://127.0.0.1:8792 npm run test:supporter:browser`.

## License

Code: [Apache-2.0](LICENSE) · Art and docs: [CC BY 4.0](LICENSES/CC-BY-4.0.txt) · Please keep the [NOTICE](NOTICE) and give The Jolly LaMa / A Decent Agency a head nod when you reuse this work.
Support the work with a [Supporter DNFT](https://thejollylama.github.io/DecentMarket/).

## Live performance escrow (undeployed)

`LivePerformanceEscrow` implements configurable USDC bookings, admin full/partial review, performer-only claims, automatic claim protection, cancellation fees and original-funder refunds. No deployment is authorized. See [lifecycle and safety notes](docs/LIVE_PERFORMANCE_ESCROW.md); tomorrow’s DecentBusking show uses the deployed router with earmarked, **not escrowed**, funds.

## Live performance escrow (undeployed)

`LivePerformanceEscrow` implements configurable USDC bookings, admin full/partial review, performer-only claims, automatic claim protection, cancellation fees and original-funder refunds. No deployment is authorized. See [lifecycle and safety notes](docs/LIVE_PERFORMANCE_ESCROW.md); Friday DecentBusking uses the deployed router with earmarked, **not escrowed**, funds.
