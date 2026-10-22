# Footer, Canvas and Market: release and clone handoff

[The preparation queue](../data/supporter-release-queue.json) is deliberately
**not a mint manifest**. It records the three requested products, current scope,
shared terms and outstanding gates without inventing versions, commits or CIDs.
Market now points to its verified v0.3.1 prepared manifest, not a minted edition.
Only Market integration is approved for this pass. No standalone Footer or Canvas
repository has been upgraded, tagged or minted.

## What is ready in Market

- [Footer](../js/components/Footer.js): existing emoji/flight dials containing
  timeline arrows, an edition slider, zoom/focus/overview/inspect icons and the
  current Discord invite. Flight controls are always visible, not a dropdown.
- [Canvas](../js/components/DecentCanvas.js) and [flight geometry](../js/market-flight.mjs):
  radius-28 spiral with a clear central corridor, overview framing, orbit/pan/zoom
  and no more than two nearby flip controls. All scene coins remain clickable.
  Collectibles are now double-sided five-point stars. Background stars fly
  gently straight toward the viewer; the old star-speed knob is removed.
- [Supporter Studio](../supporter.html) imports a product's schema-1
  `supporter-release.json` and matching `supporter-metadata.json`. The existing
  Head release must not be minted again.
- Sale discovery, exact price/stock checks and explicit buyer approval are
  shared across products. Merely preparing a release never registers or lists it.

## Freeze, mint and purchase

For **each** independently released product: approve/version its actual source,
pin its archive, produce dated front/back art plus animation, pin matching
metadata, and validate using `validateRelease` / `validateMetadata` in
[the existing protocol](../js/supporter-mint.mjs). Only then import both JSON
files in the Studio's **Another product / version** section. Do not substitute
Market's commit for a standalone Footer/Canvas release commit.

The creator signs four separate Base actions: register, mint 1,000, transfer
1,000 to escrow, list at 10 USDC. Save progress after every step; reconcile
existing transactions instead of starting again. Export evidence and independently
verify the resulting listing, inventory and purchase route. A royalty signal is
not guaranteed resale enforcement or financial return.

Market v0.3.1 has a dedicated **Load DecentMarket v0.3.1** preset in both
embedded and standalone Studio. Its JSON pair is copied byte-for-byte from the
official frozen release; the subsequent preset commit does not change the tag.
Loading is read-only. Use the creator wallet ending aABc on Base after reviewing
the artwork and consent. Save progress after every transaction.

Market's public `supporter/buy.html` route binds the Base chain, known escrow and
exact listing ID (including zero), verifies funded 10-USDC stock and uses the
same card and fresh purchase checks as the storefront. Merely opening its link
never connects a wallet or signs. It is not proof that an edition was minted.

## Clone to customize

Until standalone extraction, clone the **approved Market v0.3.1 tag** and serve
it over HTTP. Preserve the repository's license and attribution.

1. Customize identity/theme/links in [the host configuration](../decent-head.config.js).
2. Customize [Footer](../js/components/Footer.js), [Canvas](../js/components/DecentCanvas.js),
   [flight helpers](../js/market-flight.mjs) and [host CSS](../css/styles.css).
   Footer currently consumes Canvas's flight panel; copying the footer alone is
   **not** a standalone component installation.
3. Keep the pinned Header distribution intact. Reconfigure contracts, admin
   wallet, ENS identity, moderation and media approval owner intentionally.
   Changing the title does not transfer authority or create a new marketplace.
4. Run `npm run test:supporter`, `npm run test:market-adoption`, and the existing
   three browser rehearsals against the local HTTP URL before publishing.
5. Never ship storage credentials or private keys. Use session-only IPFS setup.
   Buying a Supporter keepsake does not itself grant extra source-code rights;
   customization rights come from the applicable license.

Standalone Footer/Canvas packaging will need explicit host APIs in place of
Market coupling, independent demos/tests, their own source freeze and accurate
clone instructions before their Supporter editions can be called ready.

## Market release preparation workflow

**Do not mint v0.3.0:** its published preparation produced a blank back image.
Do not import or mint its prepared manifest. The storefront itself is published;
its frozen Supporter assets are not approved for minting. The v0.3.1
renderer uses a screenshot of the working storefront only after both DNFT
artwork faces have loaded. Front/back PNG pixels and layout are now tested.
The back follows the original Head Supporter palette, glow, stars and rounded
frame; its identity and provenance are Market's own. The steward approved
continuing with this corrected release. Minting still requires all four
individual wallet confirmations after the frozen assets are verified.

This template is used by Market's release-preparation workflow, not automatically
by the Regular/Music minters or arbitrary imported Supporter metadata. Creators
keep their own artwork; scene stars and card/purchase controls are shared.

After publishing the approved tag, manually run **Prepare Market Supporter
release** with that tag. It checks out the exact source, resolves the creator's
ENS, captures the actual storefront, creates dated front/back art and a
self-contained rotatable presentation, pins source/art/metadata through the
repository's `PINATA_JWT` Actions secret and uploads the validated JSON pair to
the release. It refuses to replace an existing prepared manifest.

This workflow never signs transactions, posts to Discord or writes ENS records.
The source archive is distinct from an ENS deployable website-directory pin.
Download both prepared JSON release assets and import them into the Studio.

Pinata's public gateway serves the images, source archive and JSON but blocks
HTML presentations by policy. The v0.3.1 self-contained presentation was also
verified byte-for-byte through `https://ipfs.filebase.io/ipfs/` using its animation
CID. Keep the immutable `ipfs://` metadata URI; choose an HTML-capable gateway
or download the official presentation file to review it.
