// js/config/products.config.js
// Data-driven registry of known Product DNFTs.
// This file is populated *after* minting — not before.
// Add an entry here once a product has been minted on-chain so the
// Product Gallery can display it with full metadata.
//
// Field guide
// ───────────
//   id           – unique slug, e.g. "decenthead-v1"
//   name         – human-readable product name, e.g. "DecentHead v1.0"
//   description  – long-form description shown in the gallery card
//   version      – semver string (drives the "Version" attribute in metadata)
//   repo_url     – canonical source repository URL
//   commit       – permalink to the exact commit / release tag
//   artifact_cid – ipfs:// URI of the zipped artifact snapshot
//   image_cid    – ipfs:// URI of the product cover image
//   opensea_url  – marketplace listing URL (fill in after listing)
//   tokenId      – on-chain ERC-1155 token ID (null until minted)
//   maxSupply    – max edition size that was set at registration
//
// ── How to add a new product ─────────────────────────────────────────────────
// 1. Mint the product using the "Mint New DNFT" modal (🌿 button).
// 2. Copy the tokenId from the success message.
// 3. Add an entry to the array below with the correct tokenId and CIDs.
// 4. Commit and push — the gallery will render the card on next load.

export const PRODUCT_REGISTRY = [
  {
    id:           "decenthead-v1",
    name:         "DecentHead v1.0",
    description:  "DecentHead v1.0 is the first Product DNFT minted in DecentMarket. It represents the DecentHead software artifact — a Web3-native digital good licensed and distributed on-chain.",
    version:      "1.0",
    repo_url:     "https://github.com/TheJollyLaMa/DecentHead",
    commit:       "https://github.com/TheJollyLaMa/DecentHead/commit/30920a061ea30db6deacbff26c1b6542bbcfb313",
    artifact_cid: "",   // paste ipfs:// URI after uploading artifact to IPFS
    image_cid:    "",   // paste ipfs:// URI after uploading product image to IPFS
    opensea_url:  "",   // paste OpenSea listing URL after minting and listing
    tokenId:      null, // replace with the on-chain tokenId after registerToken succeeds
    maxSupply:    100,
  },
];
