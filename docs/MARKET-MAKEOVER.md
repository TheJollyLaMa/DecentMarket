# Base storefront makeover (v0.3.0)

The steward approved publishing this storefront as v0.3.0. Existing Head artwork
and metadata remain frozen. Publishing this code does not mint, transfer or list
inventory, or enable Discord announcements. Each mint action needs its own
wallet confirmation. Footer/Canvas standalone releases remain deferred.

## Automatically shown does not mean automatically signed

On entry, Market reads the **Base escrow listing index**, not the entire NFT
collection. Active, nonempty listings are discovered without a wallet. Each
listing's actual ERC-1155 stock, pause state and ETH/ERC-20 price are checked at
a common read block. ERC-20 decimals/symbol come from the payment contract.
Overlapping active reservations must be covered together; uncovered listings
are not advertised as purchasable. Read failures are explicit, not zero stock.
The current Head release additionally retains its stricter prepared-release
URI/royalty/price verification. Metadata prices are historical descriptions,
never authorization to sell an unlisted NFT.

The storefront supports ERC-1155 collections held by this escrow, including
different collections with the same numeric token ID. It is not an index of
every Base NFT, other escrows or Busking's unminted owner-approval queue.
The default scene shows verified purchasable editions. The filters also offer
all minted editions, excluding unminted registrations. Full registered Market
products load only when choosing all minted editions or opening the gallery.
Public RPC batches remain capped at ten, and escrow-index reads are serial.
Refresh in Browse or the filters to discover new listings; no page reload needed.

The large card offers one edition at the reviewed on-chain price. Buying
rechecks account, Base network, immutable listing terms, active/paused state,
stock and overlapping reservations. It approves only the exact ERC-20 price
when allowance is insufficient, rechecks after approval and pins transaction
chain ID to Base. A successful receipt must contain the expected `Purchased`
event from the configured escrow, with buyer, quantity, listing and payment.
Errors keep the card disabled until a refreshed review; uncertain transactions
must be inspected in the wallet/explorer before retrying. No automatic retries.
Actual creation/listing of new stock remains wallet-signed.

These are preflight checks, not a smart-contract upgrade. Listings can change
between reads and confirmation, ERC-20 approvals may remain after a failed
purchase, and the contract itself controls settlement. Review wallet requests.
Purchase tests use synthetic signers/receipts; no real buyer purchase is made.

## Coins and provenance

The Mandelblum video sphere is removed. Coins have radius 5.5 scene units
(previously 3.5) and follow a radius-28, 12-unit-depth spiral with an open center.
The landing overview frames the loaded spiral; nearby flip controls are limited
to two coins within 38.5 scene units, prioritizing the selected coin.
The existing **footer** includes newer/older arrows, an edition slider, Inspect,
Zoom in, Back up and Reset view. Travel translates the camera and its orbit
target together, preserving viewing distance; reset restores a portrait-aware
front view. Drag to orbit, scroll/pinch to zoom, right-drag/two-finger drag to pan.
The controls are icons around the existing dials, not a floating dropdown. A one-edition result
correctly disables time travel; select all minted editions to explore more.
The browsing sequence follows existing registration/listing ordering, not
verified block timestamps or invented historical dates.

The footer retains its original 578px-wide, 104px-high horizontal composition
at desktop size; it scales as a single unit on narrower screens rather than
adding rows. Navigation, timeline and zoom live inside the flight/cannon dial,
and the emoji dial's center inspects the selected DNFT. The star-speed knob and
speed markings are removed. Background stars face the camera and drift gently
straight toward the viewer at a frame-rate independent 2.5 units/second, wrapping
behind the camera-relative field. Reduced motion stops this continuous travel.
The DNFT spiral is independent of the starfield. Emoji selection changes the
background textures without deleting projectiles or resetting star positions.

See the [three-product Supporter and clone handoff](./SUPPORTER-RELEASE-HANDOFF.md).
Standalone Footer/Canvas changes are deferred; the preparation queue is not
accepted by the signing Studio and does not claim frozen releases.

Information is painted onto both faces of an extruded five-point star, with a
separate rim and correctly oriented front/back UVs. Text and original artwork
fit in its central face so the notches do not cut them off. Original pinned
art is displayed without changing the NFT. A small flip button near the bottom
of each coin toggles its face and keeps that choice when the pointer leaves.
Hover never changes rotation or scale. Click/tap the coin to open its large card.
Touch and keyboard users can also use Browse / purchase in the filters or
Explore / purchase in the gallery. Listing-check status lives in the filters,
not a floating overlay. Native dialogs provide
Escape, focus containment, close buttons and backdrop closing. Reduced motion
removes the flip transition; explicit coin and artwork flipping still work.

Cards link to actual Base token transfer history, escrow events, release,
repository, commit and IPFS source archive when metadata provides them. A
declared numeric `parentTokenId` links to that token in the same collection.
These are metadata-declared connections, not invented purchase history or proof
of a remix relationship. External destinations must use credential-free HTTPS.
Remote metadata is rendered as text, not interpreted as HTML.

## Right ankh: ENS only

The personal portal uses the shared selected wallet and forward-confirmed
Ethereum primary name. Public avatar, description and website records are
read on demand, with account-switch/stale-result guards and explicit lookup
failures. No Discord identity, OAuth backend or locally claimed name is added.

Without a primary name, the portal explains why ENS is useful, official setup,
Ethereum address and reverse/primary records, renewal and gas costs, and how
to retry identity lookup. An unavailable resolver is not called "no ENS name."

## Left ankh: steward, not a custody shortcut

The Base steward is `0x807061DF657A7697c04045dA7d16D941861cAABc`.
Advanced network/role and existing treasury tools are reached here, not from
the public right-side settings button. Smart contracts still enforce roles and
ownership; this static UI gate is not authentication or new on-chain authority.
Changing account/network closes the legacy admin panels.
Public treasury reads and subscription controls remain available from Browse;
they do not expose the owner forms or replace the priced coins with a legacy
inventory view. Older listing/payment widgets are replaced by a route back to
the shared, verified marketplace card.

[The public policy](../data/market-moderation.json) contains version 1 and an
array of `8453:<lowercase NFT contract>:<token ID>` keys in `hidden`.
An empty array hides nothing. Only the configured steward can use the local
preview; it is ignored for other/disconnected wallets. Reset discards preview.
Public display waits for the policy to load, so hidden items cannot flash into
view first. A policy-fetch failure is reported and withholds the scene/catalog.
Export downloads a candidate policy. Review it and replace the repo policy in a
normal approved PR/deployment to affect the public. No browser action claims to
publish it. Hiding never delists, transfers, burns or changes purchase rights.

## Market ENS release identity (prepared, not published)

The approved name is **decentmarket.decentagency.eth**.
[Prepared record values](../data/market-ens.json) include the GitHub Pages URL,
the bank emoji [avatar source](../img/ens/market-avatar.svg) and raster avatar,
and a banner captured from the actual Market header. Regenerate the header
capture if the approved release changes its appearance. Artwork is local until
deployment; do not save the proposed Pages image URLs in ENS before they resolve.

A read-only Ethereum mainnet check on 2026-10-21 found the parent registry owner
and ETH address to be `0xcAeEd8422fB5682C298B7F0971906d446fFd4e7a`, not the
Market Base steward aABc. The proposed subname had no registry owner or resolver.
Recheck permissions at signing time; no subname, resolver or record has been
created by this preparation.

After preview approval and version freeze:

1. Open [the parent in the official ENS manager](https://app.ens.domains/decentagency.eth).
   Connect its authorized wallet and create the `decentmarket` subname. Review
   the owner/manager and resolver; creating a subname does not require changing
   either the parent's address or a wallet's primary name.
2. Deploy/verify the approved Pages build. Pin the **deployable website directory**
   to IPFS, including its entry HTML and assets. Verify the root CID opens the
   working site, including nested modules, artwork and Base reads. A source ZIP
   or NFT metadata CID is not a browsable website root.
3. Pin the final avatar/banner too, preferably using immutable `ipfs://` image
   records instead of mutable Pages URLs. Keep the Pages link in the `url` text
   record. Set `avatar`, `header`, description and GitHub from the reviewed data.
4. Set the ENS **contenthash** to the website's `ipfs://<root CID>` through the
   ENS manager (which encodes it); do not put the CID into an ETH address record.
   Do not invent an address record: choose the intended recipient separately if
   an address is needed. Review the Ethereum network, gas and each wallet request.
5. Read records back independently and verify avatar, banner, Pages link and
   IPFS website before citing this identity in the Supporter release.

The record file deliberately leaves contenthash/address null. There is no
automatic ENS transaction, upload, primary-name change, or preview pin.

## Reuse review and remaining release gates

- Busking's selected-wallet identity, owner-approved music submission and
  separation of playback/notification failures remain intact. Marketplace
  discovery and purchases do not depend on Discord or the music API.
- Canopy's ENS patterns inform forward-address checks, public profile records,
  stale-account protection, safe links and distinguishing associations from
  ownership. No dirty Busking/Canopy worktree was modified or published.
- The frozen Head v2 distribution is unmodified; Market styles and portal
  actions live in host modules. Shared upload credentials stay session-only.
- Optimism remains archived; Base escrow settlement is explicit. The legacy
  Polygon NFT configuration is retained, not silently migrated or relisted.
- Future release work still needs steward UI approval, version choice, source
  archive/artwork freeze, CI/Pages verification and the Market Supporter mint.
  Discord activation remains separately disabled by steward choice.

Validation: `npm run test:supporter`, `npm run test:market-adoption`, and the
three existing safe browser rehearsals. Makeover tests cover listing zero,
stock/pauses/overlapping reservations, cross-collection IDs, token decimals,
exact approval/payment, stale contexts and receipt verification, moderation,
explicit coin flipping, sale-first/minted-only filters, enlarged cards, ENS
guidance and 320–1440px Header layout.
