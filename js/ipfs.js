/**
 * js/ipfs.js — Reusable IPFS upload utilities for DecentMarket
 *
 * This module centralises all IPFS interactions so that any minting flow
 * (Product NFTs, Achievement NFTs, future DNFT types) can share the same
 * upload and metadata-building logic without duplication.
 *
 * IPFS provider: the shared DecentHead session (Pinata or local Kubo).
 * Credentials are session-only and configured by the header's IPFS control.
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
 * the gateway configured by the host when a human-readable link is needed.
 */

import { validCID } from '../vendor/decent-head/2.0.0/js/ipfs.js';

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

/**
 * Upload a browser File using the same provider and credentials as the header.
 *
 * @param {File} file  Any File (image, video, model, …).
 * @returns {Promise<string>} The `ipfs://<cid>` URI for the uploaded file.
 */
export async function uploadFileToIPFS(file) {
  const session = globalThis.DecentHead?.getIpfs();
  if (!session) throw new Error('DecentHead storage session is not ready');
  if (!(file instanceof Blob)) throw new Error('Select a file to upload');
  const body = new FormData();
  body.append('file', file, file.name || 'asset');
  let cid;
  if (session.provider === 'local') {
    const response = await session.request(`${session.options.local.apiUrl.replace(/\/$/, '')}/api/v0/add?pin=true`, { method: 'POST', body });
    cid = JSON.parse((await response.text()).trim().split('\n').at(-1)).Hash;
  } else {
    const response = await session.request(session.options.pinata.uploadUrl, { method: 'POST', headers: session.headers(), body });
    cid = (await response.json()).IpfsHash;
  }
  if (!validCID(cid)) throw new Error('Storage provider returned an invalid CID');
  // Always return an ipfs:// URI — never an HTTP gateway URL.
  window.dispatchEvent(new CustomEvent('decenthead:ipfs', { detail: { ...session.snapshot(), action: 'upload', cid } }));
  return `ipfs://${cid}`;
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
  const blob = new Blob([JSON.stringify(metadata, null, 2)], {
    type: "application/json",
  });
  const metaFile = new File([blob], "metadata.json", { type: "application/json" });
  return uploadFileToIPFS(metaFile);
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
