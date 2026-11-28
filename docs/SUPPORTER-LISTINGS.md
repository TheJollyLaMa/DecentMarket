# DecentSupporterListings v0.1 — seller-scoped Supporter resale

Contract: [`contracts/DecentSupporterListings_v0.1.sol`](../contracts/DecentSupporterListings_v0.1.sol)
(TheJollyLaMa/DecentMarket#84, part of #85). **Not deployed.** Base deployment waits for approval gate A.

It runs beside `DecentEscrow_v001` (`0x31b07b83e99A9bdF379bf40225b8A80d3804C89d` on Base), which stays the
Agency's own shop. Existing escrow listings are not migrated or changed.

## Flow

1. Seller calls `setApprovalForAll(listings, true)` on an allowlisted collection.
2. Before listing, a steward configures the fee recipient and both Agency rates. The creator must be
   identifiable from a curated creator-lane collection or a steward-verified token association, and
   the token's ERC-2981 receiver must be that creator's wallet. `list(collection, tokenId, quantity,
   payToken, unitPrice)` moves the editions into custody and records the seller and creator.
   `payToken = address(0)` means ETH; otherwise an allowlisted ERC-20 (Base USDC).
3. Only that seller may `update(listingId, unitPrice, quantity)` or `delist(listingId)`. Delisting returns
   every unsold edition. Delisting and withdrawals keep working while paused.
4. Buyers call `purchaseWithETH(listingId, quantity)` (exact value) or
   `purchaseWithToken(listingId, quantity, maxTotal)`.
5. Sales by the creator use the independently adjustable creator-sale Agency fee and no additional
   royalty. Sales by another wallet use the independently adjustable resale Agency fee and the token's
   current ERC-2981 royalty, paid directly to the creator. The intended initial settings are 10% for
   creator sales and 5% for resales, with creators choosing their royalty starting at 5%. The owner
   must explicitly configure a verified recipient and rates; listing is disabled until then.
   Each Agency rate has a 10% hard cap, and the Agency fee plus creator royalty on resale cannot exceed
   10% combined. A rate/receiver conflict, unavailable royalty, or combined-cap violation reverts rather
   than silently paying less. Rounding stays with the seller.

The applicable Agency rate and maximum creator royalty are snapshotted at listing. A lower current rate
applies, but a higher Agency rate cannot raise the listing's fee. A creator royalty increase above its
snapshot blocks the sale until the seller delists and creates a new listing; lowering the royalty applies
immediately. A creator rate that would exceed the combined cap also blocks resale. Identity is snapshotted:
changes to a steward's creator association affect new listings, not existing ones. Seller identity is
the classification rule, not proof of an edition's individual sale history; gifts sold by others are
resales and creator buybacks sold again use creator-sale terms.

Creditors call `withdraw(token)`; anyone may call `withdrawFor(account, token)`, which pays only
`account`. ERC-2981 is advisory on other marketplaces; this contract cannot charge a fee or enforce a
royalty on external or private sales. Curated collections must return a linear ERC-2981 rate and the
verified creator wallet, including when the rate is zero. Tokens with incompatible terms remain
unavailable; legacy v0.2/v0.3 creator records name the registering admin rather than necessarily the
project creator, and their royalty settings are controlled by an admin. Verify each association and
current on-chain royalty before enabling it. DecentHead token 70 was observed at 10%; the chosen plan
is to lower applicable existing Jolly token royalties to 5%, subject to a separate, explicit transaction
approval. Until changed, a 5% Agency resale fee would exceed the cap and the listing is unavailable.
This draft does not change any live collection.

`quote(listingId, quantity)` returns the total, seller proceeds, royalty receiver and amount, and fee for
the Sell and Buy previews.

## Administrator recovery

- `emergencyReturn(listingIds)` (only while paused) sends each listing's editions to its **recorded
  seller**. A seller that refuses the transfer keeps the listing and can delist later.
- `recoverStrayERC1155` and `recoverStrayFunds` move only amounts above `custodied[collection][id]` and
  `totalOwed[token]`. No admin path can move listed stock or owed credits.
- Direct ERC-1155 transfers are rejected (`UnsolicitedTransfer`) and plain ETH sends revert, so strays
  should only arise from non-standard tokens or forced ETH.

## Events for Market, Canopy and indexers

`ListingCreated`, `ListingUpdated`, `ListingClosed(reason: Delisted | SoldOut | EmergencyReturn)`,
`Purchased` (buyer, seller, quantity, payToken, total), `SaleSettled` (seller proceeds, royalty, fee),
`Credited`, `Withdrawn`, `CollectionAllowed`, `PayTokenAllowed`, `PlatformFeesUpdated`,
`CreatorSourceUpdated`, `VerifiedCreatorUpdated`,
`EmergencyReturnFailed`, `StrayERC1155Recovered`, `StrayFundsRecovered`.
`sellerListingIds(seller)` lists a wallet's listings without an indexer.

## Validation

```bash
npx hardhat test test/DecentSupporterListings_v01.test.js
npm run rehearse:listings:fork   # local Base fork only; broadcasts nothing
```

The fork rehearsal uses the real Base Supporter collection
`0xe63EC9f8228720bAAC2fD528C0A6d06B3Dc5439B`, token 70 (DecentHead v2.0.0, escrow listing 11). On the fork
only, it impersonates the escrow owner to give a test seller two editions, then lists, buys with USDC,
rehearses a 5% royalty update, withdraws, runs the emergency return and confirms escrow listing 11 still sells.
The fork's royalty receiver is a test stand-in, not independent creator verification; no transaction is
sent to Base.
