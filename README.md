# DecentMarket
A Decent Market With a Decent Head, a Decent Canvas, and a Decent Foot in a Web3 space to display a gallery of Decent Assets and Tools in a coordinate system.

## Supported Networks

| Network | Chain ID | Symbol | Contract (DecentNFT) |
|---------|----------|--------|-----------------------|
| Polygon Mainnet | 137 (0x89) | MATIC | `0x4cE20F0bbF7eA38488F9c9555EfD2b502E86A53E` (v0.1) |
| Optimism Mainnet | 10 (0xa) | ETH | `0xe870f7b1D10C41dbc6b75598a5308B9a2Bb52958` (v0.2) |

The DecentNFT v0.2 contract is live on Optimism at `0xe870f7b1D10C41dbc6b75598a5308B9a2Bb52958`.
Use the right toolbar panel to switch networks; the contract address will be auto-filled for supported networks.

---

## DNFT Metadata Standard

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
   - **Max Supply** — `1` for a unique genesis mint, `0` for unlimited, or any edition size
   - **Mint to** — leave blank to mint to your own wallet, or enter a specific address

6. **Click ✨ Mint DNFT**
   The modal will:
   - Upload any pending files to IPFS
   - Build the OpenSea-compliant metadata JSON (including `repo_url` and `artifact_cid`)
   - Upload the metadata JSON to IPFS
   - Call `registerToken` on-chain → receive a `tokenId`
   - Call `mintProduct` (or `mintAchievement`) to mint the token to the recipient

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


