# DJuke named playlist contract candidate

## Sponsored v0.5 successor (not deployed)

`DecentJukeBox_v0.5.sol` requires `DJukeSponsoredPlaylistModule`, removes listener
worker ETH from both single requests and radio playlist purchases, and retains
signed zero-cost EIP-712 authorizations. Wallet network gas still applies. The
deployed v0.4 contract and already purchased batches are unchanged.

The successor releases $1 total after each fourth delivered song, split equally
across Playback, Top10, Pinners and Repo, then any remaining fee on completion.
Interruptions refund undelivered song prices and only the unreleased fee.
Progress emits `PlaylistBatchFeeProgress`; the existing terminal fee-settled
event remains completion-only so worker reconciliation cannot end a batch early.

Reserve provisioning and all treasury transfers are deferred. Production
activation must wait for the explicitly approved dedicated ETH reserve and a
funded worker; no deployment or live configuration change is performed here.
Never use the old v0.4 migration script blindly for a successor: drain both paid
lanes and preserve creator/listen pricing, roles and complete album metadata.

Validate both versions:

```sh
npx hardhat test test/DecentJukeBox_v04_playlist.test.js test/DecentJukeBox_v05_sponsored.test.js
BUSKING_WORKTREE=/absolute/path/to/DecentBusking DJUKE_REHEARSAL_VERSION=0.5 \
  npx hardhat run scripts/rehearse_djuke_v04_worker.js
```

The cross-repository rehearsal uses only local contracts and a mock token/router,
not production money. It verifies HTTP zero-ETH quotes, all 12 ordered songs,
four-song fee milestones, artist routing, restarts, main cut-ins and refunds.

Issue #241 adds a non-upgradeable v0.4 candidate in `DecentJukeBox_v0.4.sol`. It preserves live v0.3 direct artist settlement and v0.2 EIP-712 domain behavior. Playlist checkout logic is delegate-called through `DJukePlaylistModule` and radio playlists use a separate cut-in lane. This remains review material only: no deployment, migration, allowance, or fund movement is approved or performed. The v0.2 contract and live config remain unchanged.

- Radio playlists accept 1–24 unique, nonzero, enabled song IDs. Their subtotal is tiered by playlist index: songs 1–8 cost 0.25 USDC each, 9–16 cost 0.50 each, and 17–24 cost 1.00 each, independent of queue depth. The radio platform fee is $3 for 1–12 songs and $6 for 13–24 songs.
- The radio platform fee is reserved until every song in its batch is delivered, then split 25% each to Playback, Top10, Pinners and Repo funds (the Repo fund receives any rounding remainder). If a batch is refunded, the fee is returned to its payer.
- Radio playlist songs do not enter the main FIFO. Normal paid requests cut in ahead of pending playlist items; a playlist item can be fulfilled only when the main lane is empty and that item is the playlist-lane head. `pendingCount()` remains main-lane only; `totalPendingCount()` reports both lanes and `quote()` tiers on both.
- Each delivered radio song settles like a normal request: 90% to artists/collaborators by direct transfer, 8% to Pinners and 2% to Repo development. Artist transfers update `artistLedger` and emit `ArtistPaid`.
- On worker failure, all still-pending songs in the batch and its un-settled platform fee can be refunded. Delivered song payments remain settled. Refunded lane entries are skipped so the head advances. Worker gas is a separate ETH contribution (`fulfillmentCostWei * 2 * song count`) and is forwarded to the worker after a `PlaylistGasQuote` authorization.
- Private playlist checkout accepts up to 24 unique songs, charges each song's ordinary listen price (album `listenPrice` when applicable, otherwise 0.25 USDC), has no platform fee, and uses the same direct 90/8/2 settlement as `purchaseListens`.

Run focused coverage with `npx hardhat test test/DecentJukeBox_v04_playlist.test.js`, and all non-browser contract tests using the repository's Hardhat test suite excluding `*.browser.mjs`. `scripts/rehearse_djuke_v04_fork.js` validates deployment/catalog migration, cut-in lane checkout, fee routing and refunds against an in-process Base fork only. The `PlaylistGasQuote` EIP-712 domain remains `DecentJukeBox` / `0.2`.

## Worker integration rehearsal

Use the matching DecentBusking review checkout, including
`scripts/rehearse-djuke-playlist-worker.mjs` and its existing worker dependencies:

```sh
BUSKING_WORKTREE=/absolute/path/to/DecentBusking \
  npx hardhat run scripts/rehearse_djuke_v04_worker.js

BASE_FORK_RPC=https://mainnet.base.org \
BUSKING_WORKTREE=/absolute/path/to/DecentBusking \
  npx hardhat run scripts/rehearse_djuke_v04_fork.js
```

The first command deploys real v0.4/module contracts to a local Base-chain-ID
fixture using mock token/router/L1 oracle, with a fixture-only gas cap appropriate
for Hardhat's synthetic fee schedule. The second migrates the full confirmed live
catalog and exercises real USDC/router/L1 oracle state on an in-process Base fork.
The fork takes only its fee recommendation from the read-only upstream RPC,
avoiding Hardhat's synthetic priority fee without raising the candidate's gas cap.
The optional fork rehearsal requires the source's payments-disabled preflight,
or explicit `REHEARSE_WITH_PAYMENTS_ENABLED=1` for a read-only source snapshot;
the source queue must still be empty.

Both use the real worker HTTP quote handler, EIP-712 signer, confirmed reader,
playback journal/runtime, fulfiller and batch-event reconciler. They assert
12 ordered songs cost $7, collaborators and all four funds receive exact
settlements, interrupted playback recovers, a main paid request cuts in without
losing completed lane proof across restart, and full/short-playback suffix
refunds return $3.50/$3.25 respectively. Fork mutations are not real Base
transactions. This is not a Discord/streamer audio smoke test or production
deployment approval.
