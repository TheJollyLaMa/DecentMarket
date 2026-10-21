# Market mint lanes and space filters

The right **Mint New DNFT** panel contains three mutually exclusive sections:

- **Regular DNFT**: the existing default generic minter and its optional listing.
- **Supporter DNFT**: the actual prepared Release Studio, mounted in the panel,
  not an iframe or a link to another page. It uses the same module, shared wallet,
  progress keys, receipt verification, consent and four signing steps as
  `supporter.html`. The standalone page remains for existing bookmarks/recovery.
- **Music DNFT**: DecentBusking media submission for owner approval. It does
  **not** register music through Market's older generic minter or imply an
  immediate mint. Busking's owner queue controls current Base collection/batch
  minting, DJuke settlement and completion announcements.

Music accepts a file or pinned file CID, optional cover, title/artist, artist
earning wallet, tip wallet, remix parent, DeVert flag and up to ten DJuke
earning splits totaling 100%. File media signatures are inspected using
Busking's existing helper, not inferred from an extension. Pinned media uses
the Busking detection endpoint. Public file uploads use the shared Head
Pinata/local Kubo session. Artist/owner authorization and a signed request
are required; there is no private key in Market. Service errors remain visible.
After a successful queue receipt, or an ambiguous delivery, submitting again is
disabled in that panel. Check Busking's queue before reopening/retrying.
There is no automatic resend, music mint transaction, or escrow listing.

The reused media and authorization helpers are unmodified from Busking commit
`77dbf70d62480c84310dcc6d860e731256c7bf2f`. Their current Apache-2.0/NOTICE
distribution files were copied from Busking main after its licensing update.
Busking licenses travel in `vendor/decent-busking/music-submission/`.
The request schema matches `/api/media/submit`. Its live OPTIONS preflight
accepts `https://thejollylama.github.io`, the origin shared by Market and Busking.
Local previews need that worker's local-origin allowance for real submissions;
browser tests mock it and never send real submissions or signatures.

## The first left panel

**Filter DNFTs in space** replaces the public Supporter release dropdown.
Choose All, Regular, Supporter or Music/video and search title, artist, repo,
version or token ID. Reset restores all. Filters apply to loaded Market
collection products and escrow views, not every arbitrary NFT on Base.
Refresh reloads the Base collection. Registered products load newest-first,
with visible partial-read status and no connection prompt.
Entry loads only verified prepared releases; opening filters or the gallery
loads the full collection on demand, avoiding an unsolicited scan on each visit.
Public RPC batches are capped at ten calls.

Prepared release verification still runs in the background and attaches the
verified purchase route to its 3D collectible. A Supporter HTML animation is not
mistaken for music. The front/back detail control and purchase route remain
available by clicking the collectible. No floating release shelf or Studio
launcher obscures space.

## Active network and wallet UI

Optimism is sunset: its addresses are removed from active runtime configuration
and known-token labels, its version link is disabled, and mint labels use the
selected configured chain instead of hardcoded Optimism text. Archived source,
documentation and vendor chain-icon support remain historical records, not
active contract routing. Base is the operational default.

The Market host hides the shared Header's **Open MetaMask** deep-link in both
page contexts without editing the frozen Head distribution. The fox and the
explicit no-injected-wallet message remain.

## Tests

`npm run test:market-adoption` covers filters, music inputs/splits, sunset
routing and the existing listing/storage/session boundaries.
`npm run test:market-adoption:browser` covers actual scene filtering, the three
panel lanes, embedded metadata review and synthetic signed music submission
with upload/queue receipt. `npm run test:supporter:embedded` rehearses all four
Supporter steps, rejection, reload recovery and evidence inside the right panel.
The standalone rehearsal remains unchanged in purpose.

For the separate community notification gate, follow
[Discord Supporter setup](./DISCORD-SUPPORTER-SETUP.md). The Music submission
queue and the versioned Supporter release notifier are different protocols.
