/**
 * js/ipfs.js — Reusable IPFS upload utilities for DecentMarket
 *
 * This module centralises all IPFS interactions so that any minting flow
 * (Product NFTs, Achievement NFTs, future DNFT types) can share the same
 * upload and metadata-building logic without duplication.
 *
 * IPFS provider: web3.storage w3up browser client (loaded as window.w3up via
 * the <script> tag in index.html that serves browser.min.js from IPFS itself).
 *
 * Metadata standard
 * -----------------
 * DNFT metadata follows the OpenSea ERC-721 / ERC-1155 metadata standard
 * (https://docs.opensea.io/docs/metadata-standards) with additional optional
 * fields reserved for future 3D/layout features and Product DNFT metadata:
 *
 *   {
 *     "name":         "Human-readable token name",
 *     "description":  "Long-form text description",
 *     "image":        "ipfs://<image-cid>",          // MUST be an ipfs:// URI
 *     "external_url": "https://decentmarket.io",      // optional, link to dapp
 *     "attributes": [                                 // OpenSea trait array
 *       { "trait_type": "Kind",    "value": "Product" },
 *       { "trait_type": "Version", "value": "1.0"     }
 *     ],
 *     "animation_url": "",   // reserved — future 3D model / video
 *     "properties": {        // reserved — future layout / 3D config
 *       "layout":  {},
 *       "model3d": "",
 *       // Product DNFT fields (present when kind === "Product"):
 *       "product": {
 *         "version":      "1.0",
 *         "repo_url":     "https://github.com/TheJollyLaMa/DecentMarket",
 *         "commit":       "https://github.com/…/commit/<hash>",
 *         "artifact_cid": "ipfs://<artifact-cid>",
 *         "opensea_url":  "https://opensea.io/assets/…/<token-id>"
 *       }
 *     }
 *   }
 *
 * Product DNFT schema
 * -------------------
 * Product DNFTs are admin-minted tokens representing digital goods (software,
 * tools, datasets, …).  They carry extra fields under `properties.product`:
 *
 *   version      — semver string matching the release tag, e.g. "1.0"
 *   repo_url     — canonical GitHub / source URL for the product
 *   commit       — permalink to the exact commit / release this token covers
 *   artifact_cid — ipfs:// URI for the zipped artifact / code snapshot
 *   opensea_url  — marketplace listing URL (fill in after first mint)
 *
 * See docs/decenthead-v1-metadata.json for a complete example.
 *
 * tokenURI convention
 * -------------------
 * All token URIs stored on-chain MUST use the `ipfs://` scheme:
 *   ipfs://<metadata-cid>
 *
 * Never store HTTP gateway URLs on-chain — gateways may change but CIDs are
 * permanent.  Resolve `ipfs://` URIs in the UI via a public gateway such as
 * https://<cid>.ipfs.w3s.link/ when a human-readable link is needed.
 */

// ---------------------------------------------------------------------------
// w3up client (web3.storage)
// ---------------------------------------------------------------------------

/**
 * Returns a ready-to-use web3.storage w3up client.
 *
 * Resolution order (first match wins):
 *   1. `window.w3upClient` — the authenticated client set by the header's
 *      IPFSStatus component after the user logs in via the IPFS button.
 *      This is the preferred source because it guarantees the correct
 *      authenticated space is already active.
 *   2. `window._w3upClientInstance` — an ipfs.js-level cache from a previous
 *      call in the same page session.
 *   3. A freshly-created client loaded from IndexedDB credentials (fallback).
 *      This path only succeeds if the user has previously authenticated in a
 *      prior session; it will throw when no space is found, prompting the user
 *      to connect via the header IPFS button.
 *
 * @returns {Promise<object>} The w3up client with a current space set.
 * @throws {Error} If the w3up library is not loaded or no authenticated space is found.
 */
export async function getW3upClient() {
  if (!window.w3up) {
    throw new Error(
      "IPFS (w3up) library not loaded. Ensure browser.min.js is included in index.html."
    );
  }

  // ── Priority 1: use the client already authenticated via the header ─────────
  // The header's IPFSStatus component sets window.w3upClient when the user
  // connects through the IPFS button, ensuring the correct space is active.
  if (window.w3upClient) {
    // w3up's currentSpace can be either a method or a property depending on the
    // client version — IPFSStatus.js handles both forms (see updateUIConnected).
    const currentSpace =
      typeof window.w3upClient.currentSpace === "function"
        ? window.w3upClient.currentSpace()
        : window.w3upClient.currentSpace;
    if (currentSpace) {
      // Keep ipfs.js cache in sync so subsequent calls are instant.
      window._w3upClientInstance = window.w3upClient;
      return window.w3upClient;
    }
  }

  // ── Priority 2: ipfs.js session cache ────────────────────────────────────────
  if (window._w3upClientInstance) return window._w3upClientInstance;

  // ── Priority 3: restore from IndexedDB credentials (fallback) ───────────────
  // This path creates a new client whose credentials come from IndexedDB (stored
  // during a previous login).  It will only have spaces if the user has logged in
  // before; otherwise it throws, directing the user to connect via the header.
  const { create } = window.w3up;
  const client = await create();

  const spaces = client.spaces();
  if (!spaces || spaces.length === 0) {
    throw new Error(
      "No authenticated IPFS space found. Please connect to web3.storage via the IPFS button in the header first."
    );
  }

  // Activate the first available space (the user's default space).
  await client.setCurrentSpace(spaces[0].did());
  // Cache locally only — window.w3upClient is owned by the header's IPFSStatus.
  window._w3upClientInstance = client;
  return client;
}

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

/**
 * Upload a browser File object to IPFS via web3.storage w3up.
 *
 * @param {File} file  Any File (image, video, model, …).
 * @returns {Promise<string>} The `ipfs://<cid>` URI for the uploaded file.
 */
export async function uploadFileToIPFS(file) {
  const client = await getW3upClient();
  const cid = await client.uploadFile(file);
  // Always return an ipfs:// URI — never an HTTP gateway URL.
  return `ipfs://${cid.toString()}`;
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

/**
 * Build an OpenSea-compatible DNFT metadata object.
 *
 * The returned object can be serialised to JSON and uploaded to IPFS.  Fields
 * follow the OpenSea metadata standard:
 * https://docs.opensea.io/docs/metadata-standards
 *
 * Future contributors: add new fields under `properties` to avoid breaking
 * existing consumers.  For example:
 *   properties.layout  — 2-D canvas layout config (x, y, scale, …)
 *   properties.model3d — IPFS URI of a glTF/GLB 3D model
 *   animation_url      — IPFS URI of an animation (video or interactive HTML)
 *
 * @param {object} opts
 * @param {string}   opts.name        Human-readable token name (required).
 * @param {string}   opts.description Text description (required).
 * @param {string}   opts.image       `ipfs://` URI of the cover image (required).
 * @param {string}   [opts.kind]      Token kind label, e.g. "Product" or "Achievement".
 * @param {string}   [opts.externalUrl] Link to the dapp or project page.
 * @param {string}   [opts.animationUrl] `ipfs://` URI for animation / 3D scene (future).
 * @param {object}   [opts.layout]    2-D layout hints for the canvas (future).
 * @param {string}   [opts.model3d]   `ipfs://` URI of a 3D model file (future).
 * @param {Array}    [opts.extraAttributes] Additional OpenSea-style attribute objects.
 * @param {object}   [opts.product]   Product DNFT metadata (present when kind === "Product"):
 * @param {string}   [opts.product.version]      Semver version string, e.g. "1.0".
 * @param {string}   [opts.product.repo_url]     Canonical source repo URL.
 * @param {string}   [opts.product.commit]       Permalink to the exact commit / release.
 * @param {string}   [opts.product.artifact_cid] `ipfs://` URI for the zipped artifact.
 * @param {string}   [opts.product.opensea_url]  Marketplace listing URL (fill after mint).
 * @returns {object} Metadata JSON object ready for IPFS upload.
 */
export function buildDNFTMetadata({
  name,
  description,
  image,
  kind = "Product",
  externalUrl = "https://decentmarket.io",
  animationUrl = "",
  layout = {},
  model3d = "",
  extraAttributes = [],
  // Product DNFT-specific fields (Issue #5).
  // Present only when kind === "Product"; ignored for Achievement tokens.
  product = null,
}) {
  // ── Build the OpenSea attribute array ─────────────────────────────────────
  const attributes = [
    { trait_type: "Kind", value: kind },
    // Include Version attribute when a product version is supplied.
    ...(product?.version ? [{ trait_type: "Version", value: product.version }] : []),
    ...extraAttributes,
  ];

  // ── Build the properties block ────────────────────────────────────────────
  // Always include layout/model3d stubs so future consumers can rely on them.
  // Merge product-specific fields under a dedicated `product` sub-object to
  // avoid polluting the top-level namespace.
  const properties = {
    // 2-D canvas placement config (x, y, scale, rotation, …)
    layout,
    // IPFS URI of a glTF/GLB 3D model file
    model3d,
  };

  if (kind === "Product" && product) {
    // Product DNFT schema v1 (Issue #5).
    // Extend this block — not properties root — to add new product fields.
    properties.product = {
      version:      product.version      || "",
      repo_url:     product.repo_url     || "",
      commit:       product.commit       || "",
      artifact_cid: product.artifact_cid || "",
      opensea_url:  product.opensea_url  || "",
    };
  }

  return {
    // ── Core OpenSea fields ───────────────────────────────────────────────
    name,
    description,
    // image MUST be an ipfs:// URI so it resolves independently of any gateway.
    image,
    external_url: externalUrl,

    // ── OpenSea trait attributes ──────────────────────────────────────────
    attributes,

    // ── Reserved for future media types ──────────────────────────────────
    // Set animation_url to an ipfs:// URI when a video / interactive scene
    // is available.  Leave empty ("") when unused.
    animation_url: animationUrl,

    // ── Reserved for future 3-D / layout features + product fields ────────
    // Extend `properties` with new subfields rather than adding top-level
    // keys, so that existing metadata consumers are not broken.
    properties,
  };
}

/**
 * Serialise a metadata object and upload it to IPFS.
 *
 * @param {object} metadata  Plain JS object (e.g. from `buildDNFTMetadata`).
 * @returns {Promise<string>} The `ipfs://<cid>` tokenURI for the metadata.
 */
export async function uploadMetadataToIPFS(metadata) {
  const client = await getW3upClient();
  const blob = new Blob([JSON.stringify(metadata, null, 2)], {
    type: "application/json",
  });
  const metaFile = new File([blob], "metadata.json", { type: "application/json" });
  const cid = await client.uploadFile(metaFile);
  // tokenURI convention: always ipfs://<cid>, never an HTTP gateway URL.
  return `ipfs://${cid.toString()}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the required fields for a DNFT mint.
 * Throws a descriptive Error if any required field is missing or invalid.
 *
 * @param {object} opts
 * @param {string} opts.name        Token name.
 * @param {string} opts.description Token description.
 * @param {string} opts.image       Image URI (must be non-empty; ipfs:// preferred).
 */
export function validateDNFTFields({ name, description, image }) {
  if (!name || !name.trim()) {
    throw new Error("Name is required.");
  }
  if (!description || !description.trim()) {
    throw new Error("Description is required.");
  }
  if (!image || !image.trim()) {
    throw new Error(
      "An image is required. Upload a file or enter an ipfs:// URI."
    );
  }
  if (!image.trim().startsWith("ipfs://") && !image.trim().startsWith("https://")) {
    throw new Error(
      "Image URI must start with ipfs:// or https://. Prefer ipfs:// for on-chain storage."
    );
  }
}
