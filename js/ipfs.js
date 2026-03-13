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
 * fields reserved for future 3D/layout features:
 *
 *   {
 *     "name":         "Human-readable token name",
 *     "description":  "Long-form text description",
 *     "image":        "ipfs://<image-cid>",          // MUST be an ipfs:// URI
 *     "external_url": "https://decentmarket.io",      // optional, link to dapp
 *     "attributes": [                                 // OpenSea trait array
 *       { "trait_type": "Kind", "value": "Product" }
 *     ],
 *     "animation_url": "",   // reserved — future 3D model / video
 *     "properties": {        // reserved — future layout / 3D config
 *       "layout":  {},
 *       "model3d": ""
 *     }
 *   }
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
 * The client is created once and cached on `window._w3upClientInstance` so
 * that repeated calls within the same page session are free.  The user must
 * have already authenticated via the IPFS status button in the header before
 * calling this function.
 *
 * @returns {Promise<object>} The w3up client with a current space set.
 * @throws {Error} If the w3up library is not loaded or no space is found.
 */
export async function getW3upClient() {
  if (!window.w3up) {
    throw new Error(
      "IPFS (w3up) library not loaded. Ensure browser.min.js is included in index.html."
    );
  }

  // Return the cached client when available to avoid redundant initialisation.
  if (window._w3upClientInstance) return window._w3upClientInstance;

  const { create } = window.w3up;
  const client = await create();

  const spaces = client.spaces();
  if (!spaces || spaces.length === 0) {
    throw new Error(
      "No IPFS space found. Please connect to web3.storage via the IPFS button in the header first."
    );
  }

  // Activate the first available space (the user's default space).
  await client.setCurrentSpace(spaces[0].did());
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
}) {
  return {
    // ── Core OpenSea fields ───────────────────────────────────────────────
    name,
    description,
    // image MUST be an ipfs:// URI so it resolves independently of any gateway.
    image,
    external_url: externalUrl,

    // ── OpenSea trait attributes ──────────────────────────────────────────
    attributes: [
      { trait_type: "Kind", value: kind },
      ...extraAttributes,
    ],

    // ── Reserved for future media types ──────────────────────────────────
    // Set animation_url to an ipfs:// URI when a video / interactive scene
    // is available.  Leave empty ("") when unused.
    animation_url: animationUrl,

    // ── Reserved for future 3-D / layout features ─────────────────────────
    // Extend `properties` with new subfields rather than adding top-level
    // keys, so that existing metadata consumers are not broken.
    properties: {
      // 2-D canvas placement config (x, y, scale, rotation, …)
      layout,
      // IPFS URI of a glTF/GLB 3D model file
      model3d,
    },
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
