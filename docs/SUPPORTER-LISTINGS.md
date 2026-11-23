# DecentSupporterListings v0.1 — seller-scoped Supporter resale

Contract: [`contracts/DecentSupporterListings_v0.1.sol`](../contracts/DecentSupporterListings_v0.1.sol)
(TheJollyLaMa/DecentMarket#84, part of #85). **Not deployed.** Base deployment waits for approval gate A.

It runs beside `DecentEscrow_v001` (`0x31b07b83e99A9bdF379bf40225b8A80d3804C89d` on Base), which stays the
Agency's own shop. Existing escrow listings are not migrated or changed.

## Flow

1. Seller calls `setApprovalForAll(listings, true)` on an allowlisted collection.
2. `list(collection, tokenId, quantity, payToken, unitPrice)` moves the editions into custody and records
   the seller. `payToken = address(0)` means ETH; otherwise an allowlisted ERC-20 (Base USDC).
3. Only that seller may `update(listingId, unitPrice, quantity)` or `delist(listingId)`. Delisting returns
   every unsold edition. Delisting and withdrawals keep working while paused.
4. Buyers call `purchaseWithETH(listingId, quantity)` (exact value) or
   `purchaseWithToken(listingId, quantity, maxTotal)`.
5. Each sale credits the seller, the ERC-2981 royalty (clipped to 10 %) and the platform fee (default 0,
   capped at 5 %, and never above the fee in force when the listing was created). Rounding stays with
   the seller. Creditors call `withdraw(token)`; anyone may call `withdrawFor(account, token)`, which pays
   only `account` (for royalty splitters).

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
`Credited`, `Withdrawn`, `CollectionAllowed`, `PayTokenAllowed`, `PlatformFeeUpdated`,
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
withdraws, runs the emergency return and confirms escrow listing 11 still sells.
