# Live performance assets escrow (Base)

`LivePerformanceAssetsEscrow` is an experimental prototype for DecentBusking
live-performance bookings that pay a performer fee in Base ETH or an
allowlisted ERC-20 (USDC initially) and may include an ERC-1155 Supporter
gift. It runs alongside the deployed USDC-only `LivePerformanceEscrow`, whose
address and existing signed bookings are unchanged. The deployment record is
`deployments/live-performance-assets-escrow-base.json`.

The prototype accepts fixed raw units of Base ETH or a producer-allowlisted
ERC-20 (USDC is initially allowlisted). The amount is not a dollar conversion.
Only conventional, non-rebasing, non-fee-on-transfer tokens are supported;
an exact incoming balance check is not sufficient to establish token safety.
The client and service bind token address, decimals, chain ID 8453 and escrow
address to the signed terms and on-chain configuration.

Funding atomically transfers the exact ERC-1155 collection, token ID and
quantity from the funder into segregated booking custody. A balance already
held by Market or an unsolicited vault deposit does not reserve anything.
Explicit producer performance approval after show end enables a separate,
producer-paid `releaseGift` transaction; a rejected transfer is retryable and
cannot block the independent performer fee claim. Automatic fee claim after
the review window does not itself approve the gift. Gift approval can follow
an automatic fee claim. Performer cancellation or a producer no-show decision
before the review boundary makes the gift returnable to the signed gift
treasury and the fee refundable to the funder
in independently retryable transactions. Only after that boundary (`showEnd + reviewWindow`) can a producer
mark an unperformed reserved gift returnable, without clawing back the vested
or paid fee; during review use approval, no-show or platform fault. A platform/rehearsal fault preserves
the full fee and makes an unearned gift returnable; a claim is never available
before the original booked end. Gifts do not expire.
The producer has discretion over those decisions; an approved gift's actual
delivery requires its own confirmed `GiftSettled` event, not approval or
balance alone.

**Administrator recovery is explicit:** an administrator can recover any
reserved or earned fee or gift for any recipient, which can defeat the
guarantee. Recovery sets the specific booking asset to `Recovered` and emits
an event; a separate surplus recovery cannot consume tracked liabilities.
This authority and its risks must be disclosed in the signed booking and UI.
The producer remains responsible for any resulting shortfall.

## Booking and evidence integration

The signer and service bind and verify the canonical booking ID, exact
performer wallet, chain, new contract, fixed asset address and amount, token
decimals, collection, token ID, quantity and gift-return treasury, schedule, review window, pinned
terms hash and URI. The new signed terms explicitly describe the rules
above, recovery authority, supported asset restrictions, recipient rejection,
who pays release gas, and no gift expiry. An operator-supplied terms hash is
not proof that those terms were signed. Existing v1/v2 acknowledgements must
not be reinterpreted or migrated.

Indexer and UI check the actual chain, contract, booking, relevant event
fields, finality and receipt status; reconcile replaced/reverted
transactions before retrying. They show independent fee and gift states, including
unavailable, pending, reserved, approved, received, returning, returned and
recovered. A failed RPC is unavailable, not funded. Do not use a wallet
balance as proof of the sender or of a booking-linked transfer. Validate the
contract's booking state as well as event provenance, including recovery.

## Gift stash procedure

Gifts are funded from, and unperformed gifts return to, the administrator
wallet stash (`0x807061DF657A7697c04045dA7d16D941861cAABc`), which is set as
`LIVE_PERFORMANCE_GIFT_TREASURY_ADDRESS` and signed into each booking's
gift-return treasury. Returned gifts never go back to the Market contract, so
they cannot reappear in stale storefront listings.

The deployed `DecentEscrow_v001` does not update a listing on `withdrawNFT`.
To fill the stash, delist every active listing for the token, wait for
confirmed receipts, withdraw only confirmed unsold editions to the stash, then
relist the verified remaining Market stock as one listing with the same terms.
Update any app that references the old listing ID. Editions in the stash or in
booking custody are not sellable by Market. Administrative recovery can still
remove a reserved gift and must be disclosed.

## Deployment and rollback gate

Requires security review, explicit owner approval and a local or Base-fork
rehearsal. This constructor accepts chain ID 8453 only; it cannot be deployed on
Base Sepolia. Deploy the new
version with the approved Base USDC and administrator, verify source and
constructor, and configure its exact `LIVE_PERFORMANCE_ASSET_ESCROW_ADDRESS`
and `LIVE_PERFORMANCE_ASSET_ESCROW_START_BLOCK` in the worker. Configure
`LIVE_PERFORMANCE_GIFT_TREASURY_ADDRESS` to the administrator stash to
enable gifts. Set `LIVE_PERFORMANCE_ASSET_BOOKINGS_ENABLED=true` only after
the worker/indexer and compatible client are deployed and verified; it defaults
off. Never replace the legacy escrow address. Before each
funding verify administrator roles, allowlist, chain, terms and reserved
inventory. Roll back by setting `LIVE_PERFORMANCE_ASSET_BOOKINGS_ENABLED=false`
to stop new invitations; retain the asset address and start block so indexing,
existing funding and settlement controls remain available. Also retain the
legacy address and controls.
Disabling a UI is not a withdrawal and does not change on-chain custody.

Reuse decision: Market `LivePerformanceEscrow.sol` at `394169b` supplies the
per-booking role, exact-received check and review-window pattern;
`DecentEscrow_v001.sol` supplies ERC-1155 custody but not safe booking
reservation. Adapt those MIT-licensed patterns in a separate contract, not its
storefront purchase flow. The prior `market-busking-hundred-usdc` worktree at
`6f4343a` was clean on inspection. Busking `js/live-bookings.mjs` and
`discord-bot/live-bookings.js` at `35f9a96` are adapted as the receiving
signed-terms and evidence paths. The old USDC version and signed messages
are unchanged. Historical tip attribution resolves the exact stored booking
version and validates that contract's state at the tip block.

Local prototype checks (the alternate Hardhat config supplies chain ID 8453):

```sh
npx hardhat test --config hardhat.booking-test.config.js test/LivePerformanceAssetsEscrow.test.js test/LivePerformanceAssetsChain.test.js
BUSKING_BOOKING_ROOT=/absolute/path/to/Busking npx hardhat test --config hardhat.booking-test.config.js test/LivePerformanceAssetsBusking.test.js
```
