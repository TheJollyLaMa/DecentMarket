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
- Admins (DEFAULT_ADMIN_ROLE) can use the "Seed Mint" section to register and mint the first DecentHead v1.0 DNFT directly from the UI

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


