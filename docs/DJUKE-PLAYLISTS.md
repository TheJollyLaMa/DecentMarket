# DJuke named playlist contract candidate

Issue #241 adds a non-upgradeable v0.4 candidate in `DecentJukeBox_v0.4.sol`; it preserves the live v0.3 direct-settlement model and inherits v0.2 EIP-712 domain behavior and delegate-calls `DJukePlaylistModule` so playlist checkout stays separate from existing single-song and personal-listen paths. This is review material only. No deployment, migration, allowance, or fund movement is approved or performed. The v0.2 contract and live config remain unchanged.

## Contract rules

- Playlist batch: 1–10 unique, nonzero, enabled song IDs, validated before token transfer. Enqueue all requests atomically and in supplied order, each at 250,000 USDC base units (0.25 USDC), independent of legacy queue-depth pricing.
- Private named checkout: 250,000 base units per song, no radio fee and no queue insertion. Existing creator-configured personal listen prices remain untouched.
- Radio named checkout: batch song subtotal plus a single 5,000,000-base-unit fee. The contract reserves that fee until all requests complete; then it splits the fee through the existing platform-fund router. Exact 6-decimal allocation: playback 2,250,000; Top 10 2,250,000; pinners 400,000; repo development 100,000.
- On worker failure, only the unresolved FIFO suffix and the full still-reserved fee can be refunded. Previously completed song payments remain settled. The fulfiller role must call `refundUndeliveredPlaylist`; it cannot skip requests or refund an already-settled fee. Worker gas is a separate native-ETH contribution and is not part of the $5 reserve.
- A signed radio gas quote binds the listener, exact ordered-ID hash, max token total, per-item fulfillment contribution (funded at 2× that estimate for each batch song), nonce and deadline to the Base v0.2 EIP-712 domain version.

The playlist fee is not the song payout: completed song requests retain existing 90% artist/collaborator, 8% pinner and 2% repository-development settlement. The $5 platform fee is a separate split.

## Build and tests

`DecentJukeBox_v0.4.sol` must be built with Solidity 0.8.26, Cancun EVM, via-IR, optimizer enabled with exactly 1 run. The module uses via-IR and optimizer 200; other base contracts retain their declared overrides. Do not change settings casually: the v0.4 deployed runtime is measured at 22,298 bytes against EIP-170's 24,576-byte cap (2,278 bytes headroom). Its v0.4-specific base clone removes revert strings to preserve runtime margin; semantics and access checks remain unchanged. Compile and remeasure deployed runtime size with the exact toolchain before any review candidate is treated as deployable.

Run `npm test -- --grep "DecentJukeBox_v0_4 named playlist checkout"` for focused contract coverage, or `npm test` for the complete Hardhat suite. `npm run export:dbusk-abis` now exports `abis/DecentJukeBox_v0.4.json` and `abis/DJukePlaylistModule.json` alongside the existing contract ABIs after compilation.

Radio and private-playlist artist payments use direct safe transfers with the public `artistLedger` totals and `ArtistPaid` events; playlist purchases never accrue `artistCredits`. The `PlaylistGasQuote` signature remains bound to EIP-712 domain version `0.2`, matching the worker signer. `scripts/check_live_djuke_v03_bytecode.js` compares the live v0.3 runtime on a Base fork, masking only constructor immutables. The focused suite exercises 1–10 capacity, duplicate/unavailable songs, flat rates at paid queue depths 7, 8 and 17, atomic order, once-only fee routing with exact base-unit totals, and refund of an undelivered suffix. These tests do not prove production worker completion, deployed router behavior, gas adequacy, or live queue scheduling. The guarded migration script preflights all four existing funds, approved USDC and router pause state; the verified router `fundToken` entry point is permissionless, so no separate router funder authorization is expected.

## Separate steward approval checklist (not authorized by this PR)

1. Independently review module delegatecall/storage safety, EIP-712 quote construction, role access and deployed runtime size.
2. Reconcile all four fund IDs, router authorization, token decimals, account balances and exact deployed bytecode/source/compiler settings.
3. Review the worker's implemented durable event reconciliation, restart recovery, contiguous scheduling, and idempotent automatic suffix refunds. Radio readiness intentionally remains false until the v0.4 address/configuration is enabled and the full impersonated-owner fork rehearsal passes.
4. Run `BASE_FORK_RPC=https://mainnet.base.org npx hardhat run scripts/rehearse_djuke_v04_fork.js` and verify migration, roles, four-fund settlement, artist direct payment, and suffix refunds before deployment. The current Hardhat 2.28.6 fork fails on its first contract read with a missing historical hardfork activation-history error for Base; resolve the local fork configuration before treating rehearsal as complete.
5. Obtain separate steward authorization for any deployment/configuration, and only then set a client capability address/version. No deployment, migration, allowance, or funds transfer is part of this change.
