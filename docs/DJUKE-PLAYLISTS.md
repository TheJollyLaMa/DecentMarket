# DJuke named playlist contract candidate

Issue #241 adds a non-upgradeable v0.3 candidate in `DecentJukeBox_v0.3.sol`; it inherits v0.2 behavior and delegate-calls `DJukePlaylistModule` so playlist checkout stays separate from existing single-song and personal-listen paths. This is review material only. No deployment, migration, allowance, or fund movement is approved or performed. The v0.2 contract and live config remain unchanged.

## Contract rules

- Playlist batch: 1–10 unique, nonzero, enabled song IDs, validated before token transfer. Enqueue all requests atomically and in supplied order, each at 250,000 USDC base units (0.25 USDC), independent of legacy queue-depth pricing.
- Private named checkout: 250,000 base units per song, no radio fee and no queue insertion. Existing creator-configured personal listen prices remain untouched.
- Radio named checkout: batch song subtotal plus a single 5,000,000-base-unit fee. The contract reserves that fee until all requests complete; then it splits the fee through the existing platform-fund router. Exact 6-decimal allocation: playback 2,250,000; Top 10 2,250,000; pinners 400,000; repo development 100,000.
- On worker failure, only the unresolved FIFO suffix and the full still-reserved fee can be refunded. Previously completed song payments remain settled. The fulfiller role must call `refundUndeliveredPlaylist`; it cannot skip requests or refund an already-settled fee. Worker gas is a separate native-ETH contribution and is not part of the $5 reserve.
- A signed radio gas quote binds the listener, exact ordered-ID hash, max token total, per-item fulfillment contribution (funded at 2× that estimate for each batch song), nonce and deadline to the Base v0.2 EIP-712 domain version.

The playlist fee is not the song payout: completed song requests retain existing 90% artist/collaborator, 8% pinner and 2% repository-development settlement. The $5 platform fee is a separate split.

## Build and tests

`DecentJukeBox_v0.3.sol` must be built with Solidity 0.8.26, Cancun EVM, via-IR, optimizer enabled with exactly 1 run. The module uses via-IR and optimizer 200; other base contracts retain their declared overrides. Do not change settings casually: the candidate runtime measured 24,492 bytes against EIP-170's 24,576-byte cap (84 bytes headroom). Compile and remeasure deployed runtime size with the exact toolchain before any review candidate is treated as deployable.

Run `npm test -- --grep "DecentJukeBox_v0_3 named playlist checkout"` for focused contract coverage, or `npm test` for the complete Hardhat suite. `npm run export:dbusk-abis` now exports `abis/DecentJukeBox_v0.3.json` alongside the existing contract ABIs after compilation.

The focused suite exercises 1–10 capacity, duplicate/unavailable songs, flat rates at paid queue depths 7, 8 and 17, atomic order, once-only fee routing with exact base-unit totals, and refund of an undelivered suffix. These tests do not prove production worker completion, a deployed router's fund IDs, gas adequacy, or live queue scheduling.

## Separate steward approval checklist (not authorized by this PR)

1. Independently review module delegatecall/storage safety, EIP-712 quote construction, role access and deployed runtime size.
2. Reconcile all four fund IDs, router authorization, token decimals, account balances and exact deployed bytecode/source/compiler settings.
3. Complete the worker's batch gas quoting, receipt/event reconciliation, restart recovery, contiguous scheduling and durable audible-completion/refund invocation; test these on a fork.
4. Rehearse with no live writes and verify rollback/refund cases, role assignment and playlist-module address.
5. Obtain separate steward authorization for any deployment/configuration, and only then set a client capability address/version. No deployment, migration, allowance, or funds transfer is part of this change.
